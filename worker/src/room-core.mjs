import "../../questions-data.js";
import "../../questions-expansion-data.js";

export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_HP = 2400;

const MAX_NAME_LENGTH = 16;
const MAX_DECK_SIZE = 500;
const LISTEN_START_LEAD_MS = 3200;
const LISTEN_NEXT_LEAD_MS = 2200;
const LISTEN_SPECIAL_LEAD_MS = 10800;
const VALID_CHARACTERS = new Set(["ao", "rin", "ya", "go", "ran", "gen", "sho", "yo"]);
const VALID_CATEGORIES = new Set(["all", "daily", "action", "school_work", "food", "household", "clothing", "health", "places_transport", "shopping_numbers", "time_nature", "animals", "description", "loanword", "anime", "fantasy_battle"]);
const CANONICAL_QUESTIONS = new Map(
  (globalThis.KANA_QUESTIONS || []).map((question) => [question.id, question]),
);
const CHARACTER_RULES = {
  ao: { gaugePerCorrect: 2, active: "submit_lock" },
  rin: { chargeMult: 0.9, specialMult: 1.9, active: "steal" },
  ya: { active: "attack_lock" },
  go: { hitBonus: 2, active: "amp" },
  ran: { chargeMult: 1.12, active: "wind_step" },
  gen: { hitBonus: 1, active: "submit_lock" },
  sho: { active: "attack_lock" },
  yo: { chargeMult: 0.92, specialMult: 1.7, active: "steal" },
};

function cleanText(value, maxLength = 80) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function sanitizePlayerName(value, fallback = "玩家") {
  const clean = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(clean).slice(0, MAX_NAME_LENGTH).join("") || fallback;
}

export function sanitizeRoomCode(value) {
  return cleanText(value, 8).toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function sanitizeConfig(input = {}) {
  const mode = input.mode === "listen" ? "listen" : "race";
  const script = ["all", "hira", "kata"].includes(input.script) ? input.script : "all";
  const maxLen = [0, 4, 5, 8].includes(Number(input.maxLen)) ? Number(input.maxLen) : 0;
  const category = VALID_CATEGORIES.has(input.category) ? input.category : "all";
  return { mode, script, maxLen, category, distractors: input.distractors !== false };
}

function scriptOfSequence(sequence) {
  let hira = 0;
  let kata = 0;
  (sequence || []).forEach((part) => {
    for (const character of part) {
      const code = character.codePointAt(0);
      if (code >= 0x3041 && code <= 0x3096) hira += 1;
      else if (code >= 0x30A1 && code <= 0x30FA) kata += 1;
    }
  });
  if (hira && !kata) return "hira";
  if (kata && !hira) return "kata";
  return "mixed";
}

function questionsForConfig(config) {
  const all = [...CANONICAL_QUESTIONS.values()];
  let list = all;
  if (config.category !== "all") list = list.filter((question) => question.category === config.category);
  if (config.maxLen > 0) list = list.filter((question) => question.kanaSequence.length <= config.maxLen);
  if (config.script === "hira" || config.script === "kata") {
    list = list.filter((question) => scriptOfSequence(question.kanaSequence) === config.script);
  }
  if (list.length) return list;

  list = config.category === "all"
    ? all
    : all.filter((question) => question.category === config.category);
  if (config.maxLen > 0) {
    const limited = list.filter((question) => question.kanaSequence.length <= config.maxLen);
    if (limited.length) list = limited;
  }
  return list;
}

export function sanitizeDeck(input, configInput = {}) {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_DECK_SIZE) {
    throw new Error("INVALID_DECK");
  }
  const config = sanitizeConfig(configInput);
  const allowedIds = new Set(questionsForConfig(config).map((question) => question.id));
  if (input.length !== allowedIds.size) throw new Error("INVALID_DECK");
  const seen = new Set();
  return input.map((entry) => {
    const id = cleanText(entry?.id, 80);
    const canonical = CANONICAL_QUESTIONS.get(id);
    const answer = canonical?.kanaSequence?.map((part) => cleanText(part, 8)).filter(Boolean).slice(0, 16) || [];
    if (!id || !allowedIds.has(id) || seen.has(id) || !answer.length) throw new Error("INVALID_DECK");
    seen.add(id);
    return { id, answer };
  });
}

