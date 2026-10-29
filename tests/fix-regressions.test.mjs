import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const noop = () => {};
function functions(names, globals = {}) {
  const source = read("game.js");
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, `missing ${name}`);
    if (source.slice(start - 6, start) === "async ") start -= 6;
    const ends = [source.indexOf("\nfunction ", start + 1), source.indexOf("\nasync function ", start + 1)].filter((n) => n >= 0);
    vm.runInContext(source.slice(start, Math.min(...ends)), context);
  }
  return context;
}
const fighter = () => ({ classList: { add: noop, remove: noop }, querySelector: () => null, offsetWidth: 0 });

function attackHarness({ hp, onWait }) {
  const outcome = { draw: null, defeat: null };
  const context = functions(["applyAttack", "splitComboDamage"], {
    battleOpen: true, battleEpoch: 1, hp, blockReady: {}, reflectReady: {}, dodgeChance: {}, attackBoost: {},
    $: fighter, charOf: () => ({}), fxThemeOf: () => ({ name: "t", id: "t" }), isBlocking: () => false,
    playSfx: noop, showCombo: noop, playCastBurst: noop, setFighterPose: noop, playAttackBolt: async () => {},
    playHitSfx: noop, playVoice: noop, updateHpUi: noop, updatePlayerMeters: noop, showDmgFloat: noop,
    spawnHitBurst: noop, spawnBlockParry: noop, shakeBattle: noop, showEffectForBoth: noop, prefersReducedMotion: () => true,
    BLOCK_DAMAGE_MULT: 0.2, REFLECT_DAMAGE_RATIO: 0.5, Math,
    wait: async () => { onWait?.(context); },
    finishBattleDraw: async (summary) => { outcome.draw = summary; },
    finishBattleDefeat: async (loser, winner, summary) => { outcome.defeat = { loser, winner, summary }; },
  });
  return { context, outcome };
}

test("a queued attack from an already-defeated attacker is dropped", async () => {
  const { context, outcome } = attackHarness({ hp: { 1: 0, 2: 100 } });
  assert.equal(await context.applyAttack(1, 50, false, 3, 3), false);
  assert.equal(context.hp[2], 100);
  assert.equal(outcome.draw, null);
  assert.equal(outcome.defeat, null);
});

test("attacker dying from a wrong answer mid-combo stops damage and never reports a 霜返 draw", async () => {
  let hits = 0;
  const { context, outcome } = attackHarness({ hp: { 1: 50, 2: 60 }, onWait: (ctx) => { hits += 1; if (hits === 1) ctx.hp[1] = 0; } });
  assert.equal(await context.applyAttack(1, 90, false, 3, 3), false);
  assert.ok(context.hp[2] > 0, "remaining hits must not land after the attacker fell");
  assert.equal(outcome.draw, null);
  assert.equal(outcome.defeat, null, "self-miss defeat already queued takes over");
});

test("霜返 text only appears when reflect is the lethal blow", async () => {
  const { context, outcome } = attackHarness({ hp: { 1: 10, 2: 200 } });
  context.reflectReady[2] = true;
  await context.applyAttack(1, 100, false, 1, 1);
  assert.deepEqual(outcome.defeat, { loser: 1, winner: 2, summary: "反彈決勝" });
});

test("dead players and pending local listen cues block attack and every skill", () => {
  const feedback = [];
  const context = functions(["battleActionBlocked", "battleFireAttack", "battleActivateBlock", "battleActivateHeal", "battleActivateUnique"], {
    battleOpen: true, localListenCuePending: false, isListenBattle: () => false, hp: { 1: 0, 2: 100 }, charge: { 1: 5, 2: 5 },
    combo: { 1: 9, 2: 9 }, dodgeChance: {}, MAX_HP: 2400, HEAL_COMBO_COST: 1, HEAL_AMOUNT: 25, BLOCK_COMBO_COST: 1,
    boards: { 1: { setFeedback: (t) => feedback.push(t) }, 2: { setFeedback: noop } },
    isBlocking: () => false, spendCombo: () => { throw new Error("must not spend"); }, charOf: () => ({ active: { id: "x" } }),
    enqueueAttack: () => { throw new Error("must not enqueue"); },
  });
  assert.equal(context.battleActionBlocked(1), true);
  context.battleFireAttack(1);
  context.battleActivateHeal(1);
  context.battleActivateBlock(1);
  context.battleActivateUnique(1);
  assert.equal(context.hp[1], 0);
  vm.runInContext("isListenBattle = () => true; localListenCuePending = true;", context);
  assert.equal(context.battleActionBlocked(2), true);
  assert.doesNotThrow(() => { context.battleActivateHeal(2); context.battleActivateBlock(2); });
});

test("a far drag that misses every slot cancels instead of filling the next slot", () => {
  const placed = [];
  const board = { slotsId: "slots1", place: (id) => placed.push(id) };
  const context = functions(["endDrag"], {
    DRAG_TAP_SLOP: 16, Math, drags: new Map(), window: { addEventListener: noop }, boards: { 1: board }, clearSlotOver: noop, activateBoardSource: noop,
    document: { elementFromPoint: () => ({ closest: () => null }) },
  });
  const start = (x) => context.drags.set(1, { boardId: 1, from: "pool", poolId: "p", moved: true, startX: 0, startY: 0, lastX: x, lastY: 0, el: { classList: { remove: noop } } });
  start(200); context.endDrag({ pointerId: 1, clientX: 200, clientY: 0 });
  assert.deepEqual(placed, []);
  start(6); context.endDrag({ pointerId: 1, clientX: 6, clientY: 0 });
  assert.deepEqual(placed, ["p"]);
});

