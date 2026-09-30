import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const bank = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, zh: `詞${i}` }));
function harness(saved, denied = false) {
  const storage = new Map(saved ? [["kana-learning-v1", saved]] : []);
  const window = { KANA_QUESTIONS: bank, localStorage: {
    getItem(key) { if (denied) throw new Error("denied"); return storage.get(key); },
    setItem(key, value) { if (denied) throw new Error("denied"); storage.set(key, value); },
  } };
  const context = vm.createContext({ window, document: { getElementById() { return null; } }, Date, console });
  vm.runInContext(fs.readFileSync(new URL("../game-learning.js", import.meta.url), "utf8"), context);
  return { learning: window.KanaLearning, storage };
}

test("settings survive reload and safely ignore corrupt or denied storage", () => {
  const { learning, storage } = harness();
  learning.setSettings({ bgm: 0, speed: 0.75, hints: false, voice: 0.5 });
  const next = harness(storage.get("kana-learning-v1")).learning;
  assert.equal(next.settings().speed, 0.75);
  assert.equal(next.settings().hints, false);
  assert.equal(next.settings().voice, 0.5);
  next.setSettings({ speed: -2, bgm: "bad", sfx: 900 });
  assert.equal(next.settings().speed, 1);
  assert.equal(next.settings().bgm, 1);
  assert.equal(next.settings().sfx, 1);
  assert.equal(harness("broken").learning.settings().speed, 1);
  assert.doesNotThrow(() => harness(null, true).learning.recordAttempt("q1", false, 0));
});

test("attempt statistics distinguish retries, completed answers and skips", () => {
  const { learning } = harness();
  const day = "2026-10-01";
  learning.recordAttempt("q1", false, 0, day);
  learning.recordAttempt("q1", true, 2000, day);
  learning.recordAttempt("q2", true, 4000, day);
  const stats = learning.summary(day);
  assert.equal(stats.attempts, 3);
  assert.equal(stats.correct, 2);
  assert.equal(stats.maxStreak, 2);
  assert.equal(stats.averageMs, 3000);
  learning.recordAttempt("q3", false, 0, day);
  assert.equal(learning.summary(day).attempts, 4);
});

test("wrong questions are due immediately and spaced only after successful recall", () => {
  const { learning } = harness();
  learning.recordAttempt("q1", false, 0, "2026-10-01");
  assert.deepEqual(Array.from(learning.dueIds("2026-10-01")), ["q1"]);
  learning.recordAttempt("q1", true, 1000, "2026-10-01");
  assert.equal(learning.dueIds("2026-10-01").length, 0);
  assert.equal(learning.dueIds("2026-10-02").length, 1);
  learning.recordAttempt("q1", false, 0, "2026-10-01");
  assert.equal(learning.dueIds("2026-10-01").length, 1);
});

test("daily set is deterministic and completion is idempotent, local-calendar based", () => {
  const { learning, storage } = harness();
  const ids = learning.dailyIds("2026-10-01");
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  assert.deepEqual(Array.from(ids), Array.from(harness().learning.dailyIds("2026-10-01")));
  learning.completeDaily("2026-09-30");
  learning.completeDaily("2026-10-01");
  learning.completeDaily("2026-10-01");
  assert.equal(learning.summary("2026-10-01").dailyStreak, 2);
  assert.equal(harness(storage.get("kana-learning-v1")).learning.summary("2026-10-03").dailyStreak, 0);
  assert.equal(learning.localDay(new Date(2026, 9, 1, 0, 5)), "2026-10-01");
});

test("persisted unknown IDs, invalid dates and excessive numeric data are rejected", () => {
  const { learning } = harness(JSON.stringify({ settings: { voice: "bad" }, days: { "not-date": {} }, wrong: { malicious: { due: "2026-10-01" } }, daily: ["garbage"] }));
  assert.equal(learning.summary("2026-10-01").attempts, 0);
  assert.equal(learning.dueIds("2026-10-01").length, 0);
  assert.equal(learning.settings().voice, 1);
  learning.recordAttempt("unknown", true, 1, "2026-10-01");
  assert.equal(learning.summary("2026-10-01").attempts, 0);
});
