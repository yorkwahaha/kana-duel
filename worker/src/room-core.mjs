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
  ao: { active: "disrupt", cost: 3 },
  rin: { active: "steal", cost: 2 },
  ya: { active: "reflect", cost: 2 },
  go: { active: "boost", cost: 2 },
  ran: { active: "mistake_guard", cost: 1 },
  gen: { active: "dodge", cost: 2 },
  sho: { active: "combo_drain", cost: 3 },
  yo: { active: "regen", cost: 2 },
};
const SPECIAL_MULT = 1.5;
const ATTACK_BOOST_MULT = 1.2;
const REFLECT_RATIO = 0.5;
const REGEN_TICK_MS = 3000;
const REGEN_TICKS = 10;
const REGEN_HEAL = Math.round(MAX_HP * 0.015);

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
  const mode = ["listen", "zh-race"].includes(input.mode) ? input.mode : "race";
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
  const eligible = config.mode === "zh-race"
    ? all.filter((question) => typeof question.zh === "string" && question.zh.trim())
    : all;
  let list = eligible;
  if (config.category !== "all") list = list.filter((question) => question.category === config.category);
  if (config.maxLen > 0) list = list.filter((question) => question.kanaSequence.length <= config.maxLen);
  if (config.script === "hira" || config.script === "kata") {
    list = list.filter((question) => scriptOfSequence(question.kanaSequence) === config.script);
  }
  if (list.length) return list;

  list = config.category === "all"
    ? eligible
    : eligible.filter((question) => question.category === config.category);
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
    attackBoost: 1,
    blockReady: false,
    reflectReady: false,
    mistakeGuardReady: false,
    dodgeChance: 0,
    boardDisruptSeq: 0,
    boardDisruptQuestionId: "",
    lastDisruptedQuestionKey: "",
    regenTicksLeft: 0,
    regenNextAt: 0,
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
    regenPauseStartedAt: 0,
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
  if (!connected && room.phase === "playing" && room.battle && !room.battle.regenPauseStartedAt) {
    room.battle.regenPauseStartedAt = now;
  }
  player.connected = connected;
  if (connected && room.phase === "playing" && room.battle?.regenPauseStartedAt
      && room.players.every((entry) => entry?.connected)) {
    const pausedFor = Math.max(0, now - room.battle.regenPauseStartedAt);
    room.battle.fighters.forEach((fighter) => {
      if (fighter.regenTicksLeft > 0 && fighter.regenNextAt > 0) fighter.regenNextAt += pausedFor;
    });
    room.battle.regenPauseStartedAt = 0;
  }
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

function questionKey(room, seat) {
  const battle = room.battle;
  const index = room.config.mode === "listen" ? battle.sharedQi : battle.fighters[seat].qi;
  return room.config.mode + ":" + index + ":" + (questionAt(room, seat)?.id || "question");
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
  return Math.max(40, Math.round(base * comboMult));
}

export function nextTimedEffectAt(room) {
  if (!room?.battle || room.phase !== "playing" || room.battle.regenPauseStartedAt
      || !room.players.every((player) => player?.connected)) return 0;
  const times = room.battle.fighters
    .filter((fighter) => fighter.regenTicksLeft > 0 && fighter.regenNextAt > 0)
    .map((fighter) => fighter.regenNextAt);
  return times.length ? Math.min(...times) : 0;
}

export function settleTimedEffects(room, now = Date.now()) {
  if (!room?.battle || room.phase !== "playing" || room.battle.regenPauseStartedAt
      || !room.players.every((player) => player?.connected)) return [];
  const heals = [];
  room.battle.fighters.forEach((fighter, seat) => {
    let applied = 0;
    let amount = 0;
    while (fighter.regenTicksLeft > 0 && fighter.regenNextAt > 0 && fighter.regenNextAt <= now) {
      const before = fighter.hp;
      fighter.hp = Math.min(MAX_HP, fighter.hp + REGEN_HEAL);
      amount += fighter.hp - before;
      fighter.regenTicksLeft -= 1;
      fighter.regenNextAt += REGEN_TICK_MS;
      applied += 1;
    }
    if (fighter.regenTicksLeft <= 0) fighter.regenNextAt = 0;
    if (applied > 0) heals.push({ seat, amount, ticks: applied, ticksLeft: fighter.regenTicksLeft });
  });
  if (heals.length) {
    setEvent(room, { type: "regen", heals }, now);
    bump(room, now);
  }
  return heals;
}

