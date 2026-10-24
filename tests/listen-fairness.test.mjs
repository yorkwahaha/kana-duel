import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { setImmediate as nextTick } from "node:timers/promises";
import {
  createRoomState, joinRoom, setConnected, setReady, applySubmit,
} from "../worker/src/room-core.mjs";

const client = fs.readFileSync(new URL("../game-online.js", import.meta.url), "utf8");

function playingListenRoom() {
  const room = createRoomState({
    roomCode: "AB2C3D", hostName: "Host", hostToken: "host-token",
    config: { mode: "listen", category: "animals", distractors: false },
    deck: [{ id: "neko" }, { id: "inu" }, { id: "tori" }, { id: "sakana" }],
    now: 1000,
  });
  assert.equal(joinRoom(room, { name: "Guest", token: "guest-token", now: 1010 }).ok, true);
  setConnected(room, 0, true, 1020);
  setConnected(room, 1, true, 1030);
  setReady(room, 0, { ready: true, characterId: "ao" }, 1040);
  setReady(room, 1, { ready: true, characterId: "rin" }, 1050);
  return room;
}

test("server listen COMBO boosts charge once, not charge and attack damage again", () => {
  const room = playingListenRoom();
  const before = room.battle.fighters[1].hp;
  assert.ok(room.battle.listenCue.answerAt > room.battle.listenCue.playAt + 900);
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] },
    room.battle.listenCue.playAt + 30).error, "ROUND_NOT_STARTED");
  assert.equal(applySubmit(room, 0, { questionId: "neko", answer: ["ね", "こ"] },
    room.battle.listenCue.answerAt + 30).correct, true);
  assert.equal(room.lastEvent.damage, 70);
  assert.equal(room.battle.fighters[1].hp, before - 70);
  assert.equal(applySubmit(room, 0, { questionId: "inu", answer: ["い", "ぬ"] },
    room.battle.listenCue.answerAt + 30).correct, true);
  assert.equal(room.battle.fighters[0].combo, 2);
  assert.equal(room.lastEvent.hits, 2);
  // 70 * 1.08 = 76; the old code added a second +5% for two hits (=80).
  assert.equal(room.lastEvent.damage, 76);
  assert.equal(room.battle.fighters[1].hp, before - 70 - 76);
});

test("actual online cue functions keep board hidden through the entire audio", async () => {
  const start = client.indexOf("  function clearListenCueGate()");
  const end = client.indexOf("  function updateOpponentStatus()", start);
  assert.ok(start > 0 && end > start);
  const timers = new Map();
  let nextTimer = 1;
  const classes = new Set();
  const classList = {
    add: value => classes.add(value),
    remove: value => classes.delete(value),
    contains: value => classes.has(value),
  };
  const board = {
    locked: false,
    loadCalls: [],
    feedback: [],
    setFeedback(message) { this.feedback.push(message); },
    load(sequence, options) { this.loadCalls.push({ sequence, options }); },
  };
  const view = { classList: { add() {}, remove() {}, toggle() {} } };
  let audioScheduled = [];
  const releases = [];
  const context = {
    room: {
      config: { mode: "listen", distractors: false },
      battle: { listenCue: { seq: 1, questionId: "neko", playAt: 3000 } },
      currentQuestionId: "neko", serverNow: 1000,
    },
    active: true,
    lastListenCueSeq: 0,
    listenCueGateTimer: 0,
    localQuestionId: "",
    battleDeck: [],
    boards: { 1: board },
    document: { body: { classList } },
    $: () => view,
    questionById: () => ({ id: "neko", kanaSequence: ["ね", "こ"] }),
    setSubmitPending: () => {},
    noteQuestionOpen: () => {},
    prepareQuestionAudio: () => Promise.resolve(true),
    scheduleQuestionAudio: (_q, opt) => {
      audioScheduled.push(opt.delayMs);
      return new Promise(resolve => releases.push(resolve));
    },
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    Date,
  };
  const loadStart = client.indexOf("  function loadOnlineQuestion(");
  assert.ok(loadStart > 0);
  vm.createContext(context);
  vm.runInContext(client.slice(loadStart, end) + "\nloadOnlineQuestion(true); syncListenCue();", context);
  assert.equal(board.loadCalls.length, 1);
  assert.equal(board.loadCalls[0].options.noDistractors, false,
    "listening always has competing candidate kana even when no-distractors is selected");
  assert.equal(board.locked, true);
  assert.equal(classes.has("listen-cue-pending"), true);
  assert.equal([...timers.values()][0].delay, 37000);
  await nextTick();
  assert.deepEqual(audioScheduled, [2000]);
  assert.equal(board.locked, true, "scheduled start time is not audio completion");
  releases.shift()(true);
  await nextTick();
  assert.equal(board.locked, false);
  assert.equal(classes.has("listen-cue-pending"), false);

  // On the next prompt, the new timer must replace any previous gate.
  context.room.battle.listenCue = { seq: 2, questionId: "inu", playAt: 5000 };
  context.room.serverNow = 4000;
  vm.runInContext("syncListenCue()", context);
  assert.equal(board.locked, true);
  assert.equal([...timers.values()].at(-1).delay, 36000);
  await Promise.resolve();
  assert.equal(board.locked, true);
  [...timers.values()].at(-1).callback();
  assert.equal(board.locked, false, "audio watchdog should release a stuck device");
  assert.ok(board.feedback.some(message => message.includes("再聽")));
});