function bump(room, now = Date.now()) {
  room.version += 1;
  room.lastActiveAt = now;
}

function hostSeat(room) {
  if (Number.isInteger(room.hostSeat) && room.players[room.hostSeat]) return room.hostSeat;
  return room.players.findIndex(Boolean);
}

function blankFighter(now) {
  return {
    hp: MAX_HP,
    qi: 0,
    charge: 0,
    combo: 0,
    gauge: 0,
    ampHits: 0,
    blockUntil: 0,
    submitLockUntil: 0,
    attackLockUntil: 0,
    corrects: 0,
    mistakes: 0,
    maxCombo: 0,
    bestAnswerMs: null,
    totalAnswerMs: 0,
    questionStartedAt: now,
  };
}

function startBattle(room, now = Date.now()) {
  room.phase = "playing";
  room.battle = {
    fighters: [blankFighter(now), blankFighter(now)],
    sharedQi: 0,
    listenClaimed: false,
    startedAt: now,
    completedAt: null,
    winnerSeat: null,
    firstSpecialSeat: null,
    listenCueSeq: 0,
    listenCue: null,
  };
  scheduleListenCue(room, now, LISTEN_START_LEAD_MS);
  room.eventSeq += 1;
  room.lastEvent = { id: room.eventSeq, type: "start", at: now };
}

function resetLobby(room) {
  room.phase = "lobby";
  room.battle = null;
  room.players.forEach((player) => {
    if (player) player.ready = false;
  });
}

export function createRoomState({ roomCode, hostName, hostToken, config, deck, now = Date.now() }) {
  const nextConfig = sanitizeConfig(config);
  return {
    roomCode: sanitizeRoomCode(roomCode),
    version: 1,
    phase: "lobby",
    hostSeat: 0,
    config: nextConfig,
    deck: sanitizeDeck(deck, nextConfig),
    players: [{
      name: sanitizePlayerName(hostName, "房主"),
      token: hostToken,
      connected: false,
      ready: false,
      characterId: "ao",
      lastActionId: "",
      leftAt: null,
    }, null],
    battle: null,
    eventSeq: 0,
    lastEvent: null,
    createdAt: now,
    lastActiveAt: now,
  };
}

export function seatForToken(room, token) {
  if (!room || !token) return -1;
  return room.players.findIndex((player) => player?.token === token);
}

export function joinRoom(room, { name, token, now = Date.now() }) {
  if (!room || room.phase !== "lobby") return { ok: false, error: "ROOM_ALREADY_STARTED" };
  const existing = seatForToken(room, token);
  if (existing >= 0) return { ok: true, seat: existing, reconnected: true };
  const seat = room.players.findIndex((player) => !player);
  if (seat < 0) return { ok: false, error: "ROOM_FULL" };
  room.players[seat] = {
    name: sanitizePlayerName(name, `玩家 ${seat + 1}`),
    token,
    connected: false,
    ready: false,
    characterId: seat === 0 ? "ao" : "rin",
    lastActionId: "",
    leftAt: null,
  };
  if (hostSeat(room) < 0) room.hostSeat = seat;
  bump(room, now);
  return { ok: true, seat, reconnected: false };
}

export function setConnected(room, seat, connected, now = Date.now()) {
  const player = room?.players?.[seat];
  if (!player || player.connected === connected) return false;
  player.connected = connected;
  bump(room, now);
  return true;
}

export function leaveRoom(room, seat, now = Date.now()) {
  if (!room?.players?.[seat]) return { ok: false, error: "INVALID_SESSION" };
  const wasHost = hostSeat(room) === seat;
  room.players[seat] = null;
  if (wasHost) room.hostSeat = room.players.findIndex(Boolean);
  resetLobby(room);
  room.eventSeq += 1;
  room.lastEvent = { id: room.eventSeq, type: "left", seat, at: now };
  bump(room, now);
  return { ok: true };
}

