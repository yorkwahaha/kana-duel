import test from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_TTL_MS,
  applyAttack,
  applySkip,
  applySkill,
  applySubmit,
  configureRoom,
  createRoomState,
  joinRoom,
  leaveRoom,
  nextTimedEffectAt,
  publicRoomState,
  roomExpired,
  sanitizeConfig,
  sanitizeDeck,
  sanitizePlayerName,
  setConnected,
  setReady,
  settleTimedEffects,
} from "../worker/src/room-core.mjs";

test("player names remove control and bidi override characters", () => {
  assert.equal(sanitizePlayerName("  York\n\u202E（房主）  "), "York （房主）");
  assert.equal([...sanitizePlayerName("😀".repeat(20))].length, 16);
});

test("rejected lobby updates do not mutate authoritative state", () => {
  const room = createRoomState({
    roomCode: "AB2C3D",
    hostName: "Host",
    hostToken: "host-token",
    config: { mode: "race", category: "animals" },
    deck: [{ id: "neko" }, { id: "inu" }, { id: "tori" }, { id: "sakana" }],
    now: 1000,
  });
  joinRoom(room, { name: "Guest", token: "guest-token", now: 1010 });
  setConnected(room, 0, true, 1020);
  setConnected(room, 1, true, 1030);
  const originalConfig = { ...room.config };
  const originalDeck = room.deck.map((entry) => ({ ...entry, answer: [...entry.answer] }));
  const invalidConfig = configureRoom(room, 0, { mode: "listen" }, [{ id: "only", answer: ["か"] }], 1040);
  assert.equal(invalidConfig.ok, false);
  assert.deepEqual(room.config, originalConfig);
  assert.deepEqual(room.deck, originalDeck);
  const mismatchedDeck = configureRoom(room, 0, { mode: "race", category: "food" }, [{ id: "neko" }, { id: "inu" }], 1045);
  assert.equal(mismatchedDeck.ok, false);
  assert.deepEqual(room.config, originalConfig);
  assert.deepEqual(room.deck, originalDeck);
  const taken = setReady(room, 1, { ready: true, characterId: "ao" }, 1050);
  assert.deepEqual(taken, { ok: false, error: "CHARACTER_TAKEN" });
  assert.equal(room.players[1].characterId, "rin");
  assert.equal(room.players[1].ready, false);
});

function createPlayingRoom(mode = "race") {
  const room = createRoomState({
    roomCode: "AB2C3D",
    hostName: "Host",
    hostToken: "host-token",
    config: { mode, distractors: true, maxLen: 0, script: "all", category: "animals" },
    deck: [
      { id: "neko" },
      { id: "inu" },
      { id: "tori" },
      { id: "sakana" },
    ],
    now: 1000,
  });
  assert.equal(joinRoom(room, { name: "Guest", token: "guest-token", now: 1010 }).ok, true);
  setConnected(room, 0, true, 1020);
  setConnected(room, 1, true, 1030);
  assert.equal(setReady(room, 0, { ready: true, characterId: "ao" }, 1040).started, false);
  assert.equal(setReady(room, 1, { ready: true, characterId: "rin" }, 1050).started, true);
  return room;
}

test("online rooms require the complete configured question set and ignore host-supplied answers", () => {
  assert.equal(sanitizeConfig({ category: "loanword" }).category, "loanword");
  assert.equal(sanitizeConfig({ category: "unknown" }).category, "all");
  assert.equal(sanitizeConfig({ mode: "zh-race" }).mode, "zh-race");
  assert.equal(sanitizeConfig({ mode: "forged" }).mode, "race");
  const animals = [{ id: "neko", answer: ["あ"] }, { id: "inu" }, { id: "tori" }, { id: "sakana" }];
  const deck = sanitizeDeck(animals, { category: "animals" });
  assert.deepEqual(deck[0], { id: "neko", answer: ["ね", "こ"] });
  assert.throws(() => sanitizeDeck([{ id: "neko" }, { id: "inu" }], { category: "animals" }), /INVALID_DECK/);
  assert.throws(() => sanitizeDeck([{ id: "forged" }, { id: "inu" }, { id: "tori" }, { id: "sakana" }], { category: "animals" }), /INVALID_DECK/);
  assert.equal(sanitizeDeck(animals, { category: "animals", script: "kata" }).length, 4);
  assert.throws(() => sanitizeDeck(Array.from({ length: 501 }, (_, index) => ({ id: `q${index}`, answer: ["あ"] }))), /INVALID_DECK/);
});

