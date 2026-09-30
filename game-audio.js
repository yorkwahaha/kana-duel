/* global battleOpen */
// Audio and TTS runtime extracted from game.js.
// —— TTS (JPAPP Google) ——
const TTS_PROXY_URL = "https://jpapp-tts-proxy.yorkwahaha.workers.dev/tts";
const TTS_SESSION_URL = "https://jpapp-tts-proxy.yorkwahaha.workers.dev/session";
const TTS_VOICE = "ja-JP-Neural2-B";
let sessionTokenData = null, currentTtsAudio = null, currentCloudTtsObjectUrl = null, ttsSessionId = 0;
let ttsStartTimer = null, ttsStartResolve = null;
const ttsBlobCache = new Map();
const ttsRequestCache = new Map();
const sharedTtsAudio = new Audio();
const SILENT_TTS_UNLOCK_SRC = "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
const TTS_VOLUME = 1;
function audioPreference(key) { return window.KanaLearning?.settings()[key] ?? 1; }
function applyAudioSettings() {
  applyBgmVolume();
  if (characterSelectBgm) characterSelectBgm.volume = CHARACTER_SELECT_BGM_VOL * audioPreference("bgm");
  sharedTtsAudio.volume = TTS_VOLUME * audioPreference("voice");
  if (currentQuestionGain) currentQuestionGain.gain.value = audioPreference("voice");
  if (currentQuestionAudioSource) currentQuestionAudioSource.playbackRate.value = audioPreference("speed");
  if (currentQuestionHtml) { currentQuestionHtml.volume = audioPreference("voice"); currentQuestionHtml.playbackRate = audioPreference("speed"); }
  if (voiceGain) voiceGain.gain.value = voiceGainBaseVolume * audioPreference("voice");
  if (voiceHtml) voiceHtml.volume = audioPreference("voice");
  const video = document.getElementById("special-video");
  if (video) video.volume = audioPreference("voice");
}
let ttsPlaybackUnlocked = false;
let ttsUnlockPromise = null;
let ttsUnlockGen = 0;
let currentTtsSettle = null;
sharedTtsAudio.preload = "auto";
sharedTtsAudio.setAttribute("playsinline", "");
sharedTtsAudio.setAttribute("webkit-playsinline", "");

