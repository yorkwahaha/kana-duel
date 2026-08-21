/* global $, ALL_QUESTIONS, CHARACTERS, MAX_HP, boards, categoryLabelOf */
/* global battleOpts:writable, battleDeck:writable, battleOpen:writable, battleEpoch:writable */
/* global battleStartedAt:writable, charge:writable, combo:writable, gaugeHits:writable, hp:writable */
/* global ampHits:writable, blockUntil:writable, submitLockUntil:writable, attackLockUntil:writable */
/* global pickP1:writable, pickP2:writable, gameMode:writable, playerQi:writable, sharedQi:writable */
/* global listenRoundClaimed:writable, battleStats:writable, attackQueue:writable, timerRaf */
/* global bindTap, cancelAllDrags, clearBattleFx, clearSkillTimers, hideSpecialStage, noteQuestionOpen */
/* global getSessionToken, playQuestionAudio, preloadBattleSfx, prepareQuestionAudio, primeBattleAudio, scheduleQuestionAudio */
/* global fxThemeOf, playAttackBolt, playBlockActivate, playCastBurst, playHitSfx, playSfx, setFighterPose, setResultScreen */
/* global showCombo, showDmgFloat, showScreen, showWordReveal, spawnHitBurst, startBattleBgm, stopBattleBgm, stopTts */
/* global syncFighterPassive, tickBattleClock, updateHpUi, updatePlayerMeters, ensureCastLayers, preloadFighterPoses */
/* global MAX_ATTACK_SEGMENTS, playSpecialAftermath, playSpecialUltimate, prefersReducedMotion, shakeBattle */
/* global spawnBlockParry, splitComboDamage, wait */
(() => {
  const client = window.KanaBattleOnlineClient;
  if (!client) return;

  let room = null;
  let active = false;
  let lastEventId = 0;
  let localQuestionId = "";
  let lastListenCueSeq = 0;
  let connectionStatus = "idle";
  let battleResultShown = false;
  let pendingCharacterId = "";

  const CHARACTER_INTROS = {
    ao: "快速累積大招，擅長封鎖對手提交。",
    rin: "高爆發大招，能奪取對手的蓄力。",
    ya: "減少題目干擾，並封鎖對手攻擊。",
    go: "連段攻擊專家，可強化下一次攻擊。",
    ran: "蓄力速度快，能解除封鎖並保護自己。",
    gen: "穩定增加連擊，擅長封鎖對手提交。",
    sho: "減少干擾字，控制對手的攻擊節奏。",
    yo: "高倍率大招，可吸取對手的蓄力。",
  };

  function setError(message = "") {
    const el = $("online-error");
    if (el) el.textContent = message;
  }

  function configFromUi() {
    return {
      mode: $("online-mode")?.value === "listen" ? "listen" : "race",
      distractors: !!$("online-distractors")?.checked,
      maxLen: Number($("online-maxlen")?.value) || 0,
      script: $("online-script")?.value || "all",
      category: $("online-category")?.value || "all",
    };
  }

  function deckForConfig(config) {
    let list = ALL_QUESTIONS.slice();
    if (config.category !== "all") list = list.filter((q) => q.category === config.category);
    if (config.maxLen > 0) list = list.filter((q) => q.kanaSequence.length <= config.maxLen);
    if (config.script === "hira" || config.script === "kata") {
      list = list.filter((q) => {
        let hira = 0; let kata = 0;
        q.kanaSequence.forEach((part) => {
          for (const ch of part) {
            const code = ch.codePointAt(0);
            if (code >= 0x3041 && code <= 0x3096) hira += 1;
            else if (code >= 0x30A1 && code <= 0x30FA) kata += 1;
          }
        });
        return config.script === "hira" ? hira > 0 && kata === 0 : kata > 0 && hira === 0;
      });
    }
    if (!list.length) list = ALL_QUESTIONS.slice();
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.map((q) => ({ id: q.id, answer: q.kanaSequence }));
  }

  function questionById(id) {
    return ALL_QUESTIONS.find((q) => q.id === id) || null;
  }

  function localSeat() { return room?.youSeat ?? 0; }
  function remoteSeat() { return localSeat() === 0 ? 1 : 0; }
  function localPlayer() { return room?.players?.[localSeat()] || null; }
  function remotePlayer() { return room?.players?.[remoteSeat()] || null; }

  function characterById(id, fallbackIndex = 0) {
    return CHARACTERS.find((character) => character.id === id) || CHARACTERS[fallbackIndex] || null;
  }

  function renderCharacterCard(id) {
    const character = characterById(id, 0);
    if (!character) return;
    pendingCharacterId = character.id;
    const image = $("online-character-image");
    if (image) {
      image.src = character.image;
      image.alt = `${character.name}角色立繪`;
    }
    if ($("online-character-title")) $("online-character-title").textContent = character.title;
    if ($("online-character-heading")) $("online-character-heading").textContent = character.name;
    if ($("online-character-intro")) $("online-character-intro").textContent = CHARACTER_INTROS[character.id] || "選擇適合自己的戰鬥風格。";
    if ($("online-character-passive")) $("online-character-passive").textContent = character.passive?.label || "—";
    if ($("online-character-passive-desc")) $("online-character-passive-desc").textContent = character.passive?.desc || "—";
    if ($("online-character-active")) $("online-character-active").textContent = character.active?.label || "—";
    if ($("online-character-active-desc")) $("online-character-active-desc").textContent = character.active?.desc || "—";
    if ($("online-character") && $("online-character").value !== character.id) $("online-character").value = character.id;
  }

  function stepCharacter(delta) {
    const currentIndex = Math.max(0, CHARACTERS.findIndex((character) => character.id === pendingCharacterId));
    const next = CHARACTERS[(currentIndex + delta + CHARACTERS.length) % CHARACTERS.length];
    renderCharacterCard(next.id);
  }

  function renderLobby() {
    if (!room) return;
    $("online-entry")?.classList.add("hidden");
    $("online-lobby")?.classList.remove("hidden");
    if ($("online-room-code")) $("online-room-code").textContent = room.roomCode;
    const host = room.youSeat === room.hostSeat;
    const settings = ["online-mode", "online-category", "online-maxlen", "online-script", "online-distractors"];
    settings.forEach((id) => { if ($(id)) $(id).disabled = !host || room.phase !== "lobby"; });
    if (document.activeElement?.closest?.(".online-settings") == null) {
      if ($("online-mode")) $("online-mode").value = room.config.mode;
      if ($("online-category")) $("online-category").value = room.config.category || "all";
      if ($("online-maxlen")) $("online-maxlen").value = String(room.config.maxLen);
      if ($("online-script")) $("online-script").value = room.config.script;
      if ($("online-distractors")) $("online-distractors").checked = room.config.distractors;
    }
    const players = $("online-players");
    if (players) {
      players.innerHTML = room.players.map((player, seat) => {
        if (!player) return `<div class="online-player online-player-empty"><div><strong>等待玩家</strong><span>分享房號或邀請連結</span></div></div>`;
        const character = characterById(player.characterId, seat);
        const flags = [seat === room.hostSeat ? "房主" : "玩家", player.connected ? "已連線" : "重新連線中", player.ready ? "已準備" : "未準備"];
        return `<div class="online-player${player.ready ? " ready" : ""}"><img src="${escapeHtml(character?.image || "assets/characters/ao.webp")}" alt="" /><div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(character?.name || "未選角")}</span><span>${flags.join(" · ")}</span></div><b>${player.ready ? "✓ 已準備" : "選角中"}</b></div>`;
      }).join("");
    }
    const mine = localPlayer();
    if (!pendingCharacterId || mine?.ready) pendingCharacterId = mine?.characterId || "ao";
    if (document.activeElement !== $("online-character")) renderCharacterCard(pendingCharacterId);
    const characterLocked = !!mine?.ready || room.phase !== "lobby";
    ["online-character", "btn-online-character-prev", "btn-online-character-next"].forEach((id) => {
      if ($(id)) $(id).disabled = characterLocked;
    });
    const ready = $("btn-online-ready");
    if (ready) {
      ready.disabled = connectionStatus !== "connected" || !remotePlayer();
      ready.textContent = mine?.ready ? "取消準備" : "準備";
    }
    const note = $("online-note");
    if (note) {
      if (!remotePlayer()) note.textContent = "等待第二位玩家加入。";
      else if (!remotePlayer().connected) note.textContent = "對手正在重新連線，房間會保留。";
      else if (mine?.ready && !remotePlayer().ready) note.textContent = "你已準備，等待對手。";
      else note.textContent = host ? "你是房主，可調整規則；雙方準備後自動開戰。" : "規則由房主設定；選好角色後按準備。";
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function remainingDeadline(serverDeadline) {
    return performance.now() + Math.max(0, Number(serverDeadline || 0) - Number(room?.serverNow || Date.now()));
  }

  function loadOnlineQuestion(force = false) {
    if (!room?.battle) return;
    const localId = room.currentQuestionId;
    const localQ = questionById(localId);
    if (localQ && (force || localQuestionId !== localId)) {
      localQuestionId = localId;
      battleDeck = [localQ];
      boards[1].load(localQ.kanaSequence, {
        showRomaji: room.config.mode !== "listen",
        noDistractors: !room.config.distractors,
        distractorDelta: room.config.distractors ? (pickP1?.passive?.distractorDelta || 0) : 0,
      });
      boards[1].locked = false;
      $("board1")?.classList.remove("locked");
      noteQuestionOpen(1);
    }
  }

  function syncListenCue() {
    const cue = room?.battle?.listenCue;
    if (room?.config?.mode !== "listen" || !cue || cue.seq <= lastListenCueSeq) return;
    const question = questionById(cue.questionId);
    if (!question) return;
    lastListenCueSeq = cue.seq;
    const delayMs = Math.max(0, Number(cue.playAt) - Number(room.serverNow || Date.now()));
    prepareQuestionAudio(question).catch(() => {});
    scheduleQuestionAudio(question, { delayMs }).catch(() => {});
  }

  function updateOpponentStatus() {
    if (!room?.battle) return;
    let status = $("online-opponent-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "online-opponent-status";
      status.className = "online-opponent-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      $("duel-half-2")?.querySelector(".duel-panel")?.appendChild(status);
    }
    const opponent = room.battle.fighters[remoteSeat()];
    const connected = remotePlayer()?.connected;
    status.innerHTML = `<strong>${connected ? "對手作答中" : "對手重新連線中"}</strong><span>答對 ${opponent.corrects} 題 · COMBO ${opponent.combo}</span>`;
  }

  function syncBattleState() {
    if (!room?.battle) return;
    const mine = room.battle.fighters[localSeat()];
    const foe = room.battle.fighters[remoteSeat()];
    hp = { 1: mine.hp, 2: foe.hp };
    charge = { 1: mine.charge, 2: foe.charge };
    combo = { 1: mine.combo, 2: foe.combo };
    gaugeHits = { 1: mine.gauge, 2: foe.gauge };
    ampHits = { 1: mine.ampHits, 2: foe.ampHits };
    blockUntil = { 1: remainingDeadline(mine.blockUntil), 2: remainingDeadline(foe.blockUntil) };
    submitLockUntil = { 1: remainingDeadline(mine.submitLockUntil), 2: remainingDeadline(foe.submitLockUntil) };
    attackLockUntil = { 1: remainingDeadline(mine.attackLockUntil), 2: remainingDeadline(foe.attackLockUntil) };
    playerQi = { 1: mine.qi, 2: 0 };
    sharedQi = room.battle.sharedQi;
    listenRoundClaimed = room.battle.listenClaimed;
    updateHpUi();
    updatePlayerMeters(1);
    updatePlayerMeters(2);
    document.querySelectorAll('[data-p="2"]').forEach((button) => { button.disabled = true; });
    updateOpponentStatus();
    loadOnlineQuestion();
    syncListenCue();
  }

  function beginOnlineBattle() {
    active = true;
    battleResultShown = false;
    lastEventId = 0;
    localQuestionId = "";
    lastListenCueSeq = 0;
    document.body.classList.add("online-battle");
    gameMode = "online";
    battleOpts = { ...room.config };
    battleDeck = [];
    pickP1 = characterById(localPlayer()?.characterId, 0);
    pickP2 = characterById(remotePlayer()?.characterId, 1);
    battleEpoch += 1;
    battleOpen = true;
    battleStats = null;
    attackQueue = Promise.resolve();
    cancelAllDrags();
    clearBattleFx();
    clearSkillTimers(1); clearSkillTimers(2);
    $("fighter1-img").src = pickP1.image;
    $("fighter2-img").src = pickP2.image;
    $("hp1-name").textContent = localPlayer()?.name || "我方";
    $("hp2-name").textContent = remotePlayer()?.name || "對手";
    preloadFighterPoses(pickP1); preloadFighterPoses(pickP2);
    syncFighterPassive(1); syncFighterPassive(2); ensureCastLayers();
    $("board2")?.setAttribute("aria-hidden", "true");
    document.querySelector(".duel-stage")?.classList.toggle("listen-mode", room.config.mode === "listen");
    $("btn-battle-listen")?.classList.toggle("hidden", room.config.mode !== "listen");
    if ($("rule-chip")) $("rule-chip").textContent = `線上 · ${room.config.mode === "listen" ? "聽力搶答" : "競速對決"} · ${categoryLabelOf(room.config.category)} · ${room.roomCode}`;
    showScreen("battle");
    syncBattleState();
    battleStartedAt = performance.now() - Math.max(0, Number(room.serverNow) - Number(room.battle.startedAt));
    cancelAnimationFrame(timerRaf); tickBattleClock();
    startBattleBgm().catch(() => {});
  }

  function displaySeat(serverSeat) { return serverSeat === localSeat() ? 1 : 2; }

  function pulseDeviceImpact(heavy = false) {
    if (prefersReducedMotion() || typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(heavy ? [34, 24, 46] : 24); } catch {}
  }

  function queueOnlineAnimation(task) {
    const queuedEpoch = battleEpoch;
    attackQueue = Promise.resolve(attackQueue).then(() => {
      if (!active || queuedEpoch !== battleEpoch) return false;
      return task(queuedEpoch);
    }).catch((error) => {
      console.error("Online battle animation failed", error);
      return false;
    });
    return attackQueue;
  }

  async function animateMiss(event, player, actionEpoch) {
    const fighter = $("fighter" + player);
    const wrong = Math.max(1, event.wrong || 1);
    setFighterPose(player, "hit");
    playHitSfx(Math.min(5, wrong));
    showDmgFloat(player, event.damage, wrong);
    spawnHitBurst(fighter, fxThemeOf(player === 1 ? 2 : 1), wrong + 1);
    shakeBattle(wrong >= 2);
    pulseDeviceImpact(wrong >= 2);
    fighter?.classList.remove("hit", "hit-strong");
    void fighter?.offsetWidth;
    fighter?.classList.add(wrong >= 2 ? "hit-strong" : "hit");
    await wait(330);
    fighter?.classList.remove("hit", "hit-strong");
    if (active && actionEpoch === battleEpoch && (hp[player] || 0) > 0) setFighterPose(player, "idle");
  }

  async function animateAttack(event, player, foe, actionEpoch) {
    const attacker = $("fighter" + player);
    const defender = $("fighter" + foe);
    const theme = fxThemeOf(player);
    const hits = Math.max(1, Math.min(Number(event.hits) || 1, MAX_ATTACK_SEGMENTS));
    const parts = splitComboDamage(Math.max(1, Number(event.damage) || 1), hits);
    const comboSize = event.hits >= 5 ? "lg" : event.hits >= 3 ? "md" : "sm";
    showCombo(`${event.special ? "大招" : "攻擊"} · ${event.hits} COMBO`, comboSize);
    playSfx("skillpop", 0.48);
    setFighterPose(player, "atk");
    attacker?.classList.add("attacking");

    if (event.special) {
      await playSpecialUltimate(player);
      if (!active || actionEpoch !== battleEpoch) return false;
      await playSpecialAftermath(theme.id);
      if (!active || actionEpoch !== battleEpoch) return false;
      await preloadBattleSfx().catch(() => {});
      playAttackBolt(player, foe, theme, true);
      await wait(90);
      playAttackBolt(player, foe, theme, true);
    } else {
      playCastBurst(attacker, theme);
      await playAttackBolt(player, foe, theme, hits >= 3);
    }

    if (event.guarded) {
      showCombo("格擋!", "sm");
      spawnBlockParry(defender, true);
      playSfx("ready", 0.5);
    }
    setFighterPose(foe, "hit");
    for (let index = 0; index < parts.length; index += 1) {
      if (!active || actionEpoch !== battleEpoch) return false;
      const hitNo = index + 1;
      playHitSfx(Math.min(hitNo, 5));
      showDmgFloat(foe, parts[index], hitNo);
      if (event.guarded) spawnBlockParry(defender, hitNo === 1 || hitNo === parts.length);
      else spawnHitBurst(defender, theme, hitNo + (event.special ? 2 : 0));
      playAttackBolt(player, foe, theme, event.special || hitNo >= 3 || hitNo === parts.length);
      shakeBattle(event.special || hitNo >= 3 || hitNo === parts.length);
      pulseDeviceImpact(event.special || hitNo === parts.length);
      defender?.classList.remove("hit", "hit-strong", "block-absorb");
      void defender?.offsetWidth;
      defender?.classList.add(event.guarded ? "block-absorb" : (event.special || hitNo >= 4 ? "hit-strong" : "hit"));
      await wait(210 + Math.min(hitNo, 5) * 16);
    }
    defender?.classList.remove("hit", "hit-strong", "block-absorb");
    attacker?.classList.remove("attacking");
    setFighterPose(player, "idle");
    if ((hp[foe] || 0) > 0) setFighterPose(foe, "idle");
    return true;
  }

  function renderEvent(event) {
    if (!event || event.id <= lastEventId) return;
    lastEventId = event.id;
    const player = displaySeat(event.seat);
    if (event.type === "correct") {
      boards[player]?.setFeedback(player === 1 ? `答對 · +${event.gain}` : "對手答對", "ok");
      showWordReveal(player, questionById(event.questionId));
      playSfx("skillpop", 0.4);
    } else if (event.type === "miss") {
      boards[player]?.setFeedback(`${player === 1 ? "答錯" : "對手答錯"} · -${event.damage}`, "bad");
      queueOnlineAnimation((actionEpoch) => animateMiss(event, player, actionEpoch));
    } else if (event.type === "attack") {
      const foe = displaySeat(event.foeSeat);
      if (event.automatic && event.questionId) {
        const question = questionById(event.questionId);
        showWordReveal(1, question);
        showWordReveal(2, question);
      }
      queueOnlineAnimation((actionEpoch) => animateAttack(event, player, foe, actionEpoch));
    } else if (event.type === "skill") {
      showCombo(event.skill === "block" ? "格擋" : event.skill === "heal" ? "回墨" : "專屬技能", "sm");
      if (event.skill === "block") playBlockActivate(player);
      playSfx("ready", 0.45);
    } else if (event.type === "left") {
      setError("對手已離開房間。你可以等待新玩家加入。 ");
    }
  }

  function pauseOverlay(show, message) {
    let overlay = $("online-pause");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "online-pause";
      overlay.className = "online-pause hidden";
      document.body.appendChild(overlay);
    }
    overlay.textContent = message || "對手重新連線中 · 對戰暫停";
    overlay.classList.toggle("hidden", !show);
  }

  function finishOnlineBattle() {
    if (battleResultShown || !room?.battle) return;
    battleResultShown = true;
    battleOpen = false;
    battleEpoch += 1;
    cancelAnimationFrame(timerRaf);
    stopBattleBgm();
    const won = room.battle.winnerSeat === localSeat();
    const winner = won ? localPlayer() : remotePlayer();
    const mine = room.battle.fighters[localSeat()];
    const foe = room.battle.fighters[remoteSeat()];
    const seconds = Math.max(0, (Number(room.battle.completedAt) - Number(room.battle.startedAt)) / 1000);
    const answerSeconds = (fighter, average = false) => {
      const ms = average
        ? (fighter.corrects > 0 ? fighter.totalAnswerMs / fighter.corrects : null)
        : fighter.bestAnswerMs;
      return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : "—";
    };
    const statRow = (label, mineValue, foeValue) => `<li><span>${label}</span><b><span class="tag-p1">你</span> ${mineValue} · <span class="tag-p2">對手</span> ${foeValue}</b></li>`;
    const firstSpecial = room.battle.firstSpecialSeat == null
      ? "本場未開大招"
      : (room.battle.firstSpecialSeat === localSeat() ? "你先開大招" : "對手先開大招");
    const resultRows = [
      statRow("最大連段", mine.maxCombo, foe.maxCombo),
      statRow("最快答題", answerSeconds(mine), answerSeconds(foe)),
      statRow("平均答題", answerSeconds(mine, true), answerSeconds(foe, true)),
      `<li><span>先開大招</span><b>${firstSpecial}</b></li>`,
    ].join("");
    document.querySelectorAll(".btn-again-home").forEach((button) => { button.textContent = "回到房間"; });
    document.querySelectorAll(".btn-again").forEach((button) => { button.textContent = "準備再戰"; });
    setResultScreen(
      won ? "你獲勝！" : "你落敗",
      `${escapeHtml(winner?.name || "玩家")} 贏得對戰 · ${escapeHtml(localPlayer()?.name || "你")} VS ${escapeHtml(remotePlayer()?.name || "對手")} · ${seconds.toFixed(1)} 秒`,
      false,
      resultRows
    );
    playSfx("fanfare", 0.55);
  }

  function onState(nextRoom) {
    const priorPhase = room?.phase;
    room = nextRoom;
    setError("");
    if (room.phase === "playing") {
      if (!active || priorPhase !== "playing") beginOnlineBattle();
      else syncBattleState();
      renderEvent(room.lastEvent);
      pauseOverlay(!room.players.every((player) => player?.connected));
    } else if (room.phase === "complete") {
      if (room.battle) syncBattleState();
      renderEvent(room.lastEvent);
      pauseOverlay(false);
      Promise.resolve(attackQueue).then(finishOnlineBattle);
    } else {
      if (active && priorPhase !== "lobby") {
        battleOpen = false;
        battleEpoch += 1;
        cancelAnimationFrame(timerRaf);
        stopBattleBgm();
        pauseOverlay(false);
        showScreen("online");
      }
      renderLobby();
    }
  }

  function leaveRoom() {
    client.leave();
    room = null;
    active = false;
    battleOpen = false;
    battleEpoch += 1;
    cancelAnimationFrame(timerRaf);
    stopBattleBgm(); stopTts(); hideSpecialStage(); clearBattleFx(); cancelAllDrags();
    pauseOverlay(false);
    document.body.classList.remove("online-battle");
    $("board2")?.removeAttribute("aria-hidden");
    $("online-opponent-status")?.remove();
    document.querySelectorAll(".btn-again-home").forEach((button) => { button.textContent = "回到角色選擇"; });
    document.querySelectorAll(".btn-again").forEach((button) => { button.textContent = "再玩一次"; });
    $("online-lobby")?.classList.add("hidden");
    $("online-entry")?.classList.remove("hidden");
    showScreen("start");
  }

  function enterOnline() {
    showScreen("online");
    setError("");
  }

  client.init({
    onState,
    onConnection(info) {
      connectionStatus = info.status;
      const el = $("online-connection");
      if (el) {
        const labels = { idle: "尚未連線", creating: "建立房間中…", joining: "加入房間中…", connecting: "連線中…", connected: "連線正常", reconnecting: "重新連線中…", disconnected: "連線中斷", closed: "連線已關閉" };
        el.textContent = labels[info.status] || info.status;
        el.classList.toggle("connected", info.status === "connected");
      }
      renderLobby();
    },
    onError(error) { setError(error.message); },
  });

  const characterSelect = $("online-character");
  if (characterSelect) {
    characterSelect.innerHTML = CHARACTERS.map((character) => `<option value="${character.id}">${escapeHtml(character.name)} · ${escapeHtml(character.passive?.label || character.title)}</option>`).join("");
    characterSelect.addEventListener("change", () => renderCharacterCard(characterSelect.value));
    renderCharacterCard(characterSelect.value || "ao");
  }
  bindTap($("btn-online-character-prev"), () => stepCharacter(-1));
  bindTap($("btn-online-character-next"), () => stepCharacter(1));
  bindTap($("btn-mode-online"), enterOnline);
  bindTap($("btn-online-back"), () => { if (room) leaveRoom(); else showScreen("start"); });
  bindTap($("btn-online-create"), async () => {
    setError("");
    const config = configFromUi();
    try { await client.create({ playerName: $("online-name")?.value || "玩家", config, deck: deckForConfig(config) }); } catch {}
  });
  bindTap($("btn-online-join"), async () => {
    setError("");
    try { await client.join({ playerName: $("online-name")?.value || "玩家", code: $("online-code-input")?.value || "" }); } catch {}
  });
  bindTap($("btn-online-copy"), async () => {
    const ok = await client.copyInvite();
    if ($("btn-online-copy")) $("btn-online-copy").textContent = ok ? "已複製" : "請手動複製房號";
  });
  bindTap($("btn-online-leave"), leaveRoom);
  bindTap($("btn-online-ready"), () => {
    const mine = localPlayer();
    primeBattleAudio().catch(() => {});
    getSessionToken().catch(() => {});
    client.ready(pendingCharacterId || $("online-character")?.value || "ao", !mine?.ready);
  });
  ["online-mode", "online-category", "online-maxlen", "online-script", "online-distractors"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      if (!room || room.youSeat !== room.hostSeat || room.phase !== "lobby") return;
      const config = configFromUi();
      client.configure(config, deckForConfig(config));
    });
  });
  $("online-code-input")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  });
  window.KanaBattleOnline = {
    isActive() { return active; },
    handleAction(player, action) {
      if (!active || player !== 1 || room?.phase !== "playing") return;
      if (!room.players.every((entry) => entry?.connected)) { setError("對手重新連線中，對戰暫停。 "); return; }
      if (action === "clear") boards[1].clearAll();
      else if (action === "submit") {
        if (boards[1].slots.some((value) => !value)) { boards[1].setFeedback("還有空格。", "bad"); return; }
        client.submit(localQuestionId, boards[1].slots.map((value) => value?.kana || ""));
      } else if (action === "skip") client.skip();
      else if (action === "attack") client.attack();
      else if (action === "skill-block") client.skill("block");
      else if (action === "skill-heal") client.skill("heal");
      else if (action === "skill-unique") client.skill("unique");
    },
    leaveBattle: leaveRoom,
    returnToLobby() {
      if (!room) return leaveRoom();
      battleResultShown = false;
      client.ready(pendingCharacterId || $("online-character")?.value || localPlayer()?.characterId || "ao", false);
      showScreen("online");
    },
    readyRematch() {
      if (!room) return leaveRoom();
      battleResultShown = false;
      primeBattleAudio().catch(() => {});
      showScreen("online");
      client.ready(pendingCharacterId || $("online-character")?.value || localPlayer()?.characterId || "ao", true);
    },
    replayQuestion() {
      const q = questionById(room?.currentQuestionId);
      if (active && room?.config.mode === "listen" && q) playQuestionAudio(q);
    },
  };

  const invitedRoom = new URL(location.href).searchParams.get("room");
  if (invitedRoom) {
    enterOnline();
    if (!client.resume(invitedRoom)) $("online-code-input").value = invitedRoom.toUpperCase();
  }
})();
