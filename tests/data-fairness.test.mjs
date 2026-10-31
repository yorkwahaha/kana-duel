import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
function load() {
  const context = vm.createContext({ window: {}, document: { getElementById() { return null; } }, setTimeout, Promise });
  for (const name of ["questions-data.js", "questions-expansion-data.js"]) vm.runInContext(read(name), context);
  vm.runInContext(`${read("game-content.js")};globalThis.__t={buildPool,romajiSequence,nearDistractors,kanaSound};`, context);
  return { bank: context.window.KANA_QUESTIONS, ...context.__t };
}
const isHira = (s) => /[\u3041-\u309f]/.test(s.replace(/ー/g, ""));
const isKata = (s) => /[\u30a1-\u30ff]/.test(s.replace(/ー/g, ""));

test("listening pools never contain a distractor that sounds like a correct cell", () => {
  const { bank, buildPool, kanaSound } = load();
  for (const q of bank) {
    const sounds = new Set(q.kanaSequence.map((k, i) => kanaSound(k, q.romajiOverride?.[i])));
    for (let n = 0; n < 15; n++) {
      const pool = buildPool(q.kanaSequence, 3, { listen: true, romajiOverride: q.romajiOverride });
      const extras = pool.filter((p) => p.id.startsWith("d"));
      for (const e of extras) assert.ok(!sounds.has(kanaSound(e.kana)), `${q.id}: ${e.kana} sounds like a correct cell`);
    }
  }
});

test("particle は is hinted as wa and わ is never offered as its distractor", () => {
  const { bank, buildPool, romajiSequence } = load();
  for (const id of ["konnichiwa", "konbanwa"]) {
    const q = bank.find((x) => x.id === id);
    assert.equal(Array.from(romajiSequence(q.kanaSequence, q.romajiOverride)).at(-1), "wa");
    for (let n = 0; n < 30; n++) {
      const pool = buildPool(q.kanaSequence, 3, { romajiOverride: q.romajiOverride });
      assert.ok(!pool.some((p) => p.kana === "わ"));
    }
  }
});

test("pure katakana questions get katakana-only distractors (and hiragana likewise)", () => {
  const { bank, buildPool } = load();
  for (const q of bank) {
    const word = q.kanaSequence.join("");
    const kataOnly = isKata(word) && !isHira(word);
    const hiraOnly = isHira(word) && !isKata(word);
    if (!kataOnly && !hiraOnly) continue;
    for (let n = 0; n < 5; n++) {
      for (const p of buildPool(q.kanaSequence, 3, {}).filter((x) => x.id.startsWith("d"))) {
        if (p.kana === "ー") continue;
        if (kataOnly) assert.ok(!isHira(p.kana), `${q.id}: hiragana distractor ${p.kana}`);
        if (hiraOnly) assert.ok(!isKata(p.kana), `${q.id}: katakana distractor ${p.kana}`);
      }
    }
  }
});

test("content fixes: greetings, basketball and audio manifest categories", () => {
  const { bank } = load();
  const byId = new Map(bank.map((q) => [q.id, q]));
  assert.equal(byId.get("konbanwa").zh, "晚上好");
  assert.equal(byId.get("basuke").displayName, "バスケ");
  assert.ok(!byId.has("basuketto"));
  const manifest = JSON.parse(read("assets/audio/questions/manifest.json"));
  for (const record of manifest.records) assert.equal(record.category, byId.get(record.id).category, record.id);
});
