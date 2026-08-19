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
function revokeCloudUrl(url = currentCloudTtsObjectUrl) {
  if (!url) return;
  if (url === currentCloudTtsObjectUrl) currentCloudTtsObjectUrl = null;
  try { URL.revokeObjectURL(url); } catch {}
}
function stopTts() {
  ttsSessionId++; revokeCloudUrl();
  if (ttsStartTimer) clearTimeout(ttsStartTimer);
  ttsStartTimer = null;
  if (ttsStartResolve) ttsStartResolve(false);
  ttsStartResolve = null;
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); currentTtsAudio.currentTime = 0; currentTtsAudio.onended = null; currentTtsAudio.onerror = null; } catch {}
    currentTtsAudio = null;
  }
}
async function getSessionToken() {
  if (sessionTokenData && sessionTokenData.exp > Date.now() + 5000) return sessionTokenData.token;
  const res = await fetch(TTS_SESSION_URL);
  if (!res.ok) throw new Error("session");
  sessionTokenData = await res.json();
  return sessionTokenData.token;
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
  return new Promise((resolve) => {
    const done = (ok) => {
      if (currentTtsAudio === a) currentTtsAudio = null;
      revokeCloudUrl(url);
      document.getElementById("portrait")?.classList.remove("speaking");
      resolve(ok);
    };
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
    a.play().then(() => setTtsStatus(true, "Google TTS · " + TTS_VOICE)).catch(() => done(false));
  });
}
async function scheduleGoogleTts(text, { rate = "1.0", delayMs = 0 } = {}) {
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
async function speakGoogleTts(text, { rate = "1.0" } = {}) {
  return scheduleGoogleTts(text, { rate, delayMs: 0 });
}
function setTtsStatus(ok, msg) {
  const el = document.getElementById("tts-boot");
  if (!el) return;
  el.textContent = "TTS：" + msg;
  el.className = "tts-status " + (ok ? "ok" : "err");
}
const sfxCache = new Map();
const sfxBufCache = new Map();
const voiceBufCache = new Map();
let audioCtx = null;
let sfxDuckFactor = 1;
let voiceHtml = null;
let voiceWebSrc = null;
function stopVoice() {
  try { if (voiceWebSrc) { voiceWebSrc.onended = null; voiceWebSrc.stop(0); voiceWebSrc.disconnect(); } } catch {}
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
    const vol = Math.min(1, volume * sfxDuckFactor);
    if (vol <= 0.001) return;
    if (audioCtx && sfxBufCache.has(name)) {
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const src = audioCtx.createBufferSource();
      const g = audioCtx.createGain();
      g.gain.value = vol;
      src.buffer = sfxBufCache.get(name);
      src.connect(g);
      g.connect(audioCtx.destination);
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
  if (audioCtx && (sfxBufCache.has(preferred) || sfxBufCache.has("sfx_hit"))) {
    playSfx(sfxBufCache.has(preferred) ? preferred : "sfx_hit", vol);
    return;
  }
  try {
    let a = sfxCache.get(preferred);
    if (!a) {
      a = new Audio("assets/sfx/" + preferred + ".mp3");
      a.addEventListener("error", () => {
        sfxCache.set(preferred, sfxCache.get("sfx_hit") || new Audio("assets/sfx/sfx_hit.mp3"));
      }, { once: true });
      sfxCache.set(preferred, a);
    }
    const c = a.cloneNode();
    c.volume = Math.min(1, vol * sfxDuckFactor);
    c.play().catch(() => playSfx("sfx_hit", vol));
  } catch {
    playSfx("sfx_hit", vol);
  }
}
async function preloadBattleSfx() {
  const ctx = await ensureAudioCtx();
  if (!ctx) return;
  const names = ["hit1", "hit2", "hit3", "hit4", "hit5", "sfx_hit", "sfx_click", "sfx_miss", "ready", "skillpop", "fanfare"];
  await Promise.all(names.map(async (name) => {
    if (sfxBufCache.has(name)) return;
    try {
      const res = await fetch("assets/sfx/" + name + ".mp3");
      if (!res.ok) return;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      sfxBufCache.set(name, buf);
    } catch {}
  }));
}

// —— 戰鬥 BGM：Web Audio 迴圈播，避免影片搶焦點時被暫停 ——
const BATTLE_BGM_PATHS = [
  "assets/bgm/battle-1.ogg",
  "assets/bgm/battle-2.ogg",
  "assets/bgm/battle-3.ogg",
];
const BATTLE_BGM_VOL = 0.12;
let bgmGain = null;
let bgmSource = null;
let bgmHtmlFallback = null;
let bgmWatchdog = null;

async function ensureAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  return audioCtx;
}
function clearBgmWatchdog() {
  if (bgmWatchdog) { clearInterval(bgmWatchdog); bgmWatchdog = null; }
}
function stopBattleBgm() {
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
function applyBgmVolume() {
  if (bgmGain && audioCtx) {
    try { bgmGain.gain.setTargetAtTime(BATTLE_BGM_VOL, audioCtx.currentTime, 0.03); } catch { bgmGain.gain.value = BATTLE_BGM_VOL; }
  }
  if (bgmHtmlFallback) bgmHtmlFallback.volume = BATTLE_BGM_VOL;
}
function keepBattleBgmAlive() {
  if (!battleOpen) return;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  if (bgmHtmlFallback && bgmHtmlFallback.paused) bgmHtmlFallback.play().catch(() => {});
  applyBgmVolume();
}
async function startBattleBgm() {
  stopBattleBgm();
  const src = BATTLE_BGM_PATHS[Math.floor(Math.random() * BATTLE_BGM_PATHS.length)];
  try {
    const ctx = await ensureAudioCtx();
    if (!ctx) throw new Error("no AudioContext");
    const res = await fetch(src);
    if (!res.ok) throw new Error("bgm fetch fail");
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    bgmGain = ctx.createGain();
    bgmGain.gain.value = BATTLE_BGM_VOL;
    bgmGain.connect(ctx.destination);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.connect(bgmGain);
    node.start(0);
    bgmSource = node;
  } catch {
    const a = new Audio(src);
    a.loop = true;
    a.volume = BATTLE_BGM_VOL;
    bgmHtmlFallback = a;
    a.play().catch(() => {});
  }
  clearBgmWatchdog();
  bgmWatchdog = setInterval(keepBattleBgmAlive, 250);
  preloadBattleSfx().catch(() => {});
}

// —— 墨域言靈闘場 · 第 1 期 4 角（v1.0）——
// voiceHit / voiceDefeat：受擊／敗北語音；大招喊招改由 castVideo 內建音軌
// castVideo: 約 6 秒大招影片（含喊招＋發動音效）