function unlockTtsPlayback(force = false) {
  if (currentTtsAudio === sharedTtsAudio && !sharedTtsAudio.paused) {
    ttsPlaybackUnlocked = true;
    return Promise.resolve(true);
  }
  if (!force && ttsPlaybackUnlocked) return Promise.resolve(true);
  if (ttsUnlockPromise) return ttsUnlockPromise;
  const gen = ++ttsUnlockGen;
  sharedTtsAudio.volume = 0.001;
  sharedTtsAudio.src = SILENT_TTS_UNLOCK_SRC;
  const attempt = sharedTtsAudio.play();
  let unlockTimer;
  const boundedAttempt = Promise.race([Promise.resolve(attempt), new Promise((_, reject) => {
    unlockTimer = setTimeout(() => reject(new Error("audio unlock timeout")), 1500);
  })]);
  const restoreVolume = () => { sharedTtsAudio.volume = TTS_VOLUME * audioPreference("voice"); };
  ttsUnlockPromise = boundedAttempt.then(() => {
    restoreVolume();
    if (gen !== ttsUnlockGen) return false;
    sharedTtsAudio.pause();
    sharedTtsAudio.currentTime = 0;
    ttsPlaybackUnlocked = true;
    return true;
  }).catch(() => false).finally(() => {
    clearTimeout(unlockTimer);
    restoreVolume();
    if (gen !== ttsUnlockGen) return;
    ttsUnlockPromise = null;
  });
  return ttsUnlockPromise;
}
function revokeCloudUrl(url = currentCloudTtsObjectUrl) {
  if (!url) return;
  if (url === currentCloudTtsObjectUrl) currentCloudTtsObjectUrl = null;
  try { URL.revokeObjectURL(url); } catch {}
}
function settleTts(ok) {
  const settle = currentTtsSettle;
  currentTtsSettle = null;
  if (settle) settle(ok);
  else document.getElementById("portrait")?.classList.remove("speaking");
}
function stopTts() {
  ttsSessionId++; revokeCloudUrl();
  stopQuestionAudio();
  if (ttsStartTimer) clearTimeout(ttsStartTimer);
  ttsStartTimer = null;
  if (ttsStartResolve) ttsStartResolve(false);
  ttsStartResolve = null;
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); currentTtsAudio.currentTime = 0; currentTtsAudio.onended = null; currentTtsAudio.onerror = null; } catch {}
    currentTtsAudio = null;
  }
  settleTts(false);
}
let sessionTokenPromise = null;
let sessionTokenFailedAt = 0;
async function getSessionToken() {
  if (sessionTokenData && sessionTokenData.exp > Date.now() + 5000) return sessionTokenData.token;
  if (Date.now() - sessionTokenFailedAt < 5000) throw new Error("session");
  if (!sessionTokenPromise) {
    sessionTokenPromise = (async () => {
      try {
        const res = await fetch(TTS_SESSION_URL, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error("session");
        sessionTokenData = await res.json();
        sessionTokenFailedAt = 0;
        return sessionTokenData.token;
      } catch (error) {
        sessionTokenFailedAt = Date.now();
        sessionTokenData = null;
        throw error;
      }
    })().finally(() => { sessionTokenPromise = null; });
  }
  return sessionTokenPromise;
}
function cleanTtsText(text) {
  return String(text || "").replace(/<[^>]*>/g, "").trim();
}
function rememberTtsBlob(key, blob) {
  if (ttsBlobCache.has(key)) ttsBlobCache.delete(key);
  ttsBlobCache.set(key, blob);
  while (ttsBlobCache.size > 24) ttsBlobCache.delete(ttsBlobCache.keys().next().value);
  return blob;
}
async function prepareGoogleTts(text, { rate = "1.0" } = {}) {
  const clean = cleanTtsText(text);
  if (!clean) return null;
  const key = `${TTS_VOICE}|${rate}|${clean}`;
  if (ttsBlobCache.has(key)) return { key, blob: ttsBlobCache.get(key) };
  if (!ttsRequestCache.has(key)) {
    ttsRequestCache.set(key, (async () => {
      let res = null;
      try {
        for (let i = 0; i < 2; i++) {
          if (i > 0) await new Promise((resolve) => setTimeout(resolve, 300));
          const token = await getSessionToken();
          res = await fetch(TTS_PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Session-Token": token },
            body: JSON.stringify({ text: clean, voice: TTS_VOICE, rate: String(rate), pitch: "0.0" }),
          });
          if (res.status === 401) { sessionTokenData = null; continue; }
          break;
        }
      } catch { res = null; }
      if (res?.status === 401) throw new Error("TTS 401 after token refresh");
      if (!res?.ok) throw new Error("TTS " + (res?.status || "network"));
      return rememberTtsBlob(key, await res.blob());
    })().finally(() => ttsRequestCache.delete(key)));
  }
  try {
    return { key, blob: await ttsRequestCache.get(key) };
  } catch {
    return null;
  }
}
function waitForTtsStart(delayMs, my) {
  if (delayMs <= 4) return Promise.resolve(my === ttsSessionId);
  return new Promise((resolve) => {
    ttsStartResolve = resolve;
    ttsStartTimer = setTimeout(() => {
      ttsStartTimer = null;
      ttsStartResolve = null;
      resolve(my === ttsSessionId);
    }, delayMs);
  });
}
function playPreparedGoogleTts(prepared, my) {
  if (!prepared?.blob || my !== ttsSessionId) return Promise.resolve(false);
  document.getElementById("portrait")?.classList.add("speaking");
  const url = URL.createObjectURL(prepared.blob);
  revokeCloudUrl(); currentCloudTtsObjectUrl = url;
  const a = sharedTtsAudio; currentTtsAudio = a;
  a.volume = TTS_VOLUME * audioPreference("voice");
  return new Promise((resolve) => {
    let settled = false;
    const hardTimer = setTimeout(() => done(false), 30000);
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (currentTtsSettle === done) currentTtsSettle = null;
      if (currentTtsAudio === a) currentTtsAudio = null;
      revokeCloudUrl(url);
      document.getElementById("portrait")?.classList.remove("speaking");
      resolve(ok);
    };
    currentTtsSettle = done;
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
    a.play().then(() => {
      ttsPlaybackUnlocked = true;
      setTtsStatus(true, "Google TTS · " + TTS_VOICE);
    }).catch(() => {
      setTtsStatus(false, "請點「再聽」重播");
      done(false);
    });
  });
}
async function scheduleGoogleTts(text, { rate = String(audioPreference("speed")), delayMs = 0 } = {}) {
  const clean = cleanTtsText(text);
  if (!clean) return false;
  stopTts();
  const my = ttsSessionId;
  const target = performance.now() + Math.max(0, Number(delayMs) || 0);
  const prepared = await prepareGoogleTts(clean, { rate });
  if (!prepared) {
    if (my === ttsSessionId) setTtsStatus(false, "TTS 失敗");
    return false;
  }
  if (!await waitForTtsStart(Math.max(0, target - performance.now()), my)) return false;
  return playPreparedGoogleTts(prepared, my);
}
async function speakGoogleTts(text, { rate = String(audioPreference("speed")) } = {}) {
  return scheduleGoogleTts(text, { rate, delayMs: 0 });
}

