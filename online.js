window.KanaBattleOnlineClient = (() => {
  const meta = document.querySelector('meta[name="kana-online-api"]');
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const API_BASE = String((local ? "http://127.0.0.1:8787" : meta?.content) || "https://kana-voice-match-online.yorkwahaha.workers.dev").replace(/\/$/, "");
  const SESSION_PREFIX = "kana-voice-match-online:";
  let socket = null;
  let room = null;
  let roomCode = "";
  let token = "";
  let reconnectTimer = 0;
  let reconnectAttempts = 0;
  let intentionalClose = false;
  let readySyncTimers = [];
  let handlers = { onState() {}, onConnection() {}, onError() {} };

  const ERROR_MESSAGES = {
    ROOM_NOT_FOUND: "找不到房間，請確認房號。",
    ROOM_FULL: "房間已有兩位玩家。",
    ROOM_ALREADY_STARTED: "這局已開始，無法加入。",
    INVALID_SESSION: "連線憑證已失效，請重新加入。",
    PLAYER_NOT_CONNECTED: "連線尚未完成，請稍候再準備。",
    CHARACTER_TAKEN: "對手已選這名角色，請換一位。",
    OPPONENT_UNAVAILABLE: "對手目前離線，對戰已暫停。",
    STALE_STATE: "戰況剛更新，已重新同步。",
    STALE_QUESTION: "題目已更新，請依新題目作答。",
    ROUND_ALREADY_CLAIMED: "本輪已被對手搶先答對。",
    ROUND_NOT_STARTED: "題目語音尚未開始，請先聽完提示。",
    SUBMIT_LOCKED: "目前被封鎖，暫時不能提交。",
    ATTACK_LOCKED: "目前被封鎖，暫時不能攻擊。",
    SKIP_NOT_ALLOWED: "聽力搶答不能跳過題目。",
    AUTO_ATTACK_MODE: "聽力搶答會自動攻擊。",
    GAME_NOT_ACTIVE: "目前沒有進行中的對戰。",
    NOT_IN_LOBBY: "目前不在房間大廳。",
    ONLY_HOST_CAN_CONFIGURE: "只有房主可以調整房間設定。",
    UNKNOWN_SKILL: "無法使用這個技能。",
    NOT_ENOUGH_COMBO: "COMBO 不足。",
    NO_CHARGE: "目前沒有可發動的蓄力。",
    HP_FULL: "目前體力已滿。",
    NO_TARGET_CHARGE: "對手目前沒有可奪取的蓄力。",
    AMP_ALREADY_READY: "連鳴已待機。",
    ORIGIN_NOT_ALLOWED: "目前網站來源未獲准使用線上房間。",
    NETWORK_UNAVAILABLE: "目前無法連上線上房間。",
  };

  function emitConnection(status, detail = "") {
    handlers.onConnection({ status, detail, attempts: reconnectAttempts });
  }

  function emitError(code, fallback) {
    handlers.onError({ code, message: ERROR_MESSAGES[code] || fallback || "線上房間發生錯誤。" });
  }

  function sessionKey(code) {
    return SESSION_PREFIX + String(code || "").toUpperCase();
  }

  function saveSession(playerName) {
    try {
      window.localStorage.setItem(sessionKey(roomCode), JSON.stringify({ roomCode, token, playerName }));
    } catch {}
  }

  function loadSession(code) {
    try { return JSON.parse(window.localStorage.getItem(sessionKey(code)) || "null"); } catch { return null; }
  }

  function forgetSession(code = roomCode) {
    try { window.localStorage.removeItem(sessionKey(code)); } catch {}
  }

  async function request(path, init) {
    let response;
    try {
      response = await fetch(API_BASE + path, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
      });
    } catch (error) {
      throw new Error("NETWORK_UNAVAILABLE", { cause: error });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
    return data;
  }

  function websocketUrl() {
    const base = API_BASE.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    return `${base}/rooms/${encodeURIComponent(roomCode)}/ws`;
  }

  function clearReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }

  function clearReadySync() {
    readySyncTimers.forEach((timer) => clearTimeout(timer));
    readySyncTimers = [];
  }

  function scheduleReadySync() {
    clearReadySync();
    readySyncTimers = [600, 1600, 3200].map((delay) => setTimeout(() => {
      if (room?.phase === "lobby") send("sync");
    }, delay));
  }

  function scheduleReconnect() {
    if (intentionalClose || reconnectTimer || !roomCode || !token) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > 8) {
      intentionalClose = true;
      emitConnection("closed");
      emitError("INVALID_SESSION", "多次重新接線仍失敗，請重新加入房間。");
      return;
    }
    const delay = Math.min(8000, 500 * (2 ** Math.min(4, reconnectAttempts - 1)));
    emitConnection("reconnecting", `第 ${reconnectAttempts} 次重新接線`);
    reconnectTimer = setTimeout(() => { reconnectTimer = 0; connect(); }, delay);
  }

  function connect() {
    clearReconnect();
    intentionalClose = false;
    emitConnection(reconnectAttempts ? "reconnecting" : "connecting");
    let currentSocket;
    try {
      currentSocket = new window.WebSocket(websocketUrl(), ["kana-voice-match-v1", `kana-token.${token}`]);
      socket = currentSocket;
    } catch {
      scheduleReconnect();
      return;
    }
    let openTimer = setTimeout(() => {
      if (socket !== currentSocket || intentionalClose) return;
      socket = null;
      try { currentSocket.close(); } catch {}
      scheduleReconnect();
    }, 6000);
    currentSocket.addEventListener("open", () => {
      if (socket !== currentSocket || intentionalClose) return;
      clearTimeout(openTimer);
      openTimer = 0;
      reconnectAttempts = 0;
      emitConnection("connected");
      currentSocket.send(JSON.stringify({ type: "sync" }));
    });
    currentSocket.addEventListener("message", (event) => {
      if (socket !== currentSocket || intentionalClose) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.room && (!room || message.room.version >= room.version)) {
        room = message.room;
        if (room.phase !== "lobby") clearReadySync();
        handlers.onState(room);
      }
      if (message.type === "error") emitError(message.code);
    });
    currentSocket.addEventListener("close", (event) => {
      if (socket !== currentSocket) return;
      clearTimeout(openTimer);
      openTimer = 0;
      socket = null;
      if (intentionalClose) { emitConnection("closed"); return; }
      if (event.code === 4000 || event.code === 4001) {
        intentionalClose = true;
        emitConnection("closed");
        emitError(event.code === 4000 ? "ROOM_NOT_FOUND" : "INVALID_SESSION", event.reason);
        return;
      }
      scheduleReconnect();
    });
    currentSocket.addEventListener("error", () => {
      if (socket !== currentSocket || intentionalClose) return;
      emitConnection("disconnected");
      setTimeout(() => {
        if (socket !== currentSocket || intentionalClose) return;
        clearTimeout(openTimer);
        openTimer = 0;
        socket = null;
        try { currentSocket.close(); } catch {}
        scheduleReconnect();
      }, 250);
    });
  }

  function acceptSession(data, playerName) {
    room = data.room;
    roomCode = room.roomCode;
    token = data.token;
    saveSession(playerName);
    handlers.onState(room);
    connect();
    const url = new URL(location.href);
    url.searchParams.set("room", roomCode);
    window.history.replaceState({}, "", url);
    return room;
  }

  async function create({ playerName, config, deck }) {
    emitConnection("creating");
    try {
      return acceptSession(await request("/rooms", { method: "POST", body: JSON.stringify({ playerName, config, deck }) }), playerName);
    } catch (error) {
      emitConnection("idle"); emitError(error.message); throw error;
    }
  }

  async function join({ playerName, code }) {
    const clean = String(code || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
    emitConnection("joining");
    try {
      return acceptSession(await request(`/rooms/${encodeURIComponent(clean)}/join`, { method: "POST", body: JSON.stringify({ playerName }) }), playerName);
    } catch (error) {
      emitConnection("idle"); emitError(error.message); throw error;
    }
  }

  function resume(code) {
    const saved = loadSession(code);
    if (!saved?.token) return false;
    roomCode = saved.roomCode;
    token = saved.token;
    room = null;
    connect();
    return true;
  }

  function send(type, payload = {}) {
    if (!socket || socket.readyState !== window.WebSocket.OPEN || !room) {
      emitError("NETWORK_UNAVAILABLE");
      return false;
    }
    socket.send(JSON.stringify({
      type,
      ...payload,
      version: room.version,
      actionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    }));
    return true;
  }

  function leave(options = {}) {
    const activeSocket = socket;
    const activeCode = roomCode;
    const activeToken = token;
    intentionalClose = true;
    clearReconnect();
    clearReadySync();
    if (activeSocket?.readyState === window.WebSocket.OPEN && room) send("leave");
    if (activeCode && activeToken) {
      void request(`/rooms/${encodeURIComponent(activeCode)}/leave`, {
        method: "POST", body: JSON.stringify({ token: activeToken }), keepalive: true,
      }).catch(() => {});
    }
    if (activeSocket) setTimeout(() => activeSocket.close(1000, "Left room"), 160);
    socket = null;
    if (options.forget !== false) forgetSession(activeCode);
    room = null; roomCode = ""; token = ""; reconnectAttempts = 0;
    const url = new URL(location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
    emitConnection("idle");
  }

  return {
    apiBase: API_BASE,
    init(next) { handlers = { ...handlers, ...(next || {}) }; },
    create, join, resume, leave,
    ready(characterId, ready = true) {
      const sent = send("ready", { characterId, ready });
      if (sent && ready) scheduleReadySync();
      else if (!ready) clearReadySync();
      return sent;
    },
    configure(config, deck) { return send("configure", { config, deck }); },
    submit(questionId, answer) { return send("submit", { questionId, answer }); },
    skip() { return send("skip"); },
    attack() { return send("attack"); },
    skill(skill) { return send("skill", { skill }); },
    async copyInvite() {
      if (!roomCode) return false;
      const url = new URL(location.href); url.searchParams.set("room", roomCode);
      try { await navigator.clipboard.writeText(url.toString()); return true; } catch { return false; }
    },
    getRoom() { return room; },
  };
})();