test("two connected players choose unique characters and start a room", () => {
  const room = createPlayingRoom();
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.battle.fighters.map((fighter) => fighter.hp), [2400, 2400]);
  const publicState = publicRoomState(room, 0);
  assert.equal(publicState.youSeat, 0);
  assert.equal(publicState.players[0].token, undefined);
  assert.equal(publicState.currentQuestionId, "neko");
  assert.equal(publicState.battle.listenCue, null);
  assert.equal(publicState.questionIds, undefined);
  assert.equal(publicState.battle.fighters[1].qi, undefined);
  assert.equal(publicState.battle.fighters[0].qi, 0);
  assert.equal(publicState.deck, undefined);
});

test("the server validates answers and owns damage state", () => {
  const room = createPlayingRoom();
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] }, 1100).correct, true);
  assert.equal(room.battle.fighters[0].qi, 1);
  assert.equal(room.battle.fighters[0].combo, 1);
  assert.ok(room.battle.fighters[0].charge > 0);
  assert.equal(room.battle.fighters[0].bestAnswerMs, 50);
  assert.equal(room.battle.fighters[0].totalAnswerMs, 50);
  const hostView = publicRoomState(room, 0);
  const guestView = publicRoomState(room, 1);
  assert.equal(hostView.currentQuestionId, "inu");
  assert.equal(guestView.currentQuestionId, "neko");
  assert.equal(guestView.battle.fighters[0].qi, undefined);
  const before = room.battle.fighters[1].hp;
  assert.equal(applyAttack(room, 0, 1110).ok, true);
  assert.ok(room.battle.fighters[1].hp < before);
  assert.equal(room.lastEvent.type, "attack");

  const beforeMiss = room.battle.fighters[1].hp;
  assert.equal(applySubmit(room, 1, { questionId: "neko", answer: ["ね", "え"] }, 1120).correct, false);
  assert.equal(room.lastEvent.type, "miss");
  assert.equal(room.battle.fighters[1].hp, beforeMiss - 72);
  assert.equal(room.battle.fighters[1].mistakes, 1);
  assert.equal(publicRoomState(room, 0).battle.fighters[1].mistakes, 1);
});

test("Chinese-to-Japanese race keeps independent question progress and normal attacks", () => {
  const room = createPlayingRoom("zh-race");
  assert.equal(room.config.mode, "zh-race");
  assert.equal(room.battle.listenCue, null);
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] }, 1100).correct, true);
  assert.equal(publicRoomState(room, 0).currentQuestionId, "inu");
  assert.equal(publicRoomState(room, 1).currentQuestionId, "neko");
  assert.equal(applyAttack(room, 0, 1110).ok, true);
});

test("listen mode preserves the winner streak across automatic attacks", () => {
  const room = createPlayingRoom("listen");
  assert.equal(room.battle.listenCue.questionId, "neko");
  assert.equal(room.battle.listenCue.playAt, 4250);
  const firstCue = room.battle.listenCue.seq;
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] }, 4300).correct, true);
  assert.equal(room.battle.sharedQi, 1);
  assert.equal(room.battle.fighters[0].combo, 1);
  assert.equal(room.lastEvent.type, "attack");
  assert.equal(room.lastEvent.automatic, true);
  assert.equal(room.lastEvent.questionId, "neko");
  assert.equal(room.battle.listenCue.questionId, "inu");
  assert.equal(room.battle.listenCue.seq, firstCue + 1);
  assert.ok(room.battle.listenCue.playAt >= 3300);
});

test("listen mode rejects submissions before playback and after the round is claimed", () => {
  const room = createPlayingRoom("listen");
  const fighter = room.battle.fighters[1];
  const beforeHp = fighter.hp;
  assert.equal(
    applySubmit(room, 1, { questionId: "neko", answer: ["ね", "え"] }, 4200).error,
    "ROUND_NOT_STARTED",
  );
  room.battle.listenClaimed = true;
  assert.equal(
    applySubmit(room, 1, { questionId: "neko", answer: ["ね", "え"] }, 4300).error,
    "ROUND_ALREADY_CLAIMED",
  );
  assert.equal(fighter.hp, beforeHp);
  assert.equal(fighter.mistakes, 0);
});

test("disconnect pauses commands and explicit leave transfers the host", () => {
  const room = createPlayingRoom();
  setConnected(room, 1, false, 1100);
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] }, 1110).error, "OPPONENT_UNAVAILABLE");
  assert.equal(leaveRoom(room, 0, 1120).ok, true);
  assert.equal(room.hostSeat, 1);
  assert.equal(room.phase, "lobby");
});