export function configureRoom(room, seat, config, deck, now = Date.now()) {
  if (!room || room.phase !== "lobby") return { ok: false, error: "NOT_IN_LOBBY" };
  if (seat !== hostSeat(room)) return { ok: false, error: "ONLY_HOST_CAN_CONFIGURE" };
  try {
    const nextConfig = sanitizeConfig(config);
    const nextDeck = sanitizeDeck(deck || room.deck, nextConfig);
    room.config = nextConfig;
    room.deck = nextDeck;
  } catch (error) {
    return { ok: false, error: error.message || "INVALID_CONFIG" };
  }
  room.players.forEach((player) => { if (player) player.ready = false; });
  bump(room, now);
  return { ok: true };
}

export function setReady(room, seat, { ready = true, characterId }, now = Date.now()) {
  if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
  if (room.phase === "complete") resetLobby(room);
  if (room.phase !== "lobby") return { ok: false, error: "NOT_IN_LOBBY" };
  const player = room.players[seat];
  if (!player) return { ok: false, error: "INVALID_SESSION" };
  if (!player.connected) return { ok: false, error: "PLAYER_NOT_CONNECTED" };
  const nextCharacterId = VALID_CHARACTERS.has(characterId) ? characterId : player.characterId;
  const other = room.players[seat === 0 ? 1 : 0];
  if (ready && other?.characterId === nextCharacterId) return { ok: false, error: "CHARACTER_TAKEN" };
  player.characterId = nextCharacterId;
  player.ready = ready !== false;
  bump(room, now);
  if (room.players.every((entry) => entry?.connected && entry.ready)) {
    startBattle(room, now);
    bump(room, now);
    return { ok: true, started: true };
  }
  return { ok: true, started: false };
}

function rulesFor(room, seat) {
  return CHARACTER_RULES[room.players[seat]?.characterId] || {};
}

function ensurePlayable(room, seat) {
  if (!room?.battle || room.phase !== "playing") return { ok: false, error: "GAME_NOT_ACTIVE" };
  if (!room.players.every((player) => player?.connected)) return { ok: false, error: "OPPONENT_UNAVAILABLE" };
  if (!room.players[seat]) return { ok: false, error: "INVALID_SESSION" };
  return { ok: true };
}

function questionAt(room, seat) {
  const battle = room.battle;
  const index = room.config.mode === "listen" ? battle.sharedQi : battle.fighters[seat].qi;
  return room.deck[index % room.deck.length];
}

function scheduleListenCue(room, now, delayMs) {
  if (room.config.mode !== "listen" || !room.battle) return;
  const question = questionAt(room, 0);
  if (!question) return;
  room.battle.listenCueSeq += 1;
  room.battle.listenCue = {
    seq: room.battle.listenCueSeq,
    questionId: question.id,
    playAt: now + Math.max(0, delayMs),
  };
}

function chargeGain(room, seat, answerLength) {
  const fighter = room.battle.fighters[seat];
  const base = 58 + answerLength * 6;
  const comboMult = 1 + Math.max(0, fighter.combo - 1) * 0.08;
  let gain = Math.max(40, Math.round(base * comboMult));
  const multiplier = rulesFor(room, seat).chargeMult;
  if (multiplier != null) gain = Math.max(36, Math.round(gain * multiplier));
  return gain;
}

function finishIfNeeded(room, now) {
  const loser = room.battle.fighters.findIndex((fighter) => fighter.hp <= 0);
  if (loser < 0) return false;
  room.phase = "complete";
  room.battle.completedAt = now;
  room.battle.winnerSeat = loser === 0 ? 1 : 0;
  room.players.forEach((player) => { if (player) player.ready = false; });
  return true;
}

function setEvent(room, event, now) {
  room.eventSeq += 1;
  room.lastEvent = { id: room.eventSeq, at: now, ...event };
}

