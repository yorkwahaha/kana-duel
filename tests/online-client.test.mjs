import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";

const source = fs.readFileSync(new URL("../online.js", import.meta.url), "utf8");

function harness() {
  const sockets = [];
  const clipboardWrites = [];
  const timers = new Map();
  let timerId = 0;
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; this.listeners = new Map(); this.sent = []; sockets.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    emit(type, event = {}) {
      if (type === "open") this.readyState = FakeWebSocket.OPEN;
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    close() { this.readyState = 3; }
  }
  const storage = new Map([["kana-voice-match-online:AB2C3D", JSON.stringify({ roomCode: "AB2C3D", token: "host-token", playerName: "Host" })]]);
  const location = new URL("https://example.test/?room=AB2C3D");
  const window = {
    location,
    WebSocket: FakeWebSocket,
    history: { replaceState() {} },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout(callback, delay) { timerId += 1; timers.set(timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext({
    URL,
    WebSocket: FakeWebSocket,
    document: { querySelector: () => ({ content: "https://api.example.test" }) },
    fetch: async () => { throw new Error("not used"); },
    navigator: { clipboard: { writeText: async (value) => { clipboardWrites.push(value); } } },
    location,
    history: window.history,
    localStorage: window.localStorage,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    window,
  });
  vm.runInContext(source, context);
  return {
    online: window.KanaBattleOnlineClient,
    sockets,
    clipboardWrites,
    storage,
    timers,
    runTimer(delay) {
      const found = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `missing ${delay}ms timer`);
      timers.delete(found[0]);
      found[1].callback();
    },
  };
}

test("invite copy writes the complete room URL", async () => {
  const { online, clipboardWrites } = harness();
  online.resume("AB2C3D");
  assert.equal(await online.copyInvite(), true);
  assert.deepEqual(clipboardWrites, ["https://example.test/?room=AB2C3D"]);
});

test("websocket credentials use a subprotocol instead of the request URL", () => {
  const { online, sockets } = harness();
  online.resume("AB2C3D");
  assert.equal(sockets[0].url, "wss://api.example.test/rooms/AB2C3D/ws");
  assert.equal(sockets[0].url.includes("host-token"), false);
  assert.deepEqual(Array.from(sockets[0].protocols), ["kana-voice-match-v1", "kana-token.host-token"]);
});

test("ready schedules a state resync so the first player cannot miss battle start", () => {
  const { online, sockets, runTimer } = harness();
  online.resume("AB2C3D");
  sockets[0].emit("open");
  sockets[0].emit("message", { data: JSON.stringify({ type: "state", room: { roomCode: "AB2C3D", version: 2, phase: "lobby" } }) });
  assert.equal(online.ready("ao", true), true);
  runTimer(600);
  assert.deepEqual(sockets[0].sent.map((message) => message.type), ["sync", "ready", "sync"]);
});

test("a stale socket close cannot discard the replacement connection", () => {
  const { online, sockets } = harness();
  online.resume("AB2C3D");
  online.resume("AB2C3D");
  sockets[0].emit("close", { code: 4001, reason: "superseded" });
  sockets[1].emit("open");
  sockets[1].emit("message", { data: JSON.stringify({ type: "state", room: { roomCode: "AB2C3D", version: 2 } }) });
  assert.equal(online.ready("ao", true), true);
  assert.deepEqual(sockets[1].sent.map((message) => message.type), ["sync", "ready"]);
});

test("an error without close schedules a materially new connection", () => {
  const { online, sockets, runTimer } = harness();
  online.resume("AB2C3D");
  sockets[0].emit("error");
  runTimer(250);
  runTimer(500);
  assert.equal(sockets.length, 2);
});

test("readiness waits for fresh state on the current socket", () => {
  const { online, sockets } = harness();
  online.resume("AB2C3D");
  sockets[0].emit("open");
  assert.equal(online.ready("ao"), false);
  sockets[0].emit("message", { data: JSON.stringify({ room: { version: 2, phase: "lobby" } }) });
  assert.equal(online.ready("ao"), true);
  online.resume("AB2C3D");
  assert.equal(sockets[0].readyState, 3);
  sockets[1].emit("open");
  assert.equal(online.ready("ao"), false);
});

test("terminal close forgets credentials instead of repeatedly resuming them", () => {
  for (const code of [4000, 4001]) {
    const { online, sockets, storage } = harness();
    online.resume("AB2C3D");
    sockets[0].emit("close", { code });
    assert.equal(storage.size, 0);
    assert.equal(online.resume("AB2C3D"), false);
  }
});

test("opening and immediately closing cannot reset the retry budget", () => {
  const { online, sockets, timers } = harness();
  online.resume("AB2C3D");
  for (let i = 0; i < 9; i++) {
    sockets.at(-1).emit("open");
    sockets.at(-1).emit("close", { code: 1006 });
    const timer = [...timers.entries()].find(([, t]) => t.delay <= 8000);
    if (i < 8) {
      assert.ok(timer);
      timers.delete(timer[0]);
      timer[1].callback();
    } else assert.equal(timer, undefined);
  }
  assert.equal(sockets.length, 9);
});

test("room IDs are validated without silently redirecting to a truncated room", async () => {
  const { online, sockets } = harness();
  assert.equal(online.normalizeRoomCode(" ab2c3d "), "AB2C3D");
  for (const code of ["AB2C3DX", "AB2-3D", "../AB2C3D", "ABC01D"]) {
    assert.equal(online.resume(code), false);
    await assert.rejects(online.join({ code }), /INVALID_ROOM/);
  }
  assert.equal(sockets.length, 0);
});

test("an open socket without state eventually reconnects instead of leaving ready stuck", () => {
  const { online, sockets, runTimer } = harness();
  online.resume("AB2C3D");
  sockets[0].emit("open");
  runTimer(6000);
  assert.equal(sockets[0].readyState, 3);
  runTimer(500);
  assert.equal(sockets.length, 2);
});
