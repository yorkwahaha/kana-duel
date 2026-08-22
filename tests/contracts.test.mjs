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

test("approved Fish Audio pack covers every question exactly once", () => {
  const { ALL_QUESTIONS } = loadContentData();
  const manifest = JSON.parse(read("assets/audio/questions/manifest.json"));
  assert.equal(manifest.status, "approved");
  assert.equal(manifest.records.length, ALL_QUESTIONS.length);
  assert.equal(new Set(manifest.records.map((record) => record.id)).size, ALL_QUESTIONS.length);
  assert.deepEqual(
    manifest.records.map((record) => record.id).sort(),
    Array.from(ALL_QUESTIONS, (question) => question.id).sort(),
  );
  let totalBytes = 0;
  for (const record of manifest.records) {
    assert.match(record.file, /^assets\/audio\/questions\/fish-92428785\/[a-z0-9_]+\.mp3$/);
    const audio = fs.readFileSync(path.join(root, record.file));
    const isMp3 = audio.subarray(0, 3).toString("ascii") === "ID3"
      || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
    assert.equal(isMp3, true, `${record.id}: invalid MP3`);
    assert.equal(audio.length, record.bytes, `${record.id}: byte count mismatch`);
    totalBytes += audio.length;
  }
  assert.equal(totalBytes, manifest.totalBytes);
});

test("reviewed bank removes obscure names and provides categorized learning variety", () => {
  const { ALL_QUESTIONS } = loadContentData();
  const removed = ["custom_star", "custom_thunder", "custom_moon", "custom_flame", "custom_ice", "custom_wind", "custom_void", "custom_dragon", "custom_light", "custom_shadow", "sakura", "ashitaka", "chihiro", "howl", "genos", "ram", "hado31", "detroit", "expulsion", "seriouspunch", "malevolent", "shikai"];
  assert.equal(ALL_QUESTIONS.some((q) => removed.includes(q.id)), false, "obscure character and move ids must stay removed");
  assert.ok(new Set(ALL_QUESTIONS.map((q) => q.category)).size >= 14, "bank needs broad category coverage");
  const loanwords = ALL_QUESTIONS.filter((q) => q.category === "loanword");
  assert.equal(loanwords.length, 30, "dedicated loanword category should contain 30 questions");
  assert.ok(loanwords.every((q) => q.kanaSequence.every((part) => /^[\u30A0-\u30FFー]+$/.test(part))), "loanwords must practice katakana only");
  const actions = ALL_QUESTIONS.filter((q) => q.category === "action");
  assert.equal(actions.length, 34, "action category should include dictionary and polite-form verbs");
  assert.ok(actions.some((q) => q.id === "tabemasu"), "polite-form verbs must not fall back to daily conversation");
  assert.ok(actions.some((q) => q.id === "okiru" && q.speakText === "おきる"), "converted action ids and readings must stay aligned");
  assert.equal(ALL_QUESTIONS.filter((q) => q.category === "daily").length, 28);
  assert.equal(ALL_QUESTIONS.filter((q) => q.category === "food").length, 17);
  assert.equal(ALL_QUESTIONS.filter((q) => q.category === "animals").length, 4);
  assert.equal(ALL_QUESTIONS.find((q) => q.id === "ramen")?.category, "food");
  assert.equal(ALL_QUESTIONS.find((q) => q.id === "haru")?.category, "time_nature");
});