function performAttack(room, seat, now, automatic = false, questionId = "") {
  const fighter = room.battle.fighters[seat];
  const foeSeat = seat === 0 ? 1 : 0;
  const foe = room.battle.fighters[foeSeat];
  if (fighter.attackLockUntil > now) return { ok: false, error: "ATTACK_LOCKED" };
  if (fighter.charge <= 0) return { ok: false, error: "NO_CHARGE" };
  const rules = rulesFor(room, seat);
  const special = fighter.gauge >= 8;
  if (special && room.battle.firstSpecialSeat == null) room.battle.firstSpecialSeat = seat;
  let damage = fighter.charge;
  if (special) damage = Math.round(damage * (rules.specialMult || 1.55));
  const hits = Math.max(1, fighter.combo + (rules.hitBonus || 0) + fighter.ampHits);
  damage = Math.round(damage * (1 + (hits - 1) * 0.05));
  const guarded = foe.blockUntil > now;
  if (guarded) {
    damage = Math.max(1, Math.round(damage * 0.5));
    foe.blockUntil = 0;
  }
  fighter.charge = 0;
  if (!automatic) fighter.combo = 0;
  fighter.ampHits = 0;
  if (special) fighter.gauge = 0;
  foe.hp = Math.max(0, foe.hp - damage);
  const event = { type: "attack", seat, foeSeat, damage, hits, special, guarded, automatic };
  if (questionId) event.questionId = questionId;
  setEvent(room, event, now);
  finishIfNeeded(room, now);
  return { ok: true, event };
}

export function applySubmit(room, seat, { questionId, answer }, now = Date.now()) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  const fighter = room.battle.fighters[seat];
  if (fighter.submitLockUntil > now) return { ok: false, error: "SUBMIT_LOCKED" };
  const question = questionAt(room, seat);
  if (!question || question.id !== cleanText(questionId, 80)) return { ok: false, error: "STALE_QUESTION" };
  if (room.config.mode === "listen") {
    if (room.battle.listenClaimed) return { ok: false, error: "ROUND_ALREADY_CLAIMED" };
    if (now < Number(room.battle.listenCue?.playAt || 0)) return { ok: false, error: "ROUND_NOT_STARTED" };
  }
  const submitted = Array.isArray(answer) ? answer.map((part) => cleanText(part, 8)).slice(0, 16) : [];
  const wrong = question.answer.reduce((count, part, index) => count + (submitted[index] === part ? 0 : 1), 0);
  if (submitted.length !== question.answer.length || wrong > 0) {
    const totalWrong = Math.max(wrong, Math.abs(submitted.length - question.answer.length), 1);
    const damage = totalWrong * 72;
    fighter.combo = 0;
    fighter.mistakes = (fighter.mistakes || 0) + 1;
    fighter.hp = Math.max(0, fighter.hp - damage);
    setEvent(room, { type: "miss", seat, damage, wrong: totalWrong, questionId: question.id }, now);
    finishIfNeeded(room, now);
    bump(room, now);
    return { ok: true, correct: false };
  }
  fighter.combo += 1;
  fighter.maxCombo = Math.max(fighter.maxCombo, fighter.combo);
  fighter.corrects += 1;
  const answerStartedAt = room.config.mode === "listen"
    ? Number(room.battle.listenCue?.playAt)
    : Number(fighter.questionStartedAt);
  const answerMs = Math.max(0, now - (Number.isFinite(answerStartedAt) ? answerStartedAt : now));
  fighter.bestAnswerMs = fighter.bestAnswerMs == null ? answerMs : Math.min(fighter.bestAnswerMs, answerMs);
  fighter.totalAnswerMs += answerMs;
  fighter.gauge += rulesFor(room, seat).gaugePerCorrect || 1;
  const gain = chargeGain(room, seat, question.answer.length);
  fighter.charge += gain;
  if (room.config.mode === "listen") {
    room.battle.listenClaimed = true;
    const attack = performAttack(room, seat, now, true, question.id);
    if (!attack.ok) return attack;
    if (room.phase === "playing") {
      room.battle.sharedQi += 1;
      room.battle.listenClaimed = false;
      const cueDelay = attack.event.special
        ? LISTEN_SPECIAL_LEAD_MS
        : Math.max(LISTEN_NEXT_LEAD_MS, 900 + Math.min(8, attack.event.hits) * 280);
      scheduleListenCue(room, now, cueDelay);
    }
  } else {
    fighter.qi += 1;
    fighter.questionStartedAt = now;
    setEvent(room, { type: "correct", seat, gain, questionId: question.id }, now);
  }
  bump(room, now);
  return { ok: true, correct: true };
}