// —— 題目語音：優先使用可預載的靜態 MP3，缺檔才退回雲端 TTS ——
let questionAudioManifestPromise = null;
const questionAudioBufferCache = new Map();
const questionAudioPending = new Map();
const QUESTION_AUDIO_CACHE_MAX = 48;
let questionAudioSessionId = 0;
let currentQuestionAudioSource = null;
let currentQuestionGain = null;
let currentQuestionAudioResolve = null;
let currentQuestionHtml = null;
function stopQuestionAudio() {
  questionAudioSessionId += 1;
  if (currentQuestionAudioSource) {
    try { currentQuestionAudioSource.onended = null; currentQuestionAudioSource.stop(0); currentQuestionAudioSource.disconnect(); } catch {}
    currentQuestionAudioSource = null;
  }
  if (currentQuestionAudioResolve) currentQuestionAudioResolve(false);
  currentQuestionAudioResolve = null;
}
async function playQuestionHtml(question, target, my) {
  const record = (await loadQuestionAudioManifest())?.get(question.id);
  if (!record?.file || my !== questionAudioSessionId) return false;
  const audio = new Audio(record.file);
  audio.volume = audioPreference("voice");
  audio.playbackRate = audioPreference("speed");
  audio.setAttribute("playsinline", "");
  currentQuestionHtml = audio;
  return new Promise((resolve) => {
    let startTimer;
    let hardTimer;
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer); clearTimeout(hardTimer);
      audio.onended = null; audio.onerror = null;
      try { audio.pause(); } catch {}
      if (currentQuestionHtml === audio) currentQuestionHtml = null;
      if (currentQuestionAudioResolve === done) currentQuestionAudioResolve = null;
      resolve(ok);
    };
    currentQuestionAudioResolve = done;
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    const delay = Math.max(0, target - performance.now());
    const start = () => {
      if (my !== questionAudioSessionId) return done(false);
      audio.play().then(() => setTtsStatus(true, "本地題目 MP3")).catch(() => done(false));
    };
    hardTimer = setTimeout(() => done(false), delay + 30000);
    if (delay) startTimer = setTimeout(start, delay);
    else start();
  });
}
function rememberQuestionBuffer(id, buffer) {
  if (questionAudioBufferCache.has(id)) questionAudioBufferCache.delete(id);
  questionAudioBufferCache.set(id, buffer);
  while (questionAudioBufferCache.size > QUESTION_AUDIO_CACHE_MAX) {
    questionAudioBufferCache.delete(questionAudioBufferCache.keys().next().value);
  }
  return buffer;
}
async function loadQuestionAudioManifest() {
  if (!questionAudioManifestPromise) {
    questionAudioManifestPromise = fetch("assets/audio/questions/manifest.json")
      .then((response) => response.ok ? response.json() : null)
      .then((manifest) => {
        if (!manifest?.records || !Array.isArray(manifest.records)) return null;
        return new Map(manifest.records.map((record) => [record.id, record]));
      })
      .catch(() => null);
  }
  const manifest = await questionAudioManifestPromise;
  if (!manifest) questionAudioManifestPromise = null;
  return manifest;
}
async function prepareQuestionAudio(question) {
  if (!question?.id) return null;
  if (questionAudioBufferCache.has(question.id)) {
    const cached = questionAudioBufferCache.get(question.id);
    questionAudioBufferCache.delete(question.id);
    questionAudioBufferCache.set(question.id, cached);
    return cached;
  }
  if (questionAudioPending.has(question.id)) return questionAudioPending.get(question.id);
  const pending = (async () => {
    const manifest = await loadQuestionAudioManifest();
    const record = manifest?.get(question.id);
    if (!record?.file) return null;
    const ctx = await ensureAudioCtx();
    if (!ctx) return null;
    const response = await fetch(record.file);
    if (!response.ok) return null;
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    return rememberQuestionBuffer(question.id, buffer);
  })().catch(() => null).finally(() => questionAudioPending.delete(question.id));
  questionAudioPending.set(question.id, pending);
  return pending;
}
async function scheduleQuestionAudio(question, { delayMs = 0 } = {}) {
  if (!question) return false;
  stopTts();
  const my = questionAudioSessionId;
  const target = performance.now() + Math.max(0, Number(delayMs) || 0);
  const buffer = await prepareQuestionAudio(question);
  if (!buffer || my !== questionAudioSessionId) {
    if (my !== questionAudioSessionId) return false;
    if (await playQuestionHtml(question, target, my)) return true;
    if (my !== questionAudioSessionId) return false;
    return scheduleGoogleTts(question.speakText, { delayMs: Math.max(0, target - performance.now()) });
  }
  const ctx = await ensureAudioCtx();
  if (my !== questionAudioSessionId) return false;
  if (!ctx || ctx.state !== "running") {
    if (await playQuestionHtml(question, target, my)) return true;
    if (my !== questionAudioSessionId) return false;
    return scheduleGoogleTts(question.speakText, { delayMs: Math.max(0, target - performance.now()) });
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = audioPreference("voice");
  source.buffer = buffer;
  source.playbackRate.value = audioPreference("speed");
  source.connect(gain);
  gain.connect(ctx.destination);
  currentQuestionAudioSource = source;
  currentQuestionGain = gain;
  return new Promise((resolve) => {
    const done = (ok) => {
      if (currentQuestionAudioSource === source) currentQuestionAudioSource = null;
      if (currentQuestionGain === gain) currentQuestionGain = null;
      if (currentQuestionAudioResolve === done) currentQuestionAudioResolve = null;
      try { source.disconnect(); gain.disconnect(); } catch {}
      resolve(ok);
    };
    currentQuestionAudioResolve = done;
    source.onended = () => done(true);
    source.start(ctx.currentTime + Math.max(0, target - performance.now()) / 1000);
    setTtsStatus(true, "本地題目 MP3");
  });
}
async function speakQuestionAudio(question) {
  return scheduleQuestionAudio(question, { delayMs: 0 });
}
function setTtsStatus(ok, msg) {
  const el = document.getElementById("tts-boot");
  if (!el) return;
  el.textContent = "TTS：" + msg;
  el.className = "tts-status " + (ok ? "ok" : "err");
}
const sfxCache = new Map();
const sfxBufCache = new Map();
const sfxLoadPending = new Map();
const sfxMissing = new Set();
const voiceBufCache = new Map();
let audioCtx = null;
let audioCtxHasRun = false;
let audioInterrupted = false;
let sfxDuckFactor = 1;
let voiceHtml = null;
let voiceWebSrc = null;
let voiceWebCleanup = null;
let voiceGain = null;
let voiceGainBaseVolume = 1;
let voiceEpoch = 0;
let voiceHtmlCleanup = null;
function stopVoice() {
  voiceEpoch += 1;
  try { if (voiceWebSrc) voiceWebSrc.stop(0); } catch {}
  if (voiceWebCleanup) voiceWebCleanup();
  if (voiceHtmlCleanup) voiceHtmlCleanup(false);
  voiceWebSrc = null;
  if (voiceHtml) {
    try { voiceHtml.pause(); voiceHtml.removeAttribute("src"); voiceHtml.load(); } catch {}
    voiceHtml = null;
  }
}
function setSfxDuck(factor) {
  sfxDuckFactor = Math.max(0, Math.min(1, factor));
}
function playSfx(name, volume = 0.45) {
  try {
    const vol = Math.min(1, volume * sfxDuckFactor * audioPreference("sfx"));
    if (vol <= 0.001) return;
    if (audioCtx?.state === "running" && sfxBufCache.has(name)) {
      const src = audioCtx.createBufferSource();
      const g = audioCtx.createGain();
      g.gain.value = vol;
      src.buffer = sfxBufCache.get(name);
      src.connect(g);
      g.connect(audioCtx.destination);
      src.onended = () => { src.disconnect(); g.disconnect(); };
      src.start(0);
      return;
    }
    let a = sfxCache.get(name);
    if (!a) { a = new Audio("assets/sfx/" + name + ".mp3"); sfxCache.set(name, a); }
    const c = a.cloneNode(); c.volume = vol; c.play().catch(() => {});
  } catch {}
}
/** Hit 1～5 越打越痛；缺檔退回 sfx_hit。走 Web Audio，大招影片後仍聽得到。 */
function playHitSfx(hitIndex) {
  if (sfxDuckFactor <= 0.05) return;
  const n = Math.max(1, Math.min(5, hitIndex));
  const vol = 0.32 + n * 0.12;
  const preferred = "hit" + n;
  const name = sfxMissing.has(preferred) ? "sfx_hit" : preferred;
  if (audioCtx && (sfxBufCache.has(name) || sfxBufCache.has("sfx_hit"))) {
    playSfx(sfxBufCache.has(name) ? name : "sfx_hit", vol);
    return;
  }
  try {
    let a = sfxCache.get(name);
    if (!a) {
      a = new Audio("assets/sfx/" + name + ".mp3");
      sfxCache.set(name, a);
    }
    const c = a.cloneNode();
    c.volume = Math.min(1, vol * sfxDuckFactor * audioPreference("sfx"));
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      playSfx("sfx_hit", vol);
    };
    c.addEventListener("error", fallback, { once: true });
    c.play().catch(fallback);
  } catch {
    playSfx("sfx_hit", vol);
  }
}
function loadSfxBuffer(ctx, name) {
  if (sfxBufCache.has(name)) return Promise.resolve(sfxBufCache.get(name));
  if (sfxMissing.has(name)) return Promise.resolve(null);
  if (sfxLoadPending.has(name)) return sfxLoadPending.get(name);
  const pending = (async () => {
    const res = await fetch("assets/sfx/" + name + ".mp3");
    if (!res.ok) {
      if (res.status === 404) sfxMissing.add(name);
      return null;
    }
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    sfxBufCache.set(name, buf);
    return buf;
  })().catch(() => null).finally(() => sfxLoadPending.delete(name));
  sfxLoadPending.set(name, pending);
  return pending;
}
async function preloadBattleSfx() {
  const ctx = await ensureAudioCtx();
  if (!ctx) return;
  const names = ["hit1", "hit2", "hit3", "hit4", "hit5", "sfx_hit", "sfx_click", "sfx_miss", "ready", "skillpop", "fanfare", "win"];
  await Promise.all(names.map((name) => loadSfxBuffer(ctx, name)));
}

