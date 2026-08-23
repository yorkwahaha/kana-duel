/* global $, ALL_QUESTIONS, CHARACTERS, MAX_HP, boards, categoryLabelOf, selectBattleQuestions */
/* global battleOpts:writable, battleDeck:writable, battleOpen:writable, battleEpoch:writable */
/* global battleStartedAt:writable, charge:writable, combo:writable, gaugeHits:writable, hp:writable, showAnswerGain */
/* global ampHits:writable, blockUntil:writable, submitLockUntil:writable, attackLockUntil:writable */
/* global pickP1:writable, pickP2:writable, gameMode:writable, playerQi:writable, sharedQi:writable */
/* global listenRoundClaimed:writable, battleStats:writable, attackQueue:writable, timerRaf */
/* global bindTap, cancelAllDrags, clearBattleFx, clearSkillTimers, hideSpecialStage, noteQuestionOpen */
/* global getSessionToken, preloadBattleSfx, prepareQuestionAudio, primeBattleAudio, scheduleQuestionAudio, speakQuestionAudio */
/* global fxThemeOf, playAttackBolt, playBlockActivate, playCastBurst, playHitSfx, playSfx, setFighterPose, setResultScreen */
/* global showCombo, showDmgFloat, showScreen, showWordReveal, spawnHitBurst, startBattleBgm, stopBattleBgm, stopTts */
/* global startCharacterSelectBgm, stopCharacterSelectBgm */
/* global syncFighterPassive, tickBattleClock, updateHpUi, updatePlayerMeters, updateSkillUi, ensureCastLayers, preloadFighterPoses */
/* global MAX_ATTACK_SEGMENTS, playSpecialAftermath, playSpecialUltimate, prefersReducedMotion, shakeBattle */
/* global spawnBlockParry, splitComboDamage, wait, playBattleDefeatOutro */
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
  let submitPending = false;
  let pendingCharacterId = "";
  let battleIntroPending = false;
  let battleIntroTimer = 0;

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
    const list = selectBattleQuestions(config).slice();
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.map((q) => ({ id: q.id }));
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
    startCharacterSelectBgm().catch(() => {});
    playSfx("sfx_click", 0.3);
    renderCharacterCard(next.id);
  }

  function setInviteMode(enabled, code = "") {
    const inviteMode = !!enabled;
    $("screen-online")?.classList.toggle("invite-mode", inviteMode);
    if ($("online-name-label")) $("online-name-label").textContent = inviteMode ? "輸入你的名稱" : "你的名稱";
    if ($("btn-online-create")) {
      $("btn-online-create").disabled = inviteMode;
      $("btn-online-create").textContent = inviteMode ? "新建房間" : "建立房間";
    }
    if ($("online-code-input")) {
      if (code) $("online-code-input").value = code.toUpperCase();
      $("online-code-input").disabled = inviteMode;
    }
    $("btn-online-invite-exit")?.classList.toggle("hidden", !inviteMode);
    if (inviteMode) stopCharacterSelectBgm();
  }

  function renderLobby() {
    if (!room || room.phase !== "lobby") return;
    setInviteMode(false);
    $("online-entry")?.classList.add("hidden");
    $("online-lobby")?.classList.remove("hidden");
    if ($("btn-online-copy")) {
      $("btn-online-copy").textContent = "複製邀請連結";
      $("btn-online-copy").setAttribute("aria-label", `複製房間 ${room.roomCode} 的邀請連結`);
    }
    startCharacterSelectBgm().catch(() => {});
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
        if (!player) return `<div class="online-player online-player-empty"><div><strong>等待玩家</strong><span>尚未選角</span><span>等待加入</span></div></div>`;
        const character = characterById(player.characterId, seat);
        const playerLabel = `${player.name}${seat === room.hostSeat ? "（房主）" : ""}`;
        const status = player.connected ? (player.ready ? "✓ 已準備" : "選角中") : "重新連線中";
        return `<div class="online-player${player.ready ? " ready" : ""}"><img src="${escapeHtml(character?.image || "assets/characters/ao.webp")}" alt="" /><div><strong>${escapeHtml(playerLabel)}</strong><span>${escapeHtml(character?.name || "未選角")}</span><span>${status}</span></div></div>`;
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

  function setSubmitPending(pending) {
    submitPending = !!pending;
    const button = $("btn-submit-1");
    if (!button) return;
    button.classList.toggle("is-pending", submitPending);
    button.setAttribute("aria-busy", submitPending ? "true" : "false");
    if (submitPending) {
      button.disabled = true;
      button.textContent = "判定中…";
    }
    else updateSkillUi(1);
  }

  function loadOnlineQuestion(force = false) {
    if (!room?.battle) return;
    const localId = room.currentQuestionId;
    const localQ = questionById(localId);
    if (localQ && (force || localQuestionId !== localId)) {
      if (localQuestionId !== localId) setSubmitPending(false);
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
    battleIntroPending = false;
    stopCharacterSelectBgm();
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
    setSubmitPending(false);
    cancelAllDrags();
    clearBattleFx();
    clearSkillTimers(1); clearSkillTimers(2);
    $("fighter1-img").src = pickP1.image;
    $("fighter2-img").src = pickP2.image;
    $("hp1-name").textContent = localPlayer()?.name || "我方";
    $("hp2-name").textContent = remotePlayer()?.name || "對手";
    preloadFighterPoses(pickP1); preloadFighterPoses(pickP2);
    $("fighter1")?.classList.remove("defeated", "hit", "hit-strong", "attacking", "blocking");
    $("fighter2")?.classList.remove("defeated", "hit", "hit-strong", "attacking", "blocking");
    document.querySelector(".duel-stage")?.classList.remove("ko-hold");
    syncFighterPassive(1); syncFighterPassive(2); ensureCastLayers();
    $("board2")?.setAttribute("aria-hidden", "true");
    document.querySelector(".duel-stage")?.classList.toggle("listen-mode", room.config.mode === "listen");
    $("btn-battle-listen")?.classList.toggle("hidden", room.config.mode !== "listen");
    if ($("rule-chip")) $("rule-chip").textContent = `${room.config.mode === "listen" ? "聽力搶答" : "競速"} · ${categoryLabelOf(room.config.category)}`;
    showScreen("battle");
    syncBattleState();
    battleStartedAt = performance.now() - Math.max(0, Number(room.serverNow) - Number(room.battle.startedAt));
    cancelAnimationFrame(timerRaf); tickBattleClock();
    startBattleBgm().catch(() => {});
  }

  function clearOnlineBattleIntro() {
    clearTimeout(battleIntroTimer);
    battleIntroTimer = 0;
    battleIntroPending = false;
    const stage = $("vs-stage");
    stage?.classList.remove("show", "online-vs");
    stage?.setAttribute("aria-hidden", "true");
  }

  function playOnlineVsIntro() {
    if (!room || battleIntroPending || active) return;
    battleIntroPending = true;
    stopCharacterSelectBgm();
    const minePlayer = localPlayer();
    const foePlayer = remotePlayer();
    const mineCharacter = characterById(minePlayer?.characterId, 0);
    const foeCharacter = characterById(foePlayer?.characterId, 1);
    const snapshot = {
      mine: {
        image: mineCharacter?.image || "",
        label: `${minePlayer?.name || "我方"} · ${mineCharacter?.name || ""}`,
      },
      foe: {
        image: foeCharacter?.image || "",
        label: `${foePlayer?.name || "對手"} · ${foeCharacter?.name || ""}`,
      },
      rule: room.config.mode === "listen" ? "LISTEN DUEL" : "SPEED DUEL",
    };
    const stage = $("vs-stage");
    const mineImage = $("online-vs-mine-image");
    const foeImage = $("online-vs-foe-image");
    const mineName = $("online-vs-mine-name");
    const foeName = $("online-vs-foe-name");
    const rule = $("online-vs-rule");
    if (!stage || !mineImage || !foeImage || !mineName || !foeName || !rule) {
      battleIntroPending = false;
      beginOnlineBattle();
      return;
    }
    mineImage.src = snapshot.mine.image;
    mineImage.alt = snapshot.mine.label;
    foeImage.src = snapshot.foe.image;
    foeImage.alt = snapshot.foe.label;
    mineName.textContent = snapshot.mine.label;
    foeName.textContent = snapshot.foe.label;
    rule.textContent = snapshot.rule;
    stage?.classList.remove("show");
    stage?.classList.add("online-vs");
    void stage?.offsetWidth;
    stage?.classList.add("show");
    stage?.setAttribute("aria-hidden", "false");
    playSfx("fanfare", 0.35);
    battleIntroTimer = setTimeout(() => {
      clearOnlineBattleIntro();
      if (room?.phase === "playing") beginOnlineBattle();
    }, prefersReducedMotion() ? 600 : 3000);
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
    if (player === 1 && ["correct", "miss", "attack"].includes(event.type)) setSubmitPending(false);
    if (event.type === "correct") {
      boards[player]?.setFeedback("");
      showAnswerGain(player, player === 1 ? `答對 · +${event.gain}` : "對手答對");
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

  async function finishOnlineBattle() {
    if (battleResultShown || !room?.battle) return;
    battleResultShown = true;
    const won = room.battle.winnerSeat === localSeat();
    const mine = room.battle.fighters[localSeat()];
    const foe = room.battle.fighters[remoteSeat()];
    const seconds = Math.max(0, (Number(room.battle.completedAt) - Number(room.battle.startedAt)) / 1000);
    const answerSeconds = (fighter, average = false) => {
      const ms = average
        ? (fighter.corrects > 0 ? fighter.totalAnswerMs / fighter.corrects : null)
        : fighter.bestAnswerMs;
      return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : "—";
    };
    const statRow = (label, mineValue, foeValue) => `<li><span class="stat-label">${label}</span><span class="stat-value stat-mine"><small>你</small><b>${escapeHtml(String(mineValue))}</b></span><span class="stat-value stat-foe"><small>對手</small><b>${escapeHtml(String(foeValue))}</b></span></li>`;
    const resultRows = [
      statRow("最大連段", mine.maxCombo, foe.maxCombo),
      statRow("最快答題", answerSeconds(mine), answerSeconds(foe)),
      statRow("平均答題", answerSeconds(mine, true), answerSeconds(foe, true)),
      statRow("錯誤次數", mine.mistakes || 0, foe.mistakes || 0),
    ].join("");
    try {
      await playBattleDefeatOutro(won ? 2 : 1, won ? 1 : 2);
    } catch (error) {
      console.error("Online defeat outro failed", error);
    }
    document.querySelectorAll(".btn-again-home").forEach((button) => { button.textContent = "離開對戰"; });
    document.querySelectorAll(".btn-again").forEach((button) => { button.textContent = "準備再戰"; });
    setResultScreen(
      won ? "你獲勝！" : "你落敗",
      `對戰時間 ${seconds.toFixed(1)} 秒`,
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
      if (!active && !battleIntroPending) {
        if (priorPhase === "lobby") playOnlineVsIntro();
        else beginOnlineBattle();
      } else if (active) syncBattleState();
      if (active) {
        renderEvent(room.lastEvent);
        pauseOverlay(!room.players.every((player) => player?.connected));
      }
    } else if (room.phase === "complete") {
      if (room.battle) syncBattleState();
      renderEvent(room.lastEvent);
      pauseOverlay(false);
      Promise.resolve(attackQueue).then(() => finishOnlineBattle()).catch((error) => {
        console.error("Online battle completion failed", error);
      });
    } else {
      if (active && priorPhase !== "lobby") {
        active = false;
        battleOpen = false;
        battleEpoch += 1;
        cancelAnimationFrame(timerRaf);
        stopBattleBgm();
        pauseOverlay(false);
        document.body.classList.remove("online-battle");
        $("board2")?.removeAttribute("aria-hidden");
        showScreen("online");
      }
      renderLobby();
    }
  }

  function leaveRoom() {
    clearOnlineBattleIntro();
    client.leave();
    room = null;
    active = false;
    battleOpen = false;
    battleEpoch += 1;
    cancelAnimationFrame(timerRaf);
    stopBattleBgm(); stopCharacterSelectBgm(); stopTts(); hideSpecialStage(); clearBattleFx(); cancelAllDrags();
    pauseOverlay(false);
    document.body.classList.remove("online-battle");
    $("board2")?.removeAttribute("aria-hidden");
    $("online-opponent-status")?.remove();
    document.querySelectorAll(".btn-again-home").forEach((button) => { button.textContent = "回到角色選擇"; });
    document.querySelectorAll(".btn-again").forEach((button) => { button.textContent = "再玩一次"; });
    $("online-lobby")?.classList.add("hidden");
    $("online-entry")?.classList.remove("hidden");
    setInviteMode(false);
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
      if (room?.phase === "lobby") renderLobby();
    },
    onError(error) { setSubmitPending(false); setError(error.message); },
  });

  const characterSelect = $("online-character");
  if (characterSelect) {
    characterSelect.innerHTML = CHARACTERS.map((character) => `<option value="${character.id}">${escapeHtml(character.name)} · ${escapeHtml(character.passive?.label || character.title)}</option>`).join("");
    characterSelect.addEventListener("change", () => {
      startCharacterSelectBgm().catch(() => {});
      playSfx("sfx_click", 0.3);
      renderCharacterCard(characterSelect.value);
    });
    renderCharacterCard(characterSelect.value || "ao");
  }
  bindTap($("btn-online-character-prev"), () => stepCharacter(-1));
  bindTap($("btn-online-character-next"), () => stepCharacter(1));
  bindTap($("btn-mode-online"), () => { setInviteMode(false); enterOnline(); });
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
    const button = $("btn-online-copy");
    if (button) {
      button.classList.toggle("copied", ok);
      button.textContent = ok ? "已複製" : "複製失敗";
      button.setAttribute("aria-label", ok ? `房間 ${room?.roomCode || ""} 的邀請連結已複製` : "無法複製邀請連結");
      setTimeout(() => {
        button.classList.remove("copied");
        button.textContent = "複製邀請連結";
      }, 1200);
    }
  });
  bindTap($("btn-online-invite-exit"), () => {
    client.leave();
    setInviteMode(false);
    showScreen("start");
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
    isSubmitPending() { return active && submitPending; },
    handleAction(player, action) {
      if (!active || player !== 1 || room?.phase !== "playing") return;
      if (!room.players.every((entry) => entry?.connected)) { setError("對手重新連線中，對戰暫停。 "); return; }
      if (action === "clear") boards[1].clearAll();
      else if (action === "submit") {
        if (submitPending) return;
        if (boards[1].slots.some((value) => !value)) { boards[1].setFeedback("還有空格。", "bad"); return; }
        setSubmitPending(true);
        boards[1].setFeedback("判定中…");
        if (!client.submit(localQuestionId, boards[1].slots.map((value) => value?.kana || ""))) {
          setSubmitPending(false);
        }
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
    replayQuestion() {
      const q = questionById(room?.currentQuestionId);
      if (active && room?.config.mode === "listen" && q) speakQuestionAudio(q);
    },
  };

  const invitedRoom = new URL(location.href).searchParams.get("room");
  if (invitedRoom) {
    enterOnline();
    if (!client.resume(invitedRoom)) setInviteMode(true, invitedRoom);
  }
})();
