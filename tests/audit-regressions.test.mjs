import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
function audioContext(window = {}) {
  return vm.createContext({
    window: { addEventListener() {}, ...window },
    document: { addEventListener() {}, querySelector() {}, getElementById() {} },
    Audio: function () { return { setAttribute() {}, addEventListener() {} }; },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
  });
}
function functions(names, globals = {}) {
  const source = read("game.js");
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    let start = source.indexOf(`function ${name}(`);
    if (source.slice(start - 6, start) === "async ") start -= 6;
    const ends = [source.indexOf("\nfunction ", start + 1), source.indexOf("\nasync function ", start + 1)].filter((n) => n >= 0);
    const end = Math.min(...ends);
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}

test("per-mora romaji handles gemination, ch and long vowels without changing slots", () => {
  const context = vm.createContext({ window: {}, document: { getElementById() {} }, setTimeout, Promise });
  for (const name of ["questions-data.js", "questions-expansion-data.js", "game-content.js"]) vm.runInContext(read(name), context);
  const romanize = (parts) => Array.from(context.romajiSequence(parts));
  assert.deepEqual(romanize(["が", "っ", "こ", "う"]), ["ga", "k", "ko", "u"]);
  assert.deepEqual(romanize(["や", "っ", "きょ", "く"]), ["ya", "k", "kyo", "ku"]);
  assert.deepEqual(romanize(["コ", "ッ", "プ"]), ["ko", "p", "pu"]);
  assert.deepEqual(romanize(["ま", "っ", "ちゃ"]), ["ma", "t", "cha"]);
  assert.deepEqual(romanize(["コ", "ー", "ヒ", "ー"]), ["ko", "o", "hi", "i"]);
  assert.equal(romanize(["っ"])[0], "促音");
  const bank = context.window.KANA_QUESTIONS;
  assert.equal(new Set(bank.map((q) => q.zh)).size, bank.length);
});

test("combo damage preserves the exact integer total including fewer damage points than hits", () => {
  const { splitComboDamage } = functions(["splitComboDamage"]);
  for (let total = 0; total <= 100; total++) {
    for (let hits = 1; hits <= 8; hits++) {
      const parts = splitComboDamage(total, hits);
      assert.equal(parts.length, hits);
      assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0));
      assert.equal(parts.reduce((sum, part) => sum + part, 0), total, `${total}/${hits}`);
    }
  }
});