test("all referenced local media exist except explicitly deferred audio", () => {
  const sources = ["index.html", "game-content.js", "game-audio.js", "game-vfx.js", "game.js"]
    .map(read)
    .join("\n");
  const refs = new Set(sources.match(/assets\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g|mp3|wav|ogg|mp4)/g) || []);
  const missing = [...refs].filter((ref) => !exists(ref)).sort();
  const deferred = [
    "assets/bgm/character-select.ogg",
    ...["gen", "ran", "sho", "yo"]
      .flatMap((id) => [`assets/voice/${id}/defeat.mp3`, `assets/voice/${id}/hit.mp3`]),
  ].sort();
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

test("local two-player gestures preserve fast play without blocking accessibility zoom", () => {
  const html = read("index.html");
  const game = read("game.js");
  const css = read("styles.css");
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.doesNotMatch(game, /gesturestart|document\.addEventListener\("dblclick"/);
  assert.match(css, /html, body \{[\s\S]*?touch-action: manipulation/);
  assert.match(css, /\.board \.tile,[\s\S]*?touch-action: none !important/);
  assert.match(html, /id="reward-stage"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.equal((html.match(/role="status" aria-live="polite"/g) || []).length, 4);
  assert.equal((html.match(/class="card result-card" tabindex="-1"/g) || []).length, 2);
  assert.match(game, /result-face\.p1 \.result-card"\)\?\.focus/);
});

test("document and worker responses carry baseline browser security policy", () => {
  const html = read("index.html");
  const worker = read("worker/src/index.mjs");
  const policy = read("worker/src/http-policy.mjs");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /object-src 'none'; base-uri 'none'; form-action 'none'/);
  assert.match(worker, /"cache-control": "no-store"/);
  assert.match(worker, /"x-content-type-options": "nosniff"/);
  assert.match(policy, /return !!origin && allowedOrigins\(env\)\.includes\(origin\)/);
  assert.match(worker, /sec-websocket-protocol/);
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
  assert.match(online, /selectBattleQuestions\(config\)/);
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
  assert.match(html, /id="btn-online-leave"[\s\S]*?id="btn-online-copy"[^>]*>複製邀請連結<[\s\S]*?id="btn-online-ready"/);
  assert.match(client, /async copyInvite\(\)[\s\S]*?url\.searchParams\.set\("room", roomCode\)[\s\S]*?writeText\(url\.toString\(\)\)/);
  assert.match(game, /textContent = inviteMode \? "新建房間" : "建立房間"/);
  assert.match(game, /playerLabel = `\$\{player\.name\}\$\{seat === room\.hostSeat \? "（房主）" : ""\}`/);
  assert.match(css, /\.online-players \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.online-lobby-actions \{[\s\S]*?position: fixed[\s\S]*?grid-template-columns: 1fr 1\.25fr 1fr/);
  assert.match(game, /function playOnlineVsIntro\(\)/);
  assert.match(game, /priorPhase === "lobby"\) playOnlineVsIntro\(\)/);
  assert.match(game, /stage\?\.querySelector\(":scope > \.vs-face\.p1"\)/);
  assert.match(game, /onlineFace\?\.querySelector\("\.vs-fighter\.p1 img"\)/);
  assert.match(css, /\.vs-stage\.online-vs > \.vs-face\.p2 \{ display: none; \}/);
  assert.match(css, /\.vs-stage\.online-vs \.vs-inner \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
});

test("character selection reserves a BGM path and uses the kana click sound", () => {
  const audio = read("game-audio.js");
  const game = read("game.js");
  const online = read("game-online.js");
  assert.match(audio, /CHARACTER_SELECT_BGM_PATH = "assets\/bgm\/character-select\.ogg"/);
  assert.match(audio, /async function startCharacterSelectBgm\(\)/);
  assert.match(audio, /characterSelectBgmUnavailable/);
  assert.match(game, /function onPickChar\(player, c, withSound = true\)[\s\S]*?playSfx\("sfx_click"/);
  assert.match(online, /function stepCharacter\(delta\)[\s\S]*?playSfx\("sfx_click"/);
});

test("battle BGM preload fetches only the selected track", () => {
  const audio = read("game-audio.js");
  assert.match(audio, /function chooseBattleBgmPath\(\)/);
  assert.match(audio, /async function preloadBattleBgm\(\) \{\s*await loadBattleBgmBuffer\(chooseBattleBgmPath\(\)\)/);
  assert.doesNotMatch(audio, /Promise\.all\(BATTLE_BGM_PATHS\.map/);
});

test("result text is escaped before player tags are colorized", () => {
  const game = read("game.js");
  assert.match(game, /function escapeResultText\(text\)/);
  assert.match(game, /function colorizePlayerTags\(text\) \{\s*return escapeResultText\(text\)/);
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
  const game = read("game.js");
  const online = read("game-online.js");
  const css = read("styles.css");
  assert.match(online, /setSubmitPending\(true\);\s*boards\[1\]\.setFeedback\("判定中…"\)/);
  assert.match(online, /if \(submitPending\) return/);
  assert.match(online, /button\.disabled = true;\s*button\.textContent = "判定中…"/);
  assert.match(game, /window\.KanaBattleOnline\?\.isSubmitPending\?\.\(\)/);
  assert.match(online, /client\.submit\(localQuestionId/);
  assert.match(css, /\.btn-submit:active,[\s\S]*?\.btn-submit\.is-pending/);
});

test("rematch and submit guards keep client battle state consistent", () => {
  const game = read("game.js");
  const online = read("game-online.js");
  assert.match(online, /if \(active && priorPhase !== "lobby"\) \{\s*active = false;\s*battleOpen = false/);
  assert.match(online, /stopBattleBgm\(\);\s*pauseOverlay\(false\);\s*document\.body\.classList\.remove\("online-battle"\)/);
  assert.doesNotMatch(online, /listenRoundClaimed = room\.battle\.listenClaimed;\s*setSubmitPending\(false\)/);
  assert.match(online, /if \(localQuestionId !== localId\) setSubmitPending\(false\)/);
  assert.match(game, /if \(isListenBattle\(\) && listenRoundClaimed\)[\s\S]*?const wrong = b\.markSlots/);
  assert.match(game, /nowMs\(\) < submitCooldownUntil\[player\]/);
  assert.match(game, /!document\.body\.classList\.contains\("online-battle"\)/);
  assert.match(game, /function showDmgFloat[\s\S]*?if \(!el\) return/);
});
