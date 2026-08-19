import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAttack,
  applySkill,
  applySubmit,
  createRoomState,
  joinRoom,
  leaveRoom,
  publicRoomState,
  setConnected,
  setReady,
} from "../worker/src/room-core.mjs";

function createPlayingRoom(mode = "race") {
  const room = createRoomState({
    roomCode: "AB2C3D",
    hostName: "Host",
    hostToken: "host-token",
    config: { mode, distractors: true, maxLen: 0, script: "all" },
    deck: [
      { id: "q1", answer: ["か", "な"] },
      { id: "q2", answer: ["こ", "え"] },
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

test("two connected players choose unique characters and start a room", () => {
  const room = createPlayingRoom();
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.battle.fighters.map((fighter) => fighter.hp), [2400, 2400]);
  const publicState = publicRoomState(room, 0);
  assert.equal(publicState.youSeat, 0);
  assert.equal(publicState.players[0].token, undefined);
  assert.equal(publicState.currentQuestionId, "q1");
  assert.equal(publicState.questionIds, undefined);
  assert.equal(publicState.battle.fighters[1].qi, undefined);
  assert.equal(publicState.battle.fighters[0].qi, 0);
  assert.equal(publicState.deck, undefined);
});

test("the server validates answers and owns damage state", () => {
  const room = createPlayingRoom();
  assert.equal(applySubmit(room, 0, { questionId: "q1", answer: ["か", "な"] }, 1100).correct, true);
  assert.equal(room.battle.fighters[0].qi, 1);
  assert.equal(room.battle.fighters[0].combo, 1);
  assert.ok(room.battle.fighters[0].charge > 0);
  const hostView = publicRoomState(room, 0);
  const guestView = publicRoomState(room, 1);
  assert.equal(hostView.currentQuestionId, "q2");
  assert.equal(guestView.currentQuestionId, "q1");
  assert.equal(guestView.battle.fighters[0].qi, undefined);
  const before = room.battle.fighters[1].hp;
  assert.equal(applyAttack(room, 0, 1110).ok, true);
  assert.ok(room.battle.fighters[1].hp < before);
  assert.equal(room.lastEvent.type, "attack");

  const beforeMiss = room.battle.fighters[1].hp;
  assert.equal(applySubmit(room, 1, { questionId: "q1", answer: ["か", "え"] }, 1120).correct, false);
  assert.equal(room.lastEvent.type, "miss");
  assert.equal(room.battle.fighters[1].hp, beforeMiss - 72);
});

test("listen mode preserves the winner streak across automatic attacks", () => {
  const room = createPlayingRoom("listen");
  assert.equal(applySubmit(room, 0, { questionId: "q1", answer: ["か", "な"] }, 1100).correct, true);
  assert.equal(room.battle.sharedQi, 1);
  assert.equal(room.battle.fighters[0].combo, 1);
  assert.equal(room.lastEvent.type, "attack");
  assert.equal(room.lastEvent.automatic, true);
});

test("disconnect pauses commands and explicit leave transfers the host", () => {
  const room = createPlayingRoom();
  setConnected(room, 1, false, 1100);
  assert.equal(applySubmit(room, 0, { questionId: "q1", answer: ["か", "な"] }, 1110).error, "OPPONENT_UNAVAILABLE");
  assert.equal(leaveRoom(room, 0, 1120).ok, true);
  assert.equal(room.hostSeat, 1);
  assert.equal(room.phase, "lobby");
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