test("result text containing markup is always escaped", () => {
  const { resultMarkup } = functions(["escapeResultText", "colorizePlayerTags", "resultMarkup"]);
  assert.equal(resultMarkup('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.match(resultMarkup("P1 勝"), /tag-p1/);
});

test("blocked resume never holds the audio initializer hostage", async () => {
  const suspended = { state: "suspended", addEventListener() {}, resume: () => new Promise(() => {}) };
  const context = audioContext({ AudioContext: function () { return suspended; } });
  vm.runInContext(read("game-audio.js"), context);
  let timer;
  const result = await Promise.race([
    context.ensureAudioCtx(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("audio resume remained pending")), 80); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(result, suspended);
});

test("one-shot SFX disconnects both source and gain at end", () => {
  const source = { connect() {}, start() {}, disconnect() { this.disconnected = true; } };
  const gain = { gain: {}, connect() {}, disconnect() { this.disconnected = true; } };
  const context = audioContext();
  vm.runInContext(read("game-audio.js"), context);
  context.ctx = { state: "running", createBufferSource: () => source, createGain: () => gain };
  vm.runInContext('audioCtx = ctx; sfxBufCache.set("hit1", {}); playSfx("hit1");', context);
  assert.equal(typeof source.onended, "function");
  source.onended();
  assert.equal(source.disconnected, true);
  assert.equal(gain.disconnected, true);
});

test("older ultimate cleanup cannot erase a newer animation or a cleared screen", async () => {
  for (const reduced of [false, true]) {
    const releases = [];
    const el = { dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, setAttribute() {},
      replaceChildren(...children) { this.children = children; } };
    const context = vm.createContext({ $: () => el, document: { querySelector() {}, getElementById() {} },
      clearTimeout() {}, prefersReducedMotion: () => reduced, wait: () => new Promise((resolve) => releases.push(resolve)) });
    vm.runInContext(read("game-vfx.js"), context);
    context.buildSpecialAftermath = (theme) => theme;
    context.shakeBattle = () => {};
    const first = context.playSpecialAftermath("ao");
    const second = context.playSpecialAftermath("rin");
    releases.shift()(); await first;
    assert.deepEqual(el.children, ["rin"]);
    context.clearBattleFx();
    context.playSpecialAftermath("yo");
    releases.shift()(); await second;
    assert.deepEqual(el.children, ["yo"]);
    releases.shift()();
  }
});

test("self-miss damage refreshes the injured player's healing controls", () => {
  const refreshed = [];
  const noop = () => {};
  const context = functions(["applySelfMissDamage"], { battleOpen: true, battleEpoch: 1, hp: { 1: 2400, 2: 2400 },
    playSfx: noop, playHitSfx: noop, $: () => null, charOf: () => null, fxThemeOf: () => ({}), updateHpUi: noop,
    updatePlayerMeters: (player) => refreshed.push(player), showDmgFloat: noop, spawnHitBurst: noop, shakeBattle: noop });
  context.applySelfMissDamage(2, 20, 1);
  assert.equal(context.hp[2], 2380);
  assert.deepEqual(refreshed, [2]);
});

test("static question audio respects saved voice volume and playback speed", async () => {
  const source = { connect() {}, start() { this.onended(); }, disconnect() {}, playbackRate: {} };
  const gain = { gain: {}, connect() {}, disconnect() {} };
  const context = audioContext({ KanaLearning: { settings: () => ({ voice: 0.5, speed: 0.75 }) } });
  context.performance = { now: () => 1 };
  vm.runInContext(read("game-audio.js"), context);
  context.ctx = { state: "running", currentTime: 0, createBufferSource: () => source, createGain: () => gain };
  context.window.AudioContext = function () { return context.ctx; };
  vm.runInContext("audioCtx = ctx;", context);
  context.prepareQuestionAudio = async () => ({});
  assert.equal(await context.scheduleQuestionAudio({ id: "q1" }), true);
  assert.equal(source.playbackRate.value, 0.75);
  assert.equal(gain.gain.value, 0.5);
});

test("normal, reflected and autoplay-blocked special damage complete and refresh injured players", async () => {
  for (const [reflect, special] of [[false, false], [true, false], [false, true]]) {
    const refreshed = [];
    const noop = () => {};
    const fighter = { classList: { add: noop, remove: noop }, querySelector: () => null };
    const context = functions(["splitComboDamage", "applyAttack"], { battleEpoch: 1, battleOpen: true, hp: { 1: 2400, 2: 2400 },
      $: () => fighter, charOf: () => null, fxThemeOf: () => ({}), isBlocking: () => false,
      audioCtx: { state: "suspended", resume: () => new Promise(() => {}) },
      playSpecialUltimate: async () => {}, playSpecialAftermath: async () => {}, preloadBattleSfx: async () => {},
      playSfx: noop, showCombo: noop, playCastBurst: noop, setFighterPose: noop, playAttackBolt: noop, playVoice: noop,
      playHitSfx: noop, dodgeChance: {}, reflectReady: { 2: reflect }, wait: async () => {}, updateHpUi: noop,
      updatePlayerMeters: (player) => refreshed.push(player), showDmgFloat: noop, spawnHitBurst: noop, shakeBattle: noop,
      showEffectForBoth: noop, REFLECT_DAMAGE_RATIO: 0.5 });
    let timer;
    await Promise.race([context.applyAttack(1, 100, special, 2, 2), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("special attack held by autoplay")), 80);
    })]).finally(() => clearTimeout(timer));
    assert.equal(context.hp[2], 2300);
    assert.ok(refreshed.includes(2));
    assert.equal(context.hp[1], reflect ? 2350 : 2400);
    assert.equal(refreshed.includes(1), reflect);
  }
});

