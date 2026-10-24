import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../game-online.js", import.meta.url), "utf8");
const match = code.match(/\s{2}function initialSeenEventId\(snapshot\) \{[\s\S]*?\n\s{2}\}/);
assert.ok(match, "UI 必須維持首次狀態事件定位器");
const firstSeenId = runInNewContext("(" + match[0] + ")");

test("joining a running game skips its 48 previously-played events", () => {
  const previous = Array.from({ length: 48 }, (_, i) => ({ id: i + 1, type: "attack" }));
  assert.equal(firstSeenId({ phase: "playing", battle: { events: previous }, lastEvent: previous.at(-1) }), 48);
  assert.equal(firstSeenId({ phase: "complete", battle: { events: previous }, lastEvent: previous.at(-1) }), 48);
});

test("initial lobby and malformed / empty event lists start from zero", () => {
  assert.equal(firstSeenId({ phase: "lobby", lastEvent: null }), 0);
  assert.equal(firstSeenId({ phase: "playing", battle: { events: [] }, lastEvent: { id: 5 } }), 5);
  assert.equal(firstSeenId({ phase: "playing", battle: { events: null }, lastEvent: null }), 0);
});
