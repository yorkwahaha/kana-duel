import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../game.js", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const start = source.indexOf("function setLocalListenCuePending(");
const end = source.indexOf("function lockBoardForListen(", start);

function makeLocalBattle() {
  assert.ok(start > 0 && end > start, "test must execute production listening code");
  const classes = new Set();
  const classList = {
    add: key => classes.add(key),
    remove: key => classes.delete(key),
    contains: key => classes.has(key),
    toggle: (key, enabled) => {
      if (enabled) classes.add(key);
      else classes.delete(key);
    },
  };
  const elements = Object.fromEntries(["board1", "board2", "btn-battle-listen"]
    .map(key => [key, { classList: {
      state: new Set(),
      toggle(cls, enabled) {
        if (enabled) this.state.add(cls);
        else this.state.delete(cls);
      },
    }, disabled: false }]));
  const speech = [];
  const feedback = [];
  const feedbackPlayers = [];
  const boards = {
    1: { locked: false, setFeedback: value => { feedback.push(value); feedbackPlayers.push(1); } },
    2: { locked: false, setFeedback: value => { feedback.push(value); feedbackPlayers.push(2); } },
  };
  let loaded = 0;
  const context = {
    localListenCuePending: false,
    localListenCueToken: 0,
    listenRoundClaimed: false,
    battleOpen: true,
    battleEpoch: 4,
    boards,
    document: { body: { classList } },
    $: key => elements[key],
    updatePlayerMeters: () => {},
    loadPlayerQuestion: () => {
      loaded++;
      boards[loaded % 2 === 1 ? 1 : 2].locked = false;
    },
    playerQ: () => ({ id: "inu", kanaSequence: ["い", "ぬ"] }),
    speakQuestionAudio: () => new Promise(resolve => speech.push(resolve)),
    Promise,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, boards, classes, speech, feedback, feedbackPlayers, elements };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("same-device listen battle masks both boards until audio finishes", async () => {
  const local = makeLocalBattle();
  assert.match(style, /body\.local-listen-cue-pending:not\(\.online-battle\)[\s\S]*?\.duel-stage\.listen-mode \.board \.pool/);
  vm.runInContext("loadSharedListenRound(true)", local.context);
  assert.equal(local.boards[1].locked, true);
  assert.equal(local.boards[2].locked, true);
  assert.equal(local.classes.has("local-listen-cue-pending"), true);
  assert.equal(local.elements["btn-battle-listen"].disabled, true);
  await settle();
  assert.equal(local.speech.length, 1);
  local.speech.shift()(true);
  await settle();
  assert.equal(local.boards[1].locked, false);
  assert.equal(local.boards[2].locked, false);
  assert.equal(local.classes.has("local-listen-cue-pending"), false);
  assert.equal(local.elements["btn-battle-listen"].disabled, false);
});

test("failed audio never softlocks and an older cue never unlocks the next one", async () => {
  const local = makeLocalBattle();
  vm.runInContext("loadSharedListenRound(true)", local.context);
  await settle();
  const oldResolve = local.speech.shift();
  vm.runInContext("loadSharedListenRound(true)", local.context);
  await settle();
  const newResolve = local.speech.shift();
  oldResolve(true);
  await settle();
  assert.equal(local.boards[1].locked, true, "old audio completion cannot reveal a new question");
  assert.equal(local.boards[2].locked, true);
  newResolve(false);
  await settle();
  assert.equal(local.boards[1].locked, false);
  assert.equal(local.boards[2].locked, false);
  assert.ok(local.feedback.some(message => message.includes("重試")));
  assert.deepEqual([...new Set(local.feedbackPlayers)], [1, 2],
    "both players must know when audio failed and a replay is needed");
  assert.equal(local.context.localListenCuePending, false);
});

test("local battle submit and manual replay refuse input while cue is pending", () => {
  assert.match(source, /function battleSubmit\(player\) \{\s*if \(!battleOpen \|\| hp\[player\] <= 0 \|\| \(isListenBattle\(\) && localListenCuePending\)\) return;/);
  assert.match(source, /if \(!battleOpen \|\| !isListenBattle\(\) \|\| listenRoundClaimed \|\| localListenCuePending\) return;/);
  assert.match(source, /const noDistractors = !isListenBattle\(\) && !battleOpts\.distractors;/,
    "聽音模式即使房主關閉干擾字，也不可只顯示唯一答案字池");
});