// —— 選角 BGM ——
const CHARACTER_SELECT_BGM_PATH = "assets/bgm/character-select.ogg";
const CHARACTER_SELECT_BGM_VOL = 0.11;
let characterSelectBgm = null;
let characterSelectBgmUnavailable = false;

async function startCharacterSelectBgm(opts = {}) {
  if (characterSelectBgmUnavailable) return false;
  if (!characterSelectBgm) {
    characterSelectBgm = new Audio(CHARACTER_SELECT_BGM_PATH);
    characterSelectBgm.loop = true;
    characterSelectBgm.preload = "auto";
    characterSelectBgm.volume = CHARACTER_SELECT_BGM_VOL * audioPreference("bgm");
    characterSelectBgm.setAttribute("playsinline", "");
    characterSelectBgm.setAttribute("webkit-playsinline", "");
    characterSelectBgm.addEventListener("error", () => { characterSelectBgmUnavailable = true; }, { once: true });
  }
  if (opts.force) {
    try { characterSelectBgm.pause(); } catch {}
  } else if (!characterSelectBgm.paused) {
    return true;
  }
  try {
    await characterSelectBgm.play();
    return true;
  } catch {
    return false;
  }
}

function stopCharacterSelectBgm() {
  if (!characterSelectBgm) return;
  try {
    characterSelectBgm.pause();
    characterSelectBgm.currentTime = 0;
  } catch {}
}