export function applySkip(room, seat, now = Date.now()) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  if (room.config.mode === "listen") return { ok: false, error: "SKIP_NOT_ALLOWED" };
  const fighter = room.battle.fighters[seat];
  fighter.combo = 0;
  fighter.qi += 1;
  fighter.questionStartedAt = now;
  setEvent(room, { type: "skip", seat }, now);
  bump(room, now);
  return { ok: true };
}

export function applyAttack(room, seat, now = Date.now()) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  if (room.config.mode === "listen") return { ok: false, error: "AUTO_ATTACK_MODE" };
  const result = performAttack(room, seat, now, false);
  if (result.ok) bump(room, now);
  return result;
}

export function applySkill(room, seat, skill, now = Date.now()) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  const fighter = room.battle.fighters[seat];
  const foe = room.battle.fighters[seat === 0 ? 1 : 0];
  const spend = (cost) => {
    if (fighter.combo < cost) return false;
    fighter.combo -= cost;
    return true;
  };
  if (skill === "block") {
    if (!spend(1)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
    fighter.blockUntil = now + 2000;
  } else if (skill === "heal") {
    if (fighter.hp >= MAX_HP) return { ok: false, error: "HP_FULL" };
    if (!spend(2)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
    fighter.hp = Math.min(MAX_HP, fighter.hp + 200);
  } else if (skill === "unique") {
    if (!spend(2)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
    const active = rulesFor(room, seat).active;
    if (active === "submit_lock") foe.submitLockUntil = now + 5000;
    else if (active === "attack_lock") foe.attackLockUntil = now + 4000;
    else if (active === "steal") {
      if (foe.charge <= 0) { fighter.combo += 2; return { ok: false, error: "NO_TARGET_CHARGE" }; }
      const stolen = Math.min(foe.charge, Math.max(40, Math.round(foe.charge * 0.2)));
      foe.charge -= stolen;
      fighter.charge += stolen;
    } else if (active === "amp") {
      if (fighter.ampHits > 0) { fighter.combo += 2; return { ok: false, error: "AMP_ALREADY_READY" }; }
      fighter.ampHits = 5;
    } else if (active === "wind_step") {
      fighter.submitLockUntil = 0;
      fighter.attackLockUntil = 0;
      fighter.blockUntil = now + 3000;
    }
  } else {
    return { ok: false, error: "UNKNOWN_SKILL" };
  }
  setEvent(room, { type: "skill", seat, skill }, now);
  bump(room, now);
  return { ok: true };
}

export function publicRoomState(room, youSeat) {
  const battle = room.battle && {
    ...room.battle,
    fighters: room.battle.fighters.map((fighter, seat) => {
      const visible = { ...fighter };
      if (seat !== youSeat) delete visible.qi;
      return visible;
    }),
  };
  const currentQuestionId = room.battle && room.players[youSeat]
    ? questionAt(room, youSeat)?.id || null
    : null;
  return {
    roomCode: room.roomCode,
    version: room.version,
    phase: room.phase,
    hostSeat: hostSeat(room),
    youSeat,
    config: room.config,
    currentQuestionId,
    players: room.players.map((player) => player && ({
      name: player.name,
      connected: player.connected,
      ready: player.ready,
      characterId: player.characterId,
    })),
    battle,
    lastEvent: room.lastEvent,
    serverNow: Date.now(),
  };
}

export function roomExpired(room, now = Date.now()) {
  return !room || now - room.lastActiveAt >= ROOM_TTL_MS;
}
