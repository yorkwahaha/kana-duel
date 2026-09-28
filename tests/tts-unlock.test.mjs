import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAudioRuntime() {
  const listeners = new Map();
  const audio = {
    volume: 1,
    paused: true,
    src: "",
    preload: "",
    currentTime: 0,
    setAttribute() {},
    addEventListener() {},
    play() {
      this.paused = false;
      return this.playResult;
    },
    pause() { this.paused = true; },
    playResult: Promise.resolve(),
  };
  const documentListeners = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Map,
    Set,
    Math,
    Date,
    URL,
    performance: { now: () => Date.now() },
    fetch: async () => { throw new Error("offline"); },
    navigator: {},
    Audio: function Audio() { return audio; },
    document: {
      hidden: false,
      getElementById() { return null; },
      addEventListener(type, listener) { documentListeners.push([type, listener]); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    window: {
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) || []), listener]);
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../game-audio.js", import.meta.url), "utf8"), context, { filename: "game-audio.js" });
  return { audio, unlockTtsPlayback: context.unlockTtsPlayback, markAudioInterrupted: context.markAudioInterrupted };
}

test("an interrupted unlock restores cloud TTS volume to 1", async () => {
  const runtime = loadAudioRuntime();
  let releasePlay;
  runtime.audio.playResult = new Promise((resolve) => { releasePlay = resolve; });
  const first = runtime.unlockTtsPlayback(true);
  assert.equal(runtime.audio.volume, 0.001);
  runtime.markAudioInterrupted();
  releasePlay();
  assert.equal(await first, false);
  assert.equal(runtime.audio.volume, 1);

  runtime.audio.playResult = Promise.resolve();
  assert.equal(await runtime.unlockTtsPlayback(true), true);
  assert.equal(runtime.audio.volume, 1);
});
