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
  vm.runInContext(read("questions-expansion-data.js"), sandbox, { filename: "questions-expansion-data.js" });
  vm.runInContext(
    read("game-content.js") + "\n;globalThis.__testData = { CHARACTERS, KANA_ROMAJI, ALL_QUESTIONS };",
    sandbox,
    { filename: "game-content.js" },
  );
  return sandbox.__testData;
}

test("question bank keeps valid, unique, playable entries", () => {
  const { ALL_QUESTIONS, KANA_ROMAJI } = loadContentData();
  assert.equal(ALL_QUESTIONS.length, 380, `expected the reviewed 380-question bank, got ${ALL_QUESTIONS.length}`);
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

test("reviewed bank removes obscure names and provides categorized learning variety", () => {
  const { ALL_QUESTIONS } = loadContentData();
  const removed = ["custom_star", "custom_thunder", "custom_moon", "custom_flame", "custom_ice", "custom_wind", "custom_void", "custom_dragon", "custom_light", "custom_shadow", "sakura", "ashitaka", "chihiro", "howl", "genos", "ram", "hado31", "detroit", "expulsion", "seriouspunch", "malevolent", "shikai"];
  assert.equal(ALL_QUESTIONS.some((q) => removed.includes(q.id)), false, "obscure character and move ids must stay removed");
  assert.ok(new Set(ALL_QUESTIONS.map((q) => q.category)).size >= 14, "bank needs broad category coverage");
  const loanwords = ALL_QUESTIONS.filter((q) => q.category === "loanword");
  assert.equal(loanwords.length, 30, "dedicated loanword category should contain 30 questions");
  assert.ok(loanwords.every((q) => q.kanaSequence.every((part) => /^[\u30A0-\u30FFー]+$/.test(part))), "loanwords must practice katakana only");
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
  const scripts = ["questions-data.js", "questions-expansion-data.js", "game-content.js", "game-audio.js", "game-vfx.js", "game.js"];
  const offsets = scripts.map((script) => html.indexOf(`src="${script}`));
  assert.ok(offsets.every((offset) => offset >= 0), "all game modules must be loaded");
  assert.deepEqual(offsets, offsets.slice().sort((a, b) => a - b), "game modules are out of order");
  const releaseVersions = [...html.matchAll(/(?:src|href)="[^"]+\?v=([^"]+)"/g)].map((match) => match[1]);
  assert.equal(releaseVersions.length, 9, "all CSS and scripts need a release cache version");
  assert.equal(new Set(releaseVersions).size, 1, "CSS and scripts must share one release cache version");
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
  assert.match(html, /src="online\.js\?v=[^"]+"/);
  assert.match(html, /src="game-online\.js\?v=[^"]+"/);
  assert.match(html, /id="online-category"/);
  assert.match(online, /q\.category === config\.category/);
  assert.match(html, /id="online-character-image"/);
  assert.match(html, /id="online-character-intro"/);
  assert.match(html, /aria-label="上一位角色"/);
  assert.match(html, /aria-label="下一位角色"/);
  assert.match(online, /const CHARACTER_INTROS =/);
  assert.match(online, /renderCharacterCard\(pendingCharacterId\)/);
  assert.match(game, /window\.KanaBattleOnline\.handleAction\(p, act\)/);
  assert.match(game, /window\.KanaBattleOnline\.replayQuestion\(\)/);
  assert.match(online, /client\.submit\(localQuestionId/);
  assert.match(online, /room\.currentQuestionId/);
  assert.match(online, /scheduleQuestionAudio\(question, \{ delayMs \}\)/);
  assert.match(online, /playHitSfx\(Math\.min\(hitNo, 5\)\)/);
  assert.match(online, /shakeBattle\(event\.special \|\| hitNo >= 3/);
  assert.match(online, /await playSpecialUltimate\(player\)/);
  assert.doesNotMatch(online, /room\.questionIds/);
  assert.match(css, /body\.online-battle \.duel-half\.p2 \{\s*transform: none/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(58px, 78px\)\)/);
  assert.match(css, /@media \(orientation: landscape\)[\s\S]*?grid-template-columns: minmax\(232px, 38%\) minmax\(0, 62%\)/);
  assert.match(css, /@media \(orientation: portrait\)[\s\S]*?grid-template-rows: minmax\(108px, 21dvh\) auto minmax\(0, 1fr\)/);
});

test("online invite, lobby, and VS intro use the phone-first interaction contract", () => {
  const html = read("index.html");
  const game = read("game-online.js");
  const client = read("online.js");
  const css = read("styles.css");
  assert.doesNotMatch(html, /id="btn-online-back"/);
  assert.match(html, /class="sr-only" id="online-connection"/);
  assert.match(html, /id="btn-online-invite-exit"[^>]*>離開遊戲</);
  assert.match(game, /function setInviteMode\(enabled, code = ""\)/);
  assert.match(game, /\$\("btn-online-create"\)\.disabled = inviteMode/);
  assert.match(game, /\$\("online-code-input"\)\.disabled = inviteMode/);
  assert.match(game, /if \(!client\.resume\(invitedRoom\)\) setInviteMode\(true, invitedRoom\)/);
  assert.match(css, /#screen-online:not\(\.hidden\)[\s\S]*?touch-action: pan-y/);
  assert.match(html, /<span>複製房號<\/span>[\s\S]*?id="btn-online-copy"/);
  assert.match(client, /async copyRoomCode\(\)[\s\S]*?writeText\(roomCode\)/);
  assert.match(game, /playerLabel = `\$\{player\.name\}\$\{seat === room\.hostSeat \? "（房主）" : ""\}`/);
  assert.match(css, /\.online-players \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.online-lobby-actions \{[\s\S]*?position: fixed/);
  assert.match(game, /function playOnlineVsIntro\(\)/);
  assert.match(game, /priorPhase === "lobby"\) playOnlineVsIntro\(\)/);
  assert.match(css, /\.vs-stage\.online-vs > \.vs-face\.p2 \{ display: none; \}/);
  assert.match(css, /\.vs-stage\.online-vs \.vs-inner \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
});

test("online listen audio prefers static MP3 and remains server scheduled", () => {
  const audio = read("game-audio.js");
  const online = read("game-online.js");
  const worker = read("worker/src/room-core.mjs");
  assert.match(audio, /const ttsBlobCache = new Map\(\)/);
  assert.match(audio, /async function prepareQuestionAudio/);
  assert.match(audio, /async function scheduleQuestionAudio/);
  assert.match(audio, /assets\/audio\/questions\/manifest\.json/);
  assert.match(audio, /function unlockTtsPlayback\(\)/);
  assert.match(audio, /const ttsUnlock = unlockTtsPlayback\(\)/);
  assert.match(online, /scheduleQuestionAudio\(question, \{ delayMs \}\)/);
  assert.match(online, /replayQuestion\(\)[\s\S]*?speakQuestionAudio\(q\)/);
  assert.doesNotMatch(online, /playQuestionAudio\(q\)/);
  assert.match(worker, /listenCue: null/);
  assert.match(worker, /playAt: now \+ Math\.max\(0, delayMs\)/);
});

test("correct answers reveal kanji, reading, and Chinese in every mode", () => {
  const game = read("game.js");
  const online = read("game-online.js");
  const worker = read("worker/src/room-core.mjs");
  const css = read("styles.css");
  assert.match(game, /function wordRevealCopy\(q\)/);
  assert.match(game, /if \(q\.zh\) subBits\.push\(q\.zh\)/);
  assert.match(game, /\$\("reward-title"\)\.textContent = reveal\.title/);
  assert.match(online, /showWordReveal\(player, questionById\(event\.questionId\)\)/);
  assert.match(online, /showWordReveal\(1, question\);\s*showWordReveal\(2, question\)/);
  assert.match(game, /document\.body\.classList\.contains\("online-battle"\)[\s\S]*?\$\("board1"\)/);
  assert.match(worker, /performAttack\(room, seat, now, true, question\.id\)/);
  assert.match(css, /\.word-reveal \{ animation: none !important; opacity: 1 !important/);
  assert.match(css, /\.board \.word-reveal \{[\s\S]*?bottom: 72px/);
});

test("phone battle pools cap at twelve readable options in two rows", () => {
  const content = read("game-content.js");
  const game = read("game.js");
  const css = read("styles.css");
  assert.match(content, /Math\.max\(0, 12 - correct\.length\)/);
  assert.match(game, /this\.pool\.length <= 10 \? "five" : "six"/);
  assert.match(css, /pool\[data-layout="six"\][\s\S]*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /height: 54px/);
  assert.match(game, /tile\.setAttribute\("aria-label", `假名 \$\{item\.kana\}，已選入第 \$\{idx \+ 1\} 格`\)/);
  assert.match(css, /\.tile\.used \{[\s\S]*?transform: translateY\(3px\) scale\(0\.97\)/);
  assert.match(css, /\.tile\.used::after \{[\s\S]*?content: "✓"/);
});

test("desktop media and phone online duel keep full artwork and compact actions", () => {
  const html = read("index.html");
  const css = read("styles.css");
  assert.match(css, /\.cover-art \{[\s\S]*?object-fit: contain/);
  assert.match(css, /\.special-stage video, \.special-stage \.special-still \{[\s\S]*?object-fit: contain/);
  assert.equal((html.match(/class="duel-vitals"/g) || []).length, 2);
  assert.equal((html.match(/class="utility-actions"/g) || []).length, 2);
  assert.match(css, /Phone online duel[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-rows: auto minmax\(230px, 34dvh\) auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.duel-art \.fighter img \{[\s\S]*?object-fit: cover/);
  assert.match(css, /\.duel-half\.p1 \.board \{[\s\S]*?justify-content: flex-end/);
  assert.match(css, /\.board \.actions \{[\s\S]*?grid-template-columns: minmax\(100px, 0\.88fr\) minmax\(106px, 1\.15fr\) minmax\(76px, 0\.82fr\)/);
  assert.match(css, /\.board \.actions \.btn \{[\s\S]*?min-height: 46px/);
});

test("online result uses one upright, aligned comparison view", () => {
  const game = read("game.js");
  const online = read("game-online.js");
  const css = read("styles.css");
  assert.match(game, /customRows \|\| \(withBattleStats \? buildBattleStatsRows\(\) : ""\)/);
  assert.match(online, /button\.textContent = "離開對戰"/);
  assert.match(game, /KanaBattleOnline\?\.isActive\(\)[\s\S]*?KanaBattleOnline\.leaveBattle\(\)/);
  assert.match(game, /document\.querySelectorAll\("\.btn-again"\)[\s\S]*?KanaBattleOnline\.returnToLobby\(\)/);
  assert.match(online, /statRow\("最快答題"/);
  assert.match(online, /statRow\("平均答題"/);
  assert.match(online, /statRow\("錯誤次數"/);
  assert.doesNotMatch(online.slice(online.indexOf("function finishOnlineBattle")), /先開大招/);
  assert.match(online, /`對戰時間 \$\{seconds\.toFixed\(1\)\} 秒`/);
  assert.match(online, /await playBattleDefeatOutro\(won \? 2 : 1, won \? 1 : 2\)/);
  assert.match(game, /async function playBattleDefeatOutro\(loser, winner\)/);
  assert.match(game, /loserEl\.classList\.add\("defeated"\)/);
  assert.match(game, /await playVoice\(loserCh && loserCh\.voiceDefeat, 1\)/);
  assert.match(css, /body\.online-battle #screen-result \.result-face\.p2 \{ display: none; \}/);
  assert.match(css, /grid-template-columns: minmax\(5\.5rem, 1fr\) minmax\(4\.5rem, 0\.78fr\) minmax\(4\.5rem, 0\.78fr\)/);
  assert.match(css, /html \{ font-size: 18px; \}/);
  assert.match(css, /linear-gradient\(155deg, #d9cfbf 0%, #f2eadc 48%, #cbbba4 100%\)/);
});

test("correct answer feedback floats without moving controls and long romaji scales down", () => {
  const game = read("game.js");
  const online = read("game-online.js");
  const css = read("styles.css");
  assert.match(game, /function showAnswerGain\(player, text\)/);
  assert.match(game, /showAnswerGain\(player, "答對 · \+" \+ gain\)/);
  assert.match(online, /showAnswerGain\(player, player === 1 \? `答對 · \+\$\{event\.gain\}`/);
  assert.match(css, /\.answer-gain-float \{[\s\S]*?position: absolute/);
  assert.match(css, /animation: answerGainDrop 2s/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.answer-gain-float \{ animation: none !important/);
  assert.match(game, /roma\.length >= 3\) slot\.classList\.add\("roma-wide"\)/);
  assert.match(css, /\.slot\.roma-wide \.roma \{[\s\S]*?font-size: clamp/);
});

test("mobile audio restores after returning to the browser and on the next gesture", () => {
  const audio = read("game-audio.js");
  assert.match(audio, /async function restoreBattleAudio\(\)/);
  assert.match(audio, /document\.addEventListener\("visibilitychange"/);
  assert.match(audio, /window\.addEventListener\("pageshow"/);
  assert.match(audio, /\["pointerdown", "touchend", "keydown"\]/);
  assert.match(audio, /audioCtx\.state !== "running"/);
  assert.match(audio, /sharedTtsAudio\.setAttribute\("playsinline", ""\)/);
});

test("online submit acknowledges touch immediately while the server remains authoritative", () => {
  const online = read("game-online.js");
  const css = read("styles.css");
  assert.match(online, /setSubmitPending\(true\);\s*boards\[1\]\.setFeedback\("判定中…"\)/);
  assert.match(online, /if \(submitPending\) return/);
  assert.match(online, /client\.submit\(localQuestionId/);
  assert.match(css, /\.btn-submit:active,[\s\S]*?\.btn-submit\.is-pending/);
});