// —— 戰鬥 BGM：Web Audio 迴圈播，避免影片搶焦點時被暫停 ——
const BATTLE_BGM_PATHS = [
  "assets/bgm/battle-1.ogg",
  "assets/bgm/battle-2.ogg",
  "assets/bgm/battle-3.ogg",
];
const BATTLE_BGM_VOL = 0.12;
const battleBgmBufferCache = new Map();
const battleBgmPending = new Map();
let bgmGain = null;
let bgmSource = null;
let bgmHtmlFallback = null;
let bgmWatchdog = null;
let bgmSessionId = 0;
let queuedBattleBgmPath = "";

function chooseBattleBgmPath() {
  if (!queuedBattleBgmPath) {
    queuedBattleBgmPath = BATTLE_BGM_PATHS[Math.floor(Math.random() * BATTLE_BGM_PATHS.length)];
  }
  return queuedBattleBgmPath;
}

async function ensureAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AC();
    audioCtxHasRun = false;
    audioCtx.addEventListener("statechange", onAudioCtxStateChange);
  }
  // Autoplay policy may leave resume pending until a later gesture.
  if (audioCtx.state !== "running") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function onAudioCtxStateChange() {
  if (!audioCtx) return;
  const running = audioCtx.state === "running";
  if (running) audioCtxHasRun = true;
  if (audioCtx.state === "interrupted" || (audioCtx.state === "suspended" && audioCtxHasRun)) {
    markAudioInterrupted();
    return;
  }
  if (running && audioInterrupted) requestBattleAudioRestore(true);
}
function clearBgmWatchdog() {
  if (bgmWatchdog) { clearInterval(bgmWatchdog); bgmWatchdog = null; }
}
function stopBattleBgm() {
  bgmSessionId += 1;
  clearBgmWatchdog();
  try { if (bgmSource) { bgmSource.onended = null; bgmSource.stop(0); bgmSource.disconnect(); } } catch {}
  bgmSource = null;
  try { if (bgmGain) bgmGain.disconnect(); } catch {}
  bgmGain = null;
  if (bgmHtmlFallback) {
    try { bgmHtmlFallback.pause(); bgmHtmlFallback.src = ""; } catch {}
    bgmHtmlFallback = null;
  }
}
async function loadBattleBgmBuffer(src) {
  if (battleBgmBufferCache.has(src)) return battleBgmBufferCache.get(src);
  if (battleBgmPending.has(src)) return battleBgmPending.get(src);
  const pending = (async () => {
    const ctx = await ensureAudioCtx();
    if (!ctx) return null;
    const response = await fetch(src);
    if (!response.ok) return null;
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    battleBgmBufferCache.set(src, buffer);
    return buffer;
  })().finally(() => battleBgmPending.delete(src));
  battleBgmPending.set(src, pending);
  return pending;
}
async function preloadBattleBgm() {
  await loadBattleBgmBuffer(chooseBattleBgmPath()).catch(() => null);
}
function applyBgmVolume() {
  const volume = BATTLE_BGM_VOL * audioPreference("bgm");
  if (bgmGain && audioCtx) {
    try { bgmGain.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.03); } catch { bgmGain.gain.value = volume; }
  }
  if (bgmHtmlFallback) bgmHtmlFallback.volume = volume;
}
function keepBattleBgmAlive() {
  if (!battleOpen) return;
  if (audioInterrupted) {
    requestBattleAudioRestore(true);
    return;
  }
  if (audioCtx && audioCtx.state !== "running") audioCtx.resume().catch(() => {});
  if (bgmHtmlFallback && bgmHtmlFallback.paused) bgmHtmlFallback.play().catch(() => {});
  applyBgmVolume();
}
async function startBattleBgm() {
  stopBattleBgm();
  const my = bgmSessionId;
  const src = chooseBattleBgmPath();
  queuedBattleBgmPath = "";
  try {
    const ctx = await ensureAudioCtx();
    if (!ctx || ctx.state !== "running") throw new Error("AudioContext unavailable");
    const buf = await loadBattleBgmBuffer(src);
    if (!buf) throw new Error("bgm fetch fail");
    if (my !== bgmSessionId || !battleOpen) return false;
    bgmGain = ctx.createGain();
    bgmGain.gain.value = BATTLE_BGM_VOL * audioPreference("bgm");
    bgmGain.connect(ctx.destination);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.connect(bgmGain);
    node.start(0);
    bgmSource = node;
  } catch {
    if (my !== bgmSessionId || !battleOpen) return false;
    const a = new Audio(src);
    a.loop = true;
    a.volume = BATTLE_BGM_VOL * audioPreference("bgm");
    bgmHtmlFallback = a;
    a.play().catch(() => {});
  }
  clearBgmWatchdog();
  bgmWatchdog = setInterval(keepBattleBgmAlive, 250);
  preloadBattleSfx().catch(() => {});
  return true;
}
async function primeBattleAudio() {
  const ttsUnlock = unlockTtsPlayback();
  const ctx = await ensureAudioCtx();
  if (ctx) {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => source.disconnect();
    source.start(0);
  }
  await Promise.allSettled([ttsUnlock, preloadBattleSfx(), preloadBattleBgm()]);
}