test("character carousel only captures the pointer once a swipe is confirmed", () => {
  const source = read("game.js");
  const body = source.slice(source.indexOf("function bindCharCarouselSwipe"), source.indexOf("const end = (e) =>", source.indexOf("function bindCharCarouselSwipe")));
  const down = body.slice(0, body.indexOf('"pointermove"'));
  assert.doesNotMatch(down, /setPointerCapture/);
  assert.match(body.slice(body.indexOf('"pointermove"')), /drag\.moved = true;[\s\S]*setPointerCapture/);
});

test("question audio prepare times out, frees the pending slot and lets fallback run", async () => {
  const timers = [];
  const context = vm.createContext({
    window: { addEventListener() {} }, document: { addEventListener() {}, querySelector() {}, getElementById() {} },
    Audio: function () { return { setAttribute() {}, addEventListener() {} }; }, console,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: noop, setInterval, clearInterval,
    fetch: () => new Promise(() => {}),
  });
  vm.runInContext(read("game-audio.js"), context);
  context.loadQuestionAudioManifest = async () => new Map([["q1", { file: "q1.mp3" }]]);
  context.ensureAudioCtx = async () => ({});
  const first = context.prepareQuestionAudio({ id: "q1" });
  const timeout = timers.find((t) => t.ms === 8000);
  assert.ok(timeout, "prepare must arm an 8s timeout");
  timeout.fn();
  assert.equal(await first, null);
  await new Promise((r) => globalThis.setTimeout(r, 0));
  assert.equal(vm.runInContext("questionAudioPending.has('q1')", context), false);
});

test("local listen cue unlocks with a retry hint when audio never settles", async () => {
  const source = read("game.js");
  const start = source.indexOf("function setLocalListenCuePending(");
  const end = source.indexOf("function lockBoardForListen(", start);
  const timers = [];
  const feedback = [];
  const boards = { 1: { setFeedback: (t) => feedback.push(t) }, 2: { setFeedback: (t) => feedback.push(t) } };
  const context = vm.createContext({
    localListenCuePending: false, localListenCueToken: 0, battleOpen: true, battleEpoch: 1, boards,
    document: { body: { classList: { toggle: noop } } }, $: () => null, updatePlayerMeters: noop,
    speakQuestionAudio: () => new Promise(() => {}), Promise,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: noop,
  });
  vm.runInContext(source.slice(start, end), context);
  context.playLocalListenCue({ id: "q" });
  assert.equal(context.localListenCuePending, true);
  timers.find((t) => t.ms === 35000).fn();
  assert.equal(context.localListenCuePending, false);
  assert.match(feedback.join(), /再聽/);
});

test("two tabs recording attempts no longer overwrite each other", () => {
  const bank = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, zh: `詞${i}` }));
  const storage = new Map();
  const tab = () => {
    const window = { KANA_QUESTIONS: bank, localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
    vm.runInContext(read("game-learning.js"), vm.createContext({ window, document: { getElementById() { return null; } }, Date, console }));
    return window.KanaLearning;
  };
  const a = tab();
  const b = tab();
  a.recordAttempt("q1", false, 0, "2026-10-01");
  b.recordAttempt("q2", false, 0, "2026-10-01");
  a.completeDaily("2026-10-01");
  const saved = JSON.parse(storage.get("kana-learning-v1"));
  assert.equal(saved.days["2026-10-01"].attempts, 2);
  assert.deepEqual(Object.keys(saved.wrong).sort(), ["q1", "q2"]);
  assert.deepEqual(saved.daily, ["2026-10-01"]);
});

test("online HP bars follow attack animations instead of jumping to the server value", () => {
  const online = read("game-online.js");
  assert.match(online, /hp = \{ 1: shownHpOf\(1\), 2: shownHpOf\(2\) \}/);
  assert.match(online, /if \(!event\.dodged\) addHpDebt\(foe, event\.damage\)/);
  assert.match(online, /payHpDebt\(foe, paid\)/);
  assert.match(online, /addHpDebt\(player, event\.damage\)/);
  assert.match(online, /attackQueue === queued && queuedEpoch === battleEpoch\) settleHpDebt\(\)/);
});

test("battle clock ticks at 100ms and leaving a battle stops voices", () => {
  const game = read("game.js");
  const clock = game.slice(game.indexOf("function tickBattleClock"), game.indexOf("function stopBattleClock"));
  assert.match(clock, /setInterval\([\s\S]*100\)/);
  assert.doesNotMatch(game, /requestAnimationFrame\(tickBattleClock\)/);
  assert.doesNotMatch(game + read("game-online.js"), /cancelAnimationFrame\(timerRaf\)/);
  assert.match(game, /stopTts\(\); stopVoice\(\); stopBattleBgm\(\)/);
  assert.match(game, /stopTts\(\);\n {4}stopVoice\(\);/);
});