test("static HTML audio fallback can be cancelled and TTS receives the saved speed", async () => {
  const context = audioContext({ KanaLearning: { settings: () => ({ speed: 0.75, voice: 0.4 }) } });
  context.performance = { now: () => 0 };
  vm.runInContext(read("game-audio.js"), context);
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  context.Audio = function () {
    const audio = { setAttribute() {}, play: async () => {}, pause() { this.paused = true; } };
    release(audio); return audio;
  };
  context.prepareQuestionAudio = async () => null;
  context.loadQuestionAudioManifest = async () => new Map([["q1", { file: "assets/audio/questions/q1.mp3" }]]);
  const pending = context.scheduleQuestionAudio({ id: "q1", speakText: "あ" });
  const audio = await ready;
  assert.equal(audio.volume, 0.4);
  assert.equal(audio.playbackRate, 0.75);
  context.stopTts();
  assert.equal(await pending, false);
  assert.equal(audio.paused, true);
  let rate;
  context.prepareGoogleTts = async (_, options) => { rate = options.rate; return null; };
  await context.speakGoogleTts("あ");
  assert.equal(rate, "0.75");
});

test("successful answer advances only with the board and cannot be disrupted during reveal", () => {
  const noop = () => {};
  const pending = [];
  const b = { slots: [{}], locked: false, markSlots: () => 0, lockGold() { this.locked = true; }, setFeedback: noop };
  const context = functions(["battleSubmit", "battleActivateUnique"], { battleOpen: true, battleEpoch: 1, boards: { 1: b, 2: { setFeedback: noop } },
    hp: { 1: 2400 }, submitCooldownUntil: {}, nowMs: () => 1000, playerQ: () => ({ kanaSequence: ["あ"] }), isListenBattle: () => false,
    combo: { 1: 0 }, gaugeHits: { 1: 0 }, charge: { 1: 0 }, calcChargeGain: () => 1, noteCorrectAnswer: noop,
    playSfx: noop, showAnswerGain: noop, updatePlayerMeters: noop, showWordReveal: noop, playerQi: { 1: 0 },
    setTimeout: (fn) => pending.push(fn), loadPlayerQuestion: () => { b.locked = false; }, charOf: () => ({ active: { id: "ink_seal", cost: 3 } }) });
  context.battleSubmit(1);
  assert.equal(context.playerQi[1], 0);
  assert.equal(b.locked, true);
  assert.doesNotThrow(() => context.battleActivateUnique(2));
  pending[0]();
  assert.equal(context.playerQi[1], 1);
  assert.equal(b.locked, false);
});

test("character conflict restores a valid choice even if the saved selection now conflicts", () => {
  const source = read("game-online.js");
  const start = source.indexOf("onError(error) {");
  const end = source.indexOf("\n    },", start) + "\n    }".length;
  for (const mine of ["rin", "ao"]) {
    let rendered;
    let message;
    const context = vm.createContext({ pendingCharacterId: "ao", localPlayer: () => ({ characterId: mine }),
      remotePlayer: () => ({ characterId: "ao" }), CHARACTERS: [{ id: "ao" }, { id: "rin" }], setSubmitPending() {},
      renderCharacterCard: (id) => { rendered = id; }, setError: (text) => { message = text; } });
    const callback = vm.runInContext(`(function ${source.slice(start, end)})`, context);
    callback({ code: "CHARACTER_TAKEN", message: "請換角色" });
    assert.equal(rendered, "rin");
    assert.equal(message, "請換角色");
  }
});