test("rematch, skip, and room expiry follow the authoritative lifecycle", () => {
  const room = createPlayingRoom();
  assert.equal(applySkip(room, 0, 1100).ok, true);
  assert.equal(room.battle.fighters[0].qi, 1);
  room.phase = "complete";
  room.players.forEach((player) => { player.ready = false; });
  assert.equal(setReady(room, 0, { ready: true, characterId: "ao" }, 1200).started, false);
  assert.equal(room.phase, "lobby");
  assert.equal(setReady(room, 1, { ready: true, characterId: "rin" }, 1210).started, true);
  assert.equal(room.phase, "playing");
  room.lastActiveAt = 2000;
  assert.equal(roomExpired(room, 2000 + ROOM_TTL_MS - 1), false);
  assert.equal(roomExpired(room, 2000 + ROOM_TTL_MS), true);
});

test("skills are rejected or applied from authoritative combo state", () => {
  const room = createPlayingRoom();
  assert.equal(applySkill(room, 0, "heal", 1100).error, "HP_FULL");
  room.battle.fighters[0].combo = 2;
  room.battle.fighters[0].hp = 2000;
  assert.equal(applySkill(room, 0, "heal", 1110).ok, true);
  assert.equal(room.battle.fighters[0].hp, 2200);
  assert.equal(room.battle.fighters[0].combo, 0);
});

test("block costs three combo, persists without a timer, reduces one attack by 80%, and cannot stack", () => {
  const room = createPlayingRoom();
  const defender = room.battle.fighters[0];
  const attacker = room.battle.fighters[1];
  defender.combo = 3;
  assert.equal(applySkill(room, 0, "block", 1100).ok, true);
  assert.equal(defender.combo, 0);
  assert.equal(defender.blockReady, true);

  defender.combo = 3;
  assert.equal(applySkill(room, 0, "block", 500000).error, "BLOCK_ALREADY_READY");
  assert.equal(defender.combo, 3);
  assert.equal(defender.blockReady, true);

  attacker.charge = 1000;
  attacker.combo = 1;
  const beforeHp = defender.hp;
  const attack = applyAttack(room, 1, 900000);
  assert.equal(attack.ok, true);
  assert.equal(attack.event.guarded, true);
  assert.equal(attack.event.damage, 200);
  assert.equal(defender.hp, beforeHp - 200);
  assert.equal(defender.blockReady, false);
});

test("all eight ultimates use the same x1.5 authoritative multiplier", () => {
  ["ao", "rin", "ya", "go", "ran", "gen", "sho", "yo"].forEach((characterId) => {
    const room = createPlayingRoom();
    room.players[0].characterId = characterId;
    room.battle.fighters[0].charge = 1000;
    room.battle.fighters[0].combo = 1;
    room.battle.fighters[0].gauge = 8;
    const attack = applyAttack(room, 0, 1200);
    assert.equal(attack.event.special, true);
    assert.equal(attack.event.damage, 1500, `${characterId} special damage`);
  });
});

test("Ao, Rin, Ya, and Go active skills use authoritative one-shot or pending state", () => {
  const aoRoom = createPlayingRoom();
  aoRoom.players[0].characterId = "ao";
  aoRoom.battle.fighters[0].combo = 6;
  const ao = applySkill(aoRoom, 0, "unique", 1100);
  assert.equal(ao.ok, true);
  assert.equal(aoRoom.battle.fighters[1].boardDisruptSeq, 1);
  assert.equal(ao.event.extraDistractors, 3);
  assert.equal(applySkill(aoRoom, 0, "unique", 1110).error, "QUESTION_ALREADY_DISRUPTED");

  const rinRoom = createPlayingRoom();
  rinRoom.players[0].characterId = "rin";
  rinRoom.battle.fighters[0].combo = 2;
  rinRoom.battle.fighters[1].charge = 1000;
  assert.equal(applySkill(rinRoom, 0, "unique", 1100).event.amount, 200);
  assert.equal(rinRoom.battle.fighters[0].charge, 200);
  assert.equal(rinRoom.battle.fighters[1].charge, 800);

  const yaRoom = createPlayingRoom();
  yaRoom.players[0].characterId = "ya";
  yaRoom.battle.fighters[0].combo = 2;
  assert.equal(applySkill(yaRoom, 0, "unique", 1100).ok, true);
  yaRoom.battle.fighters[1].charge = 1000;
  yaRoom.battle.fighters[1].combo = 1;
  const reflected = applyAttack(yaRoom, 1, 1200);
  assert.equal(reflected.event.damage, 1000);
  assert.equal(reflected.event.reflectedDamage, 500);
  assert.equal(yaRoom.battle.fighters[1].hp, 1900);
  assert.equal(yaRoom.battle.fighters[0].reflectReady, false);

  const goRoom = createPlayingRoom();
  goRoom.players[0].characterId = "go";
  goRoom.battle.fighters[0].combo = 2;
  assert.equal(applySkill(goRoom, 0, "unique", 1100).ok, true);
  goRoom.battle.fighters[0].charge = 1000;
  goRoom.battle.fighters[0].gauge = 8;
  const boosted = applyAttack(goRoom, 0, 1200);
  assert.equal(boosted.event.damage, 1800);
  assert.equal(goRoom.battle.fighters[0].attackBoost, 1);
});