function finishIfNeeded(room, now) {
  const defeated = room.battle.fighters.map((fighter) => fighter.hp <= 0);
  if (!defeated.some(Boolean)) return false;
  room.phase = "complete";
  room.battle.completedAt = now;
  room.battle.winnerSeat = defeated.every(Boolean) ? null : (defeated[0] ? 1 : 0);
  room.battle.fighters.forEach((fighter) => {
    fighter.regenTicksLeft = 0;
    fighter.regenNextAt = 0;
  });
  room.players.forEach((player) => { if (player) player.ready = false; });
  return true;
}

function setEvent(room, event, now) {
  room.eventSeq += 1;
  room.lastEvent = { id: room.eventSeq, at: now, ...event };
}

function performAttack(room, seat, now, automatic = false, questionId = "", random = Math.random) {
  const fighter = room.battle.fighters[seat];
  const foeSeat = seat === 0 ? 1 : 0;
  const foe = room.battle.fighters[foeSeat];
  if (fighter.charge <= 0) return { ok: false, error: "NO_CHARGE" };
  const special = fighter.gauge >= 8;
  if (special && room.battle.firstSpecialSeat == null) room.battle.firstSpecialSeat = seat;
  let damage = fighter.charge;
  if (special) damage = Math.round(damage * SPECIAL_MULT);
  const hits = Math.max(1, fighter.combo || 1);
  damage = Math.round(damage * (1 + (hits - 1) * 0.05));
  damage = Math.round(damage * (fighter.attackBoost || 1));
  const dodgeChance = foe.dodgeChance || 0;
  const dodged = dodgeChance > 0 && random() * 100 < dodgeChance;
  if (dodgeChance > 0) foe.dodgeChance = 0;
  const guarded = !dodged && foe.blockReady;
  if (guarded) {
    damage = Math.max(1, Math.round(damage * 0.2));
    foe.blockReady = false;
  }
  if (dodged) damage = 0;
  fighter.charge = 0;
  if (!automatic) fighter.combo = 0;
  fighter.attackBoost = 1;
  if (special) fighter.gauge = 0;
  const hpBefore = foe.hp;
  foe.hp = Math.max(0, foe.hp - damage);
  const actualDamage = hpBefore - foe.hp;
  const reflected = !dodged && foe.reflectReady;
  let reflectedDamage = 0;
  if (reflected) {
    foe.reflectReady = false;
    reflectedDamage = Math.round(actualDamage * REFLECT_RATIO);
    fighter.hp = Math.max(0, fighter.hp - reflectedDamage);
  }
  const event = { type: "attack", seat, foeSeat, damage: actualDamage, hits, special, guarded, dodged, dodgeChance, reflected, reflectedDamage, automatic };
  if (questionId) event.questionId = questionId;
  setEvent(room, event, now);
  finishIfNeeded(room, now);
  return { ok: true, event };
}

export function applySubmit(room, seat, { questionId, answer }, now = Date.now()) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  settleTimedEffects(room, now);
  const fighter = room.battle.fighters[seat];
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
    const protectedMiss = !!fighter.mistakeGuardReady;
    const damage = Math.max(1, Math.round(totalWrong * 72 * (protectedMiss ? 0.5 : 1)));
    if (protectedMiss) fighter.mistakeGuardReady = false;
    else fighter.combo = 0;
    fighter.mistakes = (fighter.mistakes || 0) + 1;
    fighter.hp = Math.max(0, fighter.hp - damage);
    setEvent(room, { type: "miss", seat, damage, wrong: totalWrong, protectedMiss, questionId: question.id }, now);
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
  fighter.gauge += 1;
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
  settleTimedEffects(room, now);
  if (room.config.mode === "listen") return { ok: false, error: "SKIP_NOT_ALLOWED" };
  const fighter = room.battle.fighters[seat];
  fighter.combo = 0;
  fighter.qi += 1;
  fighter.questionStartedAt = now;
  setEvent(room, { type: "skip", seat }, now);
  bump(room, now);
  return { ok: true };
}

export function applyAttack(room, seat, now = Date.now(), random = Math.random) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  settleTimedEffects(room, now);
  if (room.config.mode === "listen") return { ok: false, error: "AUTO_ATTACK_MODE" };
  const result = performAttack(room, seat, now, false, "", random);
  if (result.ok) bump(room, now);
  return result;
}

