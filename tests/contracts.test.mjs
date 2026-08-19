import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function loadContentData() {
  const sandbox = {
    window: {},
    document: { getElementById() { return null; } },
    setTimeout,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(read("questions-data.js"), sandbox, { filename: "questions-data.js" });
  vm.runInContext(
    read("game-content.js") + "\n;globalThis.__testData = { CHARACTERS, KANA_ROMAJI, ALL_QUESTIONS };",
    sandbox,
    { filename: "game-content.js" },
  );
  return sandbox.__testData;
}

test("question bank keeps valid, unique, playable entries", () => {
  const { ALL_QUESTIONS, KANA_ROMAJI } = loadContentData();
  assert.ok(ALL_QUESTIONS.length >= 180, `expected at least 180 questions, got ${ALL_QUESTIONS.length}`);
  assert.equal(new Set(ALL_QUESTIONS.map((q) => q.id)).size, ALL_QUESTIONS.length, "question ids must be unique");

  for (const q of ALL_QUESTIONS) {
    assert.ok(q.displayName, `${q.id}: displayName is required`);
    assert.ok(q.speakText, `${q.id}: speakText is required`);
    assert.ok(q.kanaSequence.length >= 1 && q.kanaSequence.length <= 16, `${q.id}: kana length must be 1..16`);
    for (const kana of q.kanaSequence) {
      assert.ok(KANA_ROMAJI[kana], `${q.id}: missing romaji mapping for ${kana}`);
    }
  }
});

test("all referenced local media exist except the explicitly deferred voice pack", () => {
  const sources = ["index.html", "game-content.js", "game-audio.js", "game-vfx.js", "game.js"]
    .map(read)
    .join("\n");
  const refs = new Set(sources.match(/assets\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g|mp3|wav|ogg|mp4)/g) || []);
  const missing = [...refs].filter((ref) => !exists(ref)).sort();
  const deferred = ["gen", "ran", "sho", "yo"]
    .flatMap((id) => [`assets/voice/${id}/defeat.mp3`, `assets/voice/${id}/hit.mp3`])
    .sort();
  assert.deepEqual(missing, deferred);
});

test("manual submission is the only spelling completion path", () => {
  const game = read("game.js");
  const html = read("index.html");
  assert.doesNotMatch(game, /maybeAutoBattleSubmit/);
  assert.equal((html.match(/排好後手動提交答案/g) || []).length, 2);
  assert.match(game, /act === "submit"\) battleSubmit\(p\)/);
});

test("listen-round streaks survive automatic attacks and stale attacks are rejected", () => {
  const game = read("game.js");
  const listenResolver = game.slice(
    game.indexOf("async function resolveListenRoundWin"),
    game.indexOf("function tickBattleClock"),
  );
  const attackQueue = game.slice(
    game.indexOf("function enqueueAttack"),
    game.indexOf("function applySelfMissDamage"),
  );
  assert.match(listenResolver, /combo\[foe\] = 0/);
  assert.doesNotMatch(listenResolver, /combo\[player\] = 0;\s*if \(isSpecial\)/);
  assert.match(attackQueue, /queuedEpoch !== battleEpoch/);
  assert.match(attackQueue, /actionEpoch !== battleEpoch/);
});

test("reduced-motion mode avoids long video and shake sequences", () => {
  const game = read("game.js");
  const vfx = read("game-vfx.js");
  const css = read("styles.css");
  assert.match(game, /prefersReducedMotion\(\) \? 600 : 4000/);
  assert.match(game, /if \(prefersReducedMotion\(\)\) \{[\s\S]*?still\.src = ch\.imageAtk \|\| ch\.image/);
  assert.match(vfx, /function shakeBattle\(heavy\) \{\s*if \(prefersReducedMotion\(\)\) return/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("split scripts load in dependency order", () => {
  const html = read("index.html");
  const scripts = ["questions-data.js", "game-content.js", "game-audio.js", "game-vfx.js", "game.js"];
  const offsets = scripts.map((script) => html.indexOf(`src="${script}`));
  assert.ok(offsets.every((offset) => offset >= 0), "all game modules must be loaded");
  assert.deepEqual(offsets, offsets.slice().sort((a, b) => a - b), "game modules are out of order");
  assert.equal((html.match(/\?v=20260819-online-layout-1/g) || []).length, 8, "CSS and scripts must bypass stale release caches");
});

test("local two-player zoom protection and accessibility contracts remain present", () => {
  const html = read("index.html");
  const game = read("game.js");
  assert.match(html, /user-scalable=no/);
  assert.match(game, /gesturestart/);
  assert.match(game, /touchend/);
  assert.match(html, /id="reward-stage"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.equal((html.match(/role="status" aria-live="polite"/g) || []).length, 4);
});

test("online room entry and battle interception stay wired", () => {
  const html = read("index.html");
  const game = read("game.js");
  const online = read("game-online.js");
  const css = read("styles.css");
  assert.match(html, /id="btn-mode-online"/);
  assert.match(html, /id="screen-online"/);
  assert.match(html, /src="online\.js\?v=20260819-online-layout-1"/);
  assert.match(html, /src="game-online\.js\?v=20260819-online-layout-1"/);
  assert.match(game, /window\.KanaBattleOnline\.handleAction\(p, act\)/);
  assert.match(game, /window\.KanaBattleOnline\.replayQuestion\(\)/);
  assert.match(online, /client\.submit\(localQuestionId/);
  assert.match(online, /room\.currentQuestionId/);
  assert.doesNotMatch(online, /room\.questionIds/);
  assert.match(css, /body\.online-battle \.duel-half\.p2 \{\s*transform: none/);
  assert.match(css, /@media \(orientation: landscape\)[\s\S]*?grid-template-columns: minmax\(220px, 42%\) minmax\(0, 58%\)/);
  assert.match(css, /@media \(orientation: portrait\)[\s\S]*?grid-template-rows: minmax\(116px, 27dvh\) auto minmax\(0, 1fr\)/);
});