test("Ran, Gen, and Sho active skills preserve mistakes, stack dodge, and drain combo", () => {
  const ranRoom = createPlayingRoom();
  ranRoom.players[0].characterId = "ran";
  ranRoom.battle.fighters[0].combo = 3;
  assert.equal(applySkill(ranRoom, 0, "unique", 1100).ok, true);
  const questionId = publicRoomState(ranRoom, 0).currentQuestionId;
  assert.equal(applySubmit(ranRoom, 0, { questionId, answer: ["錯"] }, 1200).correct, false);
  assert.equal(ranRoom.battle.fighters[0].combo, 2);
  assert.equal(ranRoom.battle.fighters[0].mistakeGuardReady, false);
  assert.equal(ranRoom.lastEvent.protectedMiss, true);

  const genRoom = createPlayingRoom();
  genRoom.players[0].characterId = "gen";
  genRoom.battle.fighters[0].combo = 4;
  assert.equal(applySkill(genRoom, 0, "unique", 1100).event.value, 60);
  assert.equal(applySkill(genRoom, 0, "unique", 1110).event.value, 70);
  assert.equal(applySkill(genRoom, 0, "unique", 1120).event.value, 80);
  assert.equal(applySkill(genRoom, 0, "unique", 1130).error, "DODGE_AT_MAX");
  assert.equal(applySkill(genRoom, 0, "block", 1140).error, "DODGE_ALREADY_READY");
  genRoom.battle.fighters[1].charge = 1000;
  genRoom.battle.fighters[1].combo = 1;
  const dodged = applyAttack(genRoom, 1, 1200, () => 0.5);
  assert.equal(dodged.event.dodged, true);
  assert.equal(dodged.event.damage, 0);
  assert.equal(genRoom.battle.fighters[0].dodgeChance, 0);

  const shoRoom = createPlayingRoom();
  shoRoom.players[0].characterId = "sho";
  shoRoom.battle.fighters[0].combo = 3;
  shoRoom.battle.fighters[1].combo = 7;
  const drained = applySkill(shoRoom, 0, "unique", 1100, () => 0.95);
  assert.equal(drained.event.amount, 5);
  assert.equal(shoRoom.battle.fighters[1].combo, 2);
});

test("Yo regeneration heals ten server-timed ticks and pauses while disconnected", () => {
  const room = createPlayingRoom();
  room.players[0].characterId = "yo";
  const fighter = room.battle.fighters[0];
  fighter.hp = 2000;
  fighter.combo = 2;
  assert.equal(applySkill(room, 0, "unique", 1000).ok, true);
  assert.equal(fighter.regenTicksLeft, 10);
  assert.equal(nextTimedEffectAt(room), 4000);
  assert.deepEqual(settleTimedEffects(room, 3999), []);
  assert.equal(settleTimedEffects(room, 4000)[0].amount, 36);
  assert.equal(fighter.hp, 2036);
  assert.equal(fighter.regenTicksLeft, 9);

  setConnected(room, 1, false, 4500);
  assert.deepEqual(settleTimedEffects(room, 10000), []);
  assert.equal(fighter.hp, 2036);
  setConnected(room, 1, true, 10500);
  assert.equal(nextTimedEffectAt(room), 13000);
  assert.deepEqual(settleTimedEffects(room, 12999), []);
  assert.equal(settleTimedEffects(room, 13000)[0].amount, 36);
  assert.equal(fighter.hp, 2072);
});