export function applySkill(room, seat, skill, now = Date.now(), random = Math.random) {
  const playable = ensurePlayable(room, seat);
  if (!playable.ok) return playable;
  settleTimedEffects(room, now);
  const fighter = room.battle.fighters[seat];
  const foeSeat = seat === 0 ? 1 : 0;
  const foe = room.battle.fighters[foeSeat];
  const spend = (cost) => {
    if (fighter.combo < cost) return false;
    fighter.combo -= cost;
    return true;
  };
  let event = { type: "skill", seat, skill };
  if (skill === "block") {
    if (fighter.blockReady) return { ok: false, error: "BLOCK_ALREADY_READY" };
    if (fighter.dodgeChance > 0) return { ok: false, error: "DODGE_ALREADY_READY" };
    if (!spend(3)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
    fighter.blockReady = true;
    event = { ...event, effect: "block", value: 80 };
  } else if (skill === "heal") {
    if (fighter.hp >= MAX_HP) return { ok: false, error: "HP_FULL" };
    if (!spend(2)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
    const before = fighter.hp;
    fighter.hp = Math.min(MAX_HP, fighter.hp + 200);
    event = { ...event, effect: "heal", amount: fighter.hp - before };
  } else if (skill === "unique") {
    const rules = rulesFor(room, seat);
    const active = rules.active;
    const cost = active === "dodge" && fighter.dodgeChance > 0 ? 1 : (rules.cost || 2);
    if (active === "disrupt") {
      const key = questionKey(room, foeSeat);
      if (foe.lastDisruptedQuestionKey === key) return { ok: false, error: "QUESTION_ALREADY_DISRUPTED" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      foe.lastDisruptedQuestionKey = key;
      foe.boardDisruptSeq += 1;
      foe.boardDisruptQuestionId = questionAt(room, foeSeat)?.id || "";
      event = { ...event, active, foeSeat, questionId: foe.boardDisruptQuestionId, extraDistractors: 3 };
    } else if (active === "steal") {
      if (foe.charge <= 0) return { ok: false, error: "NO_TARGET_CHARGE" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      const stolen = Math.min(foe.charge, Math.max(40, Math.round(foe.charge * 0.2)));
      foe.charge -= stolen;
      fighter.charge += stolen;
      event = { ...event, active, foeSeat, amount: stolen };
    } else if (active === "reflect") {
      if (fighter.reflectReady) return { ok: false, error: "REFLECT_ALREADY_READY" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      fighter.reflectReady = true;
      event = { ...event, active, value: 50 };
    } else if (active === "boost") {
      if (fighter.attackBoost > 1) return { ok: false, error: "BOOST_ALREADY_READY" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      fighter.attackBoost = ATTACK_BOOST_MULT;
      event = { ...event, active, value: ATTACK_BOOST_MULT };
    } else if (active === "mistake_guard") {
      if (fighter.mistakeGuardReady) return { ok: false, error: "MISTAKE_GUARD_ALREADY_READY" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      fighter.mistakeGuardReady = true;
      event = { ...event, active };
    } else if (active === "dodge") {
      if (fighter.blockReady) return { ok: false, error: "BLOCK_ALREADY_READY" };
      if (fighter.dodgeChance >= 80) return { ok: false, error: "DODGE_AT_MAX" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      fighter.dodgeChance = fighter.dodgeChance ? Math.min(80, fighter.dodgeChance + 10) : 60;
      event = { ...event, active, value: fighter.dodgeChance };
    } else if (active === "combo_drain") {
      if (foe.combo <= 0) return { ok: false, error: "NO_TARGET_COMBO" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      const roll = random();
      const rolled = roll < 0.7 ? 3 : (roll < 0.9 ? 4 : 5);
      const amount = Math.min(foe.combo, rolled);
      foe.combo = Math.max(0, foe.combo - rolled);
      event = { ...event, active, foeSeat, amount, rolled };
    } else if (active === "regen") {
      if (fighter.hp >= MAX_HP) return { ok: false, error: "HP_FULL" };
      if (fighter.regenTicksLeft > 0) return { ok: false, error: "REGEN_ALREADY_ACTIVE" };
      if (!spend(cost)) return { ok: false, error: "NOT_ENOUGH_COMBO" };
      fighter.regenTicksLeft = REGEN_TICKS;
      fighter.regenNextAt = now + REGEN_TICK_MS;
      event = { ...event, active, ticks: REGEN_TICKS, amountPerTick: REGEN_HEAL };
    } else {
      return { ok: false, error: "UNKNOWN_CHARACTER_SKILL" };
    }
  } else {
    return { ok: false, error: "UNKNOWN_SKILL" };
  }
  setEvent(room, event, now);
  bump(room, now);
  return { ok: true, event };
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