let lastBattleAudioRestoreAt = 0;
let audioRestorePromise = null;

function isCharacterSelectScreen() {
  const chars = document.getElementById("screen-chars");
  const online = document.getElementById("screen-online");
  if (chars && !chars.classList.contains("hidden")) return true;
  if (online && !online.classList.contains("hidden") && !online.classList.contains("invite-mode")) return true;
  return false;
}
function markAudioInterrupted() {
  audioInterrupted = true;
  ttsPlaybackUnlocked = false;
  ttsUnlockGen += 1;
  ttsUnlockPromise = null;
  stopTts();
  try { if (characterSelectBgm && !characterSelectBgm.paused) characterSelectBgm.pause(); } catch {}
  try { if (bgmHtmlFallback && !bgmHtmlFallback.paused) bgmHtmlFallback.pause(); } catch {}
}
async function restoreBattleAudio() {
  const wasInterrupted = audioInterrupted;
  const ctx = await ensureAudioCtx();
  if (wasInterrupted || !ttsPlaybackUnlocked) await unlockTtsPlayback(true).catch(() => {});
  if (battleOpen) {
    const bgmDead = wasInterrupted || (!bgmSource && !bgmHtmlFallback) || (bgmHtmlFallback && bgmHtmlFallback.paused);
    if (bgmDead) await startBattleBgm();
    else keepBattleBgmAlive();
  } else if (isCharacterSelectScreen()) {
    await startCharacterSelectBgm({ force: wasInterrupted });
  }
  const running = !!(ctx && ctx.state === "running");
  if (running || (bgmHtmlFallback && !bgmHtmlFallback.paused) || (characterSelectBgm && !characterSelectBgm.paused)) {
    audioInterrupted = false;
  }
  return running;
}
function requestBattleAudioRestore(force = false) {
  if (audioRestorePromise) return audioRestorePromise;
  const now = performance.now();
  if (!force && now - lastBattleAudioRestoreAt < 350) return;
  lastBattleAudioRestoreAt = now;
  audioRestorePromise = restoreBattleAudio().catch(() => false).finally(() => { audioRestorePromise = null; });
  return audioRestorePromise;
}
function onPageHidden() { markAudioInterrupted(); }
function onPageShown() { requestBattleAudioRestore(true); }
document.addEventListener("visibilitychange", () => {
  if (document.hidden) onPageHidden();
  else onPageShown();
});
window.addEventListener("pagehide", onPageHidden);
window.addEventListener("pageshow", onPageShown);
window.addEventListener("freeze", onPageHidden);
window.addEventListener("resume", onPageShown);
window.addEventListener("focus", onPageShown);
["pointerdown", "touchstart", "keydown"].forEach((type) => {
  document.addEventListener(type, () => {
    if (audioCtx && audioCtx.state === "interrupted") markAudioInterrupted();
    if (audioCtx && audioCtx.state !== "running") audioCtx.resume().catch(() => {});
    unlockTtsPlayback(audioInterrupted).catch(() => {});
    requestBattleAudioRestore(true);
  }, { capture: true, passive: true });
});

// —— 墨域言靈闘場 · 8 角角色語音與大招影片 ——
// voiceHit / voiceDefeat：受擊／敗北語音；大招喊招改由 castVideo 內建音軌
// castVideo: 約 6 秒大招影片（含喊招＋發動音效）
