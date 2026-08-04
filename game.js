// —— TTS (JPAPP Google) ——
const TTS_PROXY_URL = "https://jpapp-tts-proxy.yorkwahaha.workers.dev/tts";
const TTS_SESSION_URL = "https://jpapp-tts-proxy.yorkwahaha.workers.dev/session";
const TTS_VOICE = "ja-JP-Neural2-B";
let sessionTokenData = null, currentTtsAudio = null, currentCloudTtsObjectUrl = null, ttsSessionId = 0;
const sharedTtsAudio = new Audio();
function revokeCloudUrl(url = currentCloudTtsObjectUrl) {
  if (!url) return;
  if (url === currentCloudTtsObjectUrl) currentCloudTtsObjectUrl = null;
  try { URL.revokeObjectURL(url); } catch {}
}
function stopTts() {
  ttsSessionId++; revokeCloudUrl();
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
async function speakGoogleTts(text, { rate = "1.0" } = {}) {
  const clean = String(text || "").replace(/<[^>]*>/g, "").trim();
  if (!clean) return false;
  stopTts();
  const my = ttsSessionId;
  document.getElementById("portrait")?.classList.add("speaking");
  let res = null;
  // 取 token／發請求失敗時只回 false，不可 throw：呼叫端會用 await 卡住 busy 狀態
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
  if (!res?.ok) {
    document.getElementById("portrait")?.classList.remove("speaking");
    setTtsStatus(false, "TTS 失敗" + (res?.status ? " " + res.status : ""));
    return false;
  }
  if (my !== ttsSessionId) { document.getElementById("portrait")?.classList.remove("speaking"); return false; }
  const url = URL.createObjectURL(await res.blob());
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
const CHARACTERS = [
  {
    id: "ao", name: "墨切・蒼", title: "墨刃", skill: "一筆断空",
    image: "assets/characters/ao.webp",
    imageAtk: "assets/characters/ao-atk.webp",
    imageHit: "assets/characters/ao-hit.webp",
    castVideo: "assets/anim/ao-cast.mp4",
    voiceHit: "assets/voice/ao/hit.mp3",
    voiceDefeat: "assets/voice/ao/defeat.mp3",
    passive: { id: "ink_flow", label: "墨意蓄積", desc: "答對時大招槽 +2", gaugePerCorrect: 2 },
    active: { id: "ink_seal", label: "墨鎖", desc: "耗 2 COMBO · 鎖對手提交 5 秒", cost: 2 },
  },
  {
    id: "rin", name: "焔詠・燐", title: "焔詠", skill: "焦言劫火",
    image: "assets/characters/rin.webp",
    imageAtk: "assets/characters/rin-atk.webp",
    imageHit: "assets/characters/rin-hit.webp",
    castVideo: "assets/anim/rin-cast.mp4",
    voiceHit: "assets/voice/rin/hit.mp3",
    voiceDefeat: "assets/voice/rin/defeat.mp3",
    passive: { id: "ember_surge", label: "劫火倍加", desc: "大招 ×1.9，蓄力略慢", specialMult: 1.9, chargeMult: 0.9 },
    active: { id: "ember_steal", label: "奪焰", desc: "耗 2 COMBO · 偷對手蓄力約 1/5（至少 40）", cost: 2 },
  },
  {
    id: "ya", name: "霜鈴・夜", title: "霜鈴", skill: "千鈴凍結",
    image: "assets/characters/ya.webp",
    imageAtk: "assets/characters/ya-atk.webp",
    imageHit: "assets/characters/ya-hit.webp",
    castVideo: "assets/anim/ya-cast.mp4",
    voiceHit: "assets/voice/ya/hit.mp3",
    voiceDefeat: "assets/voice/ya/defeat.mp3",
    passive: { id: "frost_clear", label: "霜鈴澄心", desc: "字池少 2 個干擾字", distractorDelta: -2 },
    active: { id: "frost_seal", label: "霜封", desc: "耗 2 COMBO · 鎖對手攻擊／大招 4 秒", cost: 2 },
  },
  {
    id: "go", name: "雷拳・轟", title: "雷拳", skill: "轟鳴崩拳",
    image: "assets/characters/go.webp",
    imageAtk: "assets/characters/go-atk.webp",
    imageHit: "assets/characters/go-hit.webp",
    castVideo: "assets/anim/go-cast.mp4",
    voiceHit: "assets/voice/go/hit.mp3",
    voiceDefeat: "assets/voice/go/defeat.mp3",
    passive: { id: "thunder_chain", label: "連崩雷撃", desc: "攻擊連打多 2 下", hitBonus: 2 },
    active: { id: "thunder_amp", label: "連鳴", desc: "耗 2 COMBO · 下次攻擊再 +5 段", cost: 2 },
  },
  {
    id: "ran", name: "風蹴・嵐", title: "風蹴", skill: "嵐脚千刃",
    image: "assets/characters/ran.webp",
    imageAtk: "assets/characters/ran-atk.webp",
    imageHit: "assets/characters/ran-hit.webp",
    castVideo: "assets/anim/ran-cast.mp4",
    voiceHit: "assets/voice/ran/hit.mp3",
    voiceDefeat: "assets/voice/ran/defeat.mp3",
    passive: { id: "wind_rush", label: "風迅連脚", desc: "蓄力略快", chargeMult: 1.12 },
    active: { id: "wind_step", label: "風閃", desc: "耗 2 COMBO · 解除自身封鎖並格擋 3 秒", cost: 2 },
  },
  {
    id: "gen", name: "影刃・玄", title: "影刃", skill: "墨影千刹",
    image: "assets/characters/gen.webp",
    imageAtk: "assets/characters/gen-atk.webp",
    imageHit: "assets/characters/gen-hit.webp",
    castVideo: "assets/anim/gen-cast.mp4",
    voiceHit: "assets/voice/gen/hit.mp3",
    voiceDefeat: "assets/voice/gen/defeat.mp3",
    passive: { id: "shadow_cut", label: "影刃連斬", desc: "攻擊連打多 1 下", hitBonus: 1 },
    active: { id: "shadow_bind", label: "影縛", desc: "耗 2 COMBO · 鎖對手提交 5 秒", cost: 2 },
  },
  {
    id: "sho", name: "符筆・章", title: "符筆", skill: "万符封言",
    image: "assets/characters/sho.webp",
    imageAtk: "assets/characters/sho-atk.webp",
    imageHit: "assets/characters/sho-hit.webp",
    castVideo: "assets/anim/sho-cast.mp4",
    voiceHit: "assets/voice/sho/hit.mp3",
    voiceDefeat: "assets/voice/sho/defeat.mp3",
    passive: { id: "seal_eye", label: "符眼", desc: "字池少 1 個干擾字", distractorDelta: -1 },
    active: { id: "seal_silence", label: "封言", desc: "耗 2 COMBO · 鎖對手攻擊／大招 4 秒", cost: 2 },
  },
  {
    id: "yo", name: "光扇・陽", title: "光扇", skill: "扇華断空",
    image: "assets/characters/yo.webp",
    imageAtk: "assets/characters/yo-atk.webp",
    imageHit: "assets/characters/yo-hit.webp",
    castVideo: "assets/anim/yo-cast.mp4",
    voiceHit: "assets/voice/yo/hit.mp3",
    voiceDefeat: "assets/voice/yo/defeat.mp3",
    passive: { id: "light_bloom", label: "光華", desc: "大招 ×1.7，蓄力略慢", specialMult: 1.7, chargeMult: 0.92 },
    active: { id: "light_drain", label: "奪輝", desc: "耗 2 COMBO · 偷對手蓄力約 1/5（至少 40）", cost: 2 },
  },
];

const TYPE_LABEL = {
  character: "角色名",
  skill: "招式名",
  custom_skill: "自創招式",
  vocab: "詞彙",
};

/** 從 questions-data.js 載入；練習可抽樣、對戰用完整庫洗牌 */
function normalizeQuestions(list) {
  return (list || []).map((q, i) => {
    const seq = (q.kanaSequence || []).slice(0, 16);
    return {
      ...q,
      id: q.id || ("q_" + i),
      kanaSequence: seq,
      speakText: q.speakText || seq.join(""),
      kanji: q.kanji || null,
      zh: q.zh || null,
      // 預設隱藏答案文字（聽音拼字才有練習效果）
      hideDisplayNameUntilClear: q.hideDisplayNameUntilClear !== false,
      rewardMode: q.rewardMode || (q.contentType === "skill" || q.contentType === "custom_skill" ? "cast_skill" : "celebrate"),
      image: q.image || defaultImageFor(q),
      castVideo: q.castVideo || null,
    };
  }).filter((q) => q.kanaSequence.length >= 1);
}
function questionPromptTitle(q) {
  if (!q.hideDisplayNameUntilClear) return q.displayName;
  return `聽音拼假名（${q.kanaSequence.length} 格）`;
}
function defaultImageFor(q) {
  if (q.contentType === "skill" || q.contentType === "custom_skill") return "assets/characters/rin.webp";
  if (q.contentType === "character") return "assets/characters/ao.webp";
  return "assets/characters/ya.webp";
}
const ALL_QUESTIONS = normalizeQuestions(window.KANA_QUESTIONS || []);
let QUESTIONS = ALL_QUESTIONS.slice();
const PRACTICE_ROUND_SIZE = 12; // 單人一輪題數（從大題庫抽）
const MAX_HP = 2400;
const GAUGE_HITS_TO_FULL = 8;
const SPECIAL_MULT = 1.55;
const COMBO_DAMAGE_PER_HIT = 0.05; // 每多一段連打 +5% 總傷
const MAX_ATTACK_SEGMENTS = 8; // 演出段數上限；傷害仍照完整段數計算
const MISS_SELF_DMG_PER_WRONG = 72; // 答錯每格對自己扣血
const DRAG_THRESHOLD = 4;
const BLOCK_COMBO_COST = 1;
const BLOCK_DURATION_MS = 2000;
const BLOCK_DAMAGE_MULT = 0.5;
const HEAL_COMBO_COST = 2;
const HEAL_AMOUNT = 200;
const SUBMIT_LOCK_MS = 5000;
const ATTACK_LOCK_MS = 4000;
const STEAL_CHARGE_MIN = 40;
const STEAL_CHARGE_RATIO = 0.2;
// 發動時已扣 2 COMBO（等於先少 2 段），要淨賺就必須大於成本
const AMP_HIT_BONUS = 5;

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
function diamonds(n) { return n <= 4 ? "◆" : n <= 7 ? "◆◆" : n <= 10 ? "◆◆◆" : "◆◆◆◆"; }
const KANA_ROMAJI = {
  あ:"a",い:"i",う:"u",え:"e",お:"o",
  か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",
  さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
  た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",
  な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",
  は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
  ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",
  や:"ya",ゆ:"yu",よ:"yo",
  ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",
  わ:"wa",を:"wo",ん:"n",
  が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",
  ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",
  だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
  ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",
  ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",
  きゃ:"kya",きゅ:"kyu",きょ:"kyo",
  しゃ:"sha",しゅ:"shu",しょ:"sho",
  ちゃ:"cha",ちゅ:"chu",ちょ:"cho",
  にゃ:"nya",にゅ:"nyu",にょ:"nyo",
  ひゃ:"hya",ひゅ:"hyu",ひょ:"hyo",
  みゃ:"mya",みゅ:"myu",みょ:"myo",
  りゃ:"rya",りゅ:"ryu",りょ:"ryo",
  ぎゃ:"gya",ぎゅ:"gyu",ぎょ:"gyo",
  じゃ:"ja",じゅ:"ju",じょ:"jo",
  びゃ:"bya",びゅ:"byu",びょ:"byo",
  ぴゃ:"pya",ぴゅ:"pyu",ぴょ:"pyo",
  っ:"xtu",ー:"-",
  ア:"a",イ:"i",ウ:"u",エ:"e",オ:"o",
  カ:"ka",キ:"ki",ク:"ku",ケ:"ke",コ:"ko",
  サ:"sa",シ:"shi",ス:"su",セ:"se",ソ:"so",
  タ:"ta",チ:"chi",ツ:"tsu",テ:"te",ト:"to",
  ナ:"na",ニ:"ni",ヌ:"nu",ネ:"ne",ノ:"no",
  ハ:"ha",ヒ:"hi",フ:"fu",ヘ:"he",ホ:"ho",
  マ:"ma",ミ:"mi",ム:"mu",メ:"me",モ:"mo",
  ヤ:"ya",ユ:"yu",ヨ:"yo",
  ラ:"ra",リ:"ri",ル:"ru",レ:"re",ロ:"ro",
  ワ:"wa",ヲ:"wo",ン:"n",
  ガ:"ga",ギ:"gi",グ:"gu",ゲ:"ge",ゴ:"go",
  ザ:"za",ジ:"ji",ズ:"zu",ゼ:"ze",ゾ:"zo",
  ダ:"da",ヂ:"ji",ヅ:"zu",デ:"de",ド:"do",
  バ:"ba",ビ:"bi",ブ:"bu",ベ:"be",ボ:"bo",
  パ:"pa",ピ:"pi",プ:"pu",ペ:"pe",ポ:"po",
  キャ:"kya",キュ:"kyu",キョ:"kyo",
  シャ:"sha",シュ:"shu",ショ:"sho",
  チャ:"cha",チュ:"chu",チョ:"cho",
  ニャ:"nya",ニュ:"nyu",ニョ:"nyo",
  ヒャ:"hya",ヒュ:"hyu",ヒョ:"hyo",
  ミャ:"mya",ミュ:"myu",ミョ:"myo",
  リャ:"rya",リュ:"ryu",リョ:"ryo",
  ギャ:"gya",ギュ:"gyu",ギョ:"gyo",
  ジャ:"ja",ジュ:"ju",ジョ:"jo",
  ビャ:"bya",ビュ:"byu",ビョ:"byo",
  ピャ:"pya",ピュ:"pyu",ピョ:"pyo",
  ファ:"fa",フィ:"fi",フェ:"fe",フォ:"fo",フュ:"fyu",
  ヴァ:"va",ヴィ:"vi",ヴ:"vu",ヴェ:"ve",ヴォ:"vo",
  ウィ:"wi",ウェ:"we",ウォ:"wo",
  ティ:"ti",ディ:"di",トゥ:"tu",ドゥ:"du",
  チェ:"che",シェ:"she",ジェ:"je",
  ッ:"xtu",
};
function romajiOfKana(kana) {
  if (KANA_ROMAJI[kana]) return KANA_ROMAJI[kana];
  return kana;
}
function romajiSequence(seq) {
  return (seq || []).map(romajiOfKana);
}
function nearDistractors(k) {
  const m = { ご:["こ","が","ぐ"],く:["き","ぐ","け"],う:["お","ん","む"],さ:["ざ","し","た"],ら:["り","ろ","な"],りょ:["りゅ","り","よ"],い:["き","え","り"],き:["ぎ","ち","け"],て:["で","た","ち"],ん:["む","の","う"],か:["が","け","こ"] };
  return m[k] || [];
}
function buildPool(seq, distractorDelta = 0, opts = {}) {
  const correct = seq.map((kana, i) => ({ id: "c"+i+"_"+Math.random().toString(36).slice(2,5), kana, used: false }));
  if (opts.noDistractors) return shuffle(correct);
  const extraN = Math.max(1, (seq.length <= 4 ? 3 : 4) + (distractorDelta || 0));
  const bag = new Set();
  seq.forEach((k) => nearDistractors(k).forEach((d) => bag.add(d)));
  ["あ","い","う","ん","き","し","つ","よ"].forEach((d) => bag.add(d));
  seq.forEach((k) => bag.delete(k));
  const extras = shuffle([...bag]).slice(0, extraN).map((kana, i) => ({ id: "d"+i+"_"+Math.random().toString(36).slice(2,5), kana, used: false }));
  return shuffle([...correct, ...extras]);
}

let battleOpts = { distractors: true, maxLen: 0, script: "all" };
function readBattleOptsFromUi() {
  const dist = $("opt-distractors");
  const maxEl = $("opt-maxlen");
  const scriptEl = $("opt-script");
  battleOpts = {
    distractors: dist ? !!dist.checked : true,
    maxLen: maxEl ? (Number(maxEl.value) || 0) : 0,
    script: scriptEl ? (scriptEl.value || "all") : "all",
  };
  return battleOpts;
}
function scriptOfSeq(seq) {
  let hira = 0, kata = 0;
  (seq || []).forEach((k) => {
    for (const ch of k) {
      const c = ch.codePointAt(0);
      if (c >= 0x3041 && c <= 0x3096) hira += 1;
      else if (c >= 0x30A1 && c <= 0x30FA) kata += 1;
    }
  });
  if (hira && !kata) return "hira";
  if (kata && !hira) return "kata";
  return "mixed";
}
function buildBattleDeck() {
  readBattleOptsFromUi();
  let list = ALL_QUESTIONS.slice();
  if (battleOpts.maxLen > 0) {
    list = list.filter((q) => q.kanaSequence.length <= battleOpts.maxLen);
  }
  if (battleOpts.script === "hira" || battleOpts.script === "kata") {
    list = list.filter((q) => scriptOfSeq(q.kanaSequence) === battleOpts.script);
  }
  if (!list.length) {
    // 篩太嚴時回退：只保留字數條件，再不行用全庫
    list = ALL_QUESTIONS.slice();
    if (battleOpts.maxLen > 0) {
      const limited = list.filter((q) => q.kanaSequence.length <= battleOpts.maxLen);
      if (limited.length) list = limited;
    }
  }
  return shuffle(list);
}
function hasKanjiText(t) {
  return /[\u4e00-\u9fff\u3005\u3007\u303B]/.test(t || "");
}
function showWordReveal(player, q) {
  if (!q) return;
  const host = $("duel-half-" + player) || $("board" + player);
  if (!host) return;
  host.querySelectorAll(".word-reveal").forEach((n) => n.remove());
  const reading = (q.kanaSequence || []).join("");
  // 優先漢字表記；沒有漢字時用 displayName；再附假名與中文詞義
  const kanji = (q.kanji && hasKanjiText(q.kanji)) ? q.kanji
    : (hasKanjiText(q.displayName) ? q.displayName : "");
  const title = kanji || q.displayName || reading;
  const subBits = [];
  if (reading && reading !== title) subBits.push(reading);
  if (q.zh) subBits.push(q.zh);
  const el = document.createElement("div");
  el.className = "word-reveal";
  el.innerHTML = "<strong></strong><span></span>";
  el.querySelector("strong").textContent = title;
  el.querySelector("span").textContent = subBits.join(" · ");
  host.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function showCombo(text, tier) {
  const el = $("combo-float");
  el.textContent = text;
  el.classList.remove("go", "hit-sm", "hit-md", "hit-lg");
  if (tier === "sm") el.classList.add("hit-sm");
  else if (tier === "md") el.classList.add("hit-md");
  else if (tier === "lg") el.classList.add("hit-lg");
  void el.offsetWidth;
  el.classList.add("go");
}

const FX_THEMES = {
  ao: { id: "ao", name: "ink", color: "#3aa89e", color2: "#b8fff2" },
  rin: { id: "rin", name: "ember", color: "#e06a3a", color2: "#ffd2a0" },
  ya: { id: "ya", name: "frost", color: "#7eb8e0", color2: "#eaf6ff" },
  go: { id: "go", name: "thunder", color: "#a078e8", color2: "#f2e8ff" },
  // 第 2 期專屬色票
  ran: { id: "ran", name: "wind", color: "#2ec4a0", color2: "#b8ffe8" },
  gen: { id: "gen", name: "shadow", color: "#6b5b95", color2: "#d4c4ff" },
  sho: { id: "sho", name: "seal", color: "#3d9ecc", color2: "#c8f0ff" },
  yo: { id: "yo", name: "light", color: "#d4a017", color2: "#ffe9a8" },
};
function fxThemeOf(player) {
  const id = charOf(player)?.id || "ao";
  return FX_THEMES[id] || FX_THEMES.ao;
}
function fxLayer() { return $("fx-layer"); }
function fxPoint(fighterEl, yRatio) {
  const r = fighterEl.getBoundingClientRect();
  return { x: r.left + r.width * 0.5, y: r.top + r.height * (yRatio == null ? 0.42 : yRatio) };
}
function styleFx(el, theme) {
  el.style.setProperty("--fx-c1", theme.color);
  el.style.setProperty("--fx-c2", theme.color2);
}
function shakeBattle(heavy) {
  const stage = document.querySelector(".duel-stage");
  if (!stage) return;
  stage.classList.remove("fx-shake", "fx-shake-lg");
  void stage.offsetWidth;
  stage.classList.add(heavy ? "fx-shake-lg" : "fx-shake");
  setTimeout(() => stage.classList.remove("fx-shake", "fx-shake-lg"), heavy ? 520 : 380);
}
function spawnImpactBloom(fighterEl, theme, heavy) {
  const layer = fxLayer();
  if (!layer || !fighterEl) return;
  const pt = fxPoint(fighterEl, 0.4);
  const bloom = document.createElement("div");
  bloom.className = "fx-bloom" + (heavy ? " heavy" : "");
  styleFx(bloom, theme);
  bloom.style.setProperty("--bx", ((pt.x / window.innerWidth) * 100).toFixed(2) + "%");
  bloom.style.setProperty("--by", ((pt.y / window.innerHeight) * 100).toFixed(2) + "%");
  // tint bloom with theme color via inline override
  bloom.style.background =
    "radial-gradient(circle at var(--bx) var(--by), " + theme.color2 + "cc, " + theme.color + "99 28%, transparent 46%)," +
    "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.22), transparent 62%)";
  layer.appendChild(bloom);
  setTimeout(() => bloom.remove(), heavy ? 650 : 480);
  if (heavy) {
    const flash = document.createElement("div");
    flash.className = "fx-flash heavy";
    styleFx(flash, theme);
    layer.appendChild(flash);
    setTimeout(() => flash.remove(), 420);
  }
}
function spawnThemeShapes(layer, pt, theme, power) {
  const heavy = power >= 4;
  const kind = theme.name || "ink";
  if (kind === "ember") {
    // 燐：火柱自下往上竄
    const n = heavy ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-pillar" + (heavy && i === 1 ? " lg" : "");
      styleFx(el, theme);
      el.style.left = (pt.x + (i - (n - 1) / 2) * (heavy ? 22 : 16)) + "px";
      el.style.top = (pt.y + 18) + "px";
      el.style.animationDelay = (i * 0.04) + "s";
      layer.appendChild(el);
      setTimeout(() => el.remove(), 620);
    }
    for (let i = 0; i < (heavy ? 8 : 5); i++) {
      const flame = document.createElement("div");
      flame.className = "fx-flame";
      styleFx(flame, theme);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
      const dist = 36 + Math.random() * 40;
      flame.style.left = (pt.x + (Math.random() - 0.5) * 24) + "px";
      flame.style.top = pt.y + "px";
      flame.style.setProperty("--dx", Math.cos(ang) * dist * 0.35 + "px");
      flame.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      layer.appendChild(flame);
      setTimeout(() => flame.remove(), 580);
    }
    return;
  }
  if (kind === "frost") {
    // 夜：冰晶放射＋霜環
    const ring = document.createElement("div");
    ring.className = "fx-frost-ring";
    styleFx(ring, theme);
    ring.style.left = pt.x + "px";
    ring.style.top = pt.y + "px";
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 520);
    const n = heavy ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-crystal" + (heavy && i % 3 === 0 ? " lg" : "");
      const ang = (Math.PI * 2 * i) / n;
      const dist = 44 + Math.random() * (30 + power * 5);
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      layer.appendChild(el);
      setTimeout(() => el.remove(), 600);
    }
    return;
  }
  if (kind === "thunder") {
    // 轟：雷鏈／折線電弧
    const n = heavy ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = i % 2 === 0 ? "fx-chain" : "fx-zap";
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 36 + Math.random() * (40 + power * 6);
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      el.style.setProperty("--rot", (ang * 180 / Math.PI) + "deg");
      layer.appendChild(el);
      setTimeout(() => el.remove(), 480);
    }
    return;
  }
  if (kind === "wind") {
    // 嵐：風弧＋破風刃
    const arcs = heavy ? 4 : 3;
    for (let i = 0; i < arcs; i++) {
      const el = document.createElement("div");
      el.className = "fx-gale" + (heavy && i === 0 ? " lg" : "");
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--rot", (-40 + i * 28) + "deg");
      el.style.animationDelay = (i * 0.03) + "s";
      layer.appendChild(el);
      setTimeout(() => el.remove(), 520);
    }
    const n = heavy ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-wind-arc";
      const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.35 + Math.random() * 0.15;
      const dist = 40 + Math.random() * (28 + power * 5);
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      el.style.setProperty("--rot", (ang * 180 / Math.PI) + "deg");
      layer.appendChild(el);
      setTimeout(() => el.remove(), 500);
    }
    return;
  }
  if (kind === "shadow") {
    // 玄：影分身殘影＋匕首閃
    const clones = heavy ? 4 : 3;
    for (let i = 0; i < clones; i++) {
      const el = document.createElement("div");
      el.className = "fx-shadow";
      styleFx(el, theme);
      const ang = (Math.PI * 2 * i) / clones + 0.4;
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * (28 + i * 8) + "px");
      el.style.setProperty("--dy", Math.sin(ang) * (18 + i * 6) + "px");
      el.style.animationDelay = (i * 0.04) + "s";
      layer.appendChild(el);
      setTimeout(() => el.remove(), 520);
    }
    const n = heavy ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-dagger";
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      const dist = 38 + Math.random() * (30 + power * 5);
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      el.style.setProperty("--rot", (ang * 180 / Math.PI + 90) + "deg");
      layer.appendChild(el);
      setTimeout(() => el.remove(), 480);
    }
    return;
  }
  if (kind === "seal") {
    // 章：符紙飛散＋朱印蓋章
    const stamp = document.createElement("div");
    stamp.className = "fx-seal-stamp" + (heavy ? " lg" : "");
    styleFx(stamp, theme);
    stamp.style.left = pt.x + "px";
    stamp.style.top = pt.y + "px";
    layer.appendChild(stamp);
    setTimeout(() => stamp.remove(), 520);
    const n = heavy ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-ofuda";
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.2;
      const dist = 42 + Math.random() * (28 + power * 5);
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      el.style.setProperty("--rot", ((Math.random() - 0.5) * 50) + "deg");
      layer.appendChild(el);
      setTimeout(() => el.remove(), 560);
    }
    return;
  }
  if (kind === "light") {
    // 陽：鐵扇月牙＋金環
    const ring = document.createElement("div");
    ring.className = "fx-light-ring";
    styleFx(ring, theme);
    ring.style.left = pt.x + "px";
    ring.style.top = pt.y + "px";
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 500);
    const n = heavy ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "fx-crescent" + (heavy && i % 2 === 0 ? " lg" : "");
      styleFx(el, theme);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      el.style.setProperty("--rot", (-50 + i * 28) + "deg");
      el.style.animationDelay = (i * 0.035) + "s";
      layer.appendChild(el);
      setTimeout(() => el.remove(), 520);
    }
    return;
  }
  // 蒼：墨點濺散＋筆勢橫斬
  const strokes = heavy ? 3 : 2;
  for (let i = 0; i < strokes; i++) {
    const stroke = document.createElement("div");
    stroke.className = "fx-ink-stroke" + (heavy && i === 0 ? " lg" : "");
    styleFx(stroke, theme);
    stroke.style.left = pt.x + "px";
    stroke.style.top = (pt.y + (i - 0.5) * 14) + "px";
    stroke.style.setProperty("--rot", (-32 + i * 28) + "deg");
    stroke.style.setProperty("--dx", (20 + i * 8) + "px");
    stroke.style.setProperty("--dy", (-8 + i * 4) + "px");
    layer.appendChild(stroke);
    setTimeout(() => stroke.remove(), 420);
  }
  const n = heavy ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    el.className = "fx-inkblot" + (i % 3 === 0 ? "" : " sm");
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.45;
    const dist = 34 + Math.random() * (34 + power * 6);
    styleFx(el, theme);
    el.style.left = pt.x + "px";
    el.style.top = pt.y + "px";
    el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    el.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    layer.appendChild(el);
    setTimeout(() => el.remove(), 580);
  }
}
function spawnHitBurst(fighterEl, theme, power) {
  const layer = fxLayer();
  if (!layer || !fighterEl) return;
  const pt = fxPoint(fighterEl, 0.4);
  const heavy = power >= 4;
  const kind = theme.name || "ink";
  spawnThemeShapes(layer, pt, theme, power);
  // 通用火花減少，讓專屬形狀更搶眼
  const lowSpark = kind === "ember" || kind === "seal" || kind === "light";
  const sparkN = lowSpark ? (heavy ? 8 : 5) : (heavy ? 12 : 8);
  for (let i = 0; i < sparkN; i++) {
    const spark = document.createElement("i");
    spark.className = "fx-spark" + (heavy && i % 3 === 0 ? " lg" : "");
    styleFx(spark, theme);
    const ang = (Math.PI * 2 * i) / sparkN + Math.random() * 0.4;
    const dist = 42 + Math.random() * (36 + power * 7);
    spark.style.left = pt.x + "px";
    spark.style.top = pt.y + "px";
    spark.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    spark.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    layer.appendChild(spark);
    setTimeout(() => spark.remove(), 580);
  }
  if (kind !== "frost" && kind !== "light" && kind !== "seal") {
    ["", " delay"].forEach((extra, idx) => {
      const ring = document.createElement("div");
      ring.className = "fx-ring" + (heavy || idx === 0 ? " lg" : "") + extra;
      styleFx(ring, theme);
      ring.style.left = pt.x + "px";
      ring.style.top = pt.y + "px";
      layer.appendChild(ring);
      setTimeout(() => ring.remove(), 520);
    });
  }
  if (kind === "ink" || kind === "thunder" || kind === "ember" || kind === "frost" ||
      kind === "wind" || kind === "shadow" || kind === "seal" || kind === "light") {
    const slash = document.createElement("div");
    slash.className = "fx-slash theme-" + kind + (heavy ? " lg" : "");
    styleFx(slash, theme);
    slash.style.left = pt.x + "px";
    slash.style.top = pt.y + "px";
    layer.appendChild(slash);
    setTimeout(() => slash.remove(), kind === "ember" || kind === "light" ? 360 : 380);
  }
  spawnImpactBloom(fighterEl, theme, heavy);
}
function playCastBurst(fighterEl, theme) {
  if (!fighterEl) return;
  let cast = fighterEl.querySelector(".fx-cast");
  if (!cast) {
    cast = document.createElement("div");
    cast.className = "fx-cast";
    fighterEl.appendChild(cast);
  }
  styleFx(cast, theme);
  cast.classList.remove("go");
  void cast.offsetWidth;
  cast.classList.add("go");
  spawnImpactBloom(fighterEl, theme, false);
}
function ensureBlockLayers(fighterEl) {
  if (!fighterEl) return null;
  let shield = fighterEl.querySelector(".fx-shield");
  if (!shield) {
    shield = document.createElement("div");
    shield.className = "fx-shield";
    fighterEl.appendChild(shield);
  }
  let flash = fighterEl.querySelector(".fx-block-flash");
  if (!flash) {
    flash = document.createElement("div");
    flash.className = "fx-block-flash";
    fighterEl.appendChild(flash);
  }
  return shield;
}
function spawnBlockSparks(layer, pt, count, lgEvery) {
  for (let i = 0; i < count; i++) {
    const spark = document.createElement("div");
    spark.className = "fx-block-spark" + (lgEvery && i % lgEvery === 0 ? " lg" : "");
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const dist = 30 + Math.random() * 48;
    spark.style.left = pt.x + "px";
    spark.style.top = pt.y + "px";
    spark.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    spark.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    layer.appendChild(spark);
    setTimeout(function () { spark.remove(); }, 500);
  }
}
function spawnBlockClang(layer, pt, rot, cross) {
  const clang = document.createElement("div");
  clang.className = "fx-block-clang" + (cross ? " cross" : "");
  clang.style.left = pt.x + "px";
  clang.style.top = pt.y + "px";
  clang.style.setProperty("--rot", rot);
  layer.appendChild(clang);
  setTimeout(function () { clang.remove(); }, 360);
}
function playBlockActivate(player) {
  const fighterEl = $("fighter" + player);
  if (!fighterEl) return;
  const shield = ensureBlockLayers(fighterEl);
  if (shield) {
    shield.classList.remove("rise");
    void shield.offsetWidth;
    shield.classList.add("rise");
  }
  const flash = fighterEl.querySelector(".fx-block-flash");
  if (flash) {
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
  }
  const layer = fxLayer();
  const pt = fxPoint(fighterEl, 0.4);
  if (!layer) return;
  ["", " lg"].forEach(function (extra, idx) {
    const ring = document.createElement("div");
    ring.className = "fx-block-ring" + extra;
    ring.style.left = pt.x + "px";
    ring.style.top = pt.y + "px";
    layer.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 520 + idx * 40);
  });
  spawnBlockSparks(layer, pt, 14, 4);
  spawnBlockClang(layer, pt, "-22deg", false);
  spawnBlockClang(layer, pt, "68deg", true);
}
function spawnBlockParry(fighterEl, heavy) {
  const layer = fxLayer();
  if (!layer || !fighterEl) return;
  const pt = fxPoint(fighterEl, 0.4);
  const flash = fighterEl.querySelector(".fx-block-flash") || ensureBlockLayers(fighterEl) && fighterEl.querySelector(".fx-block-flash");
  if (flash) {
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
  }
  const ring = document.createElement("div");
  ring.className = "fx-block-ring" + (heavy ? " lg" : "");
  ring.style.left = pt.x + "px";
  ring.style.top = pt.y + "px";
  layer.appendChild(ring);
  setTimeout(function () { ring.remove(); }, 520);
  spawnBlockSparks(layer, pt, heavy ? 16 : 10, heavy ? 3 : 0);
  spawnBlockClang(layer, pt, (Math.random() * 40 - 28) + "deg", false);
  if (heavy) spawnBlockClang(layer, pt, "72deg", true);
  fighterEl.classList.remove("block-absorb");
  void fighterEl.offsetWidth;
  fighterEl.classList.add("block-absorb");
  setTimeout(function () { fighterEl.classList.remove("block-absorb"); }, 340);
}
function addBoltLine(layer, a, b, theme, cls) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.max(24, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const bolt = document.createElement("div");
  bolt.className = "fx-bolt theme-" + (theme.name || "ink") + (cls ? " " + cls : "");
  styleFx(bolt, theme);
  bolt.style.left = a.x + "px";
  bolt.style.top = a.y + "px";
  bolt.style.width = dist + "px";
  bolt.style.transform = "rotate(" + angle + "deg)";
  layer.appendChild(bolt);
  setTimeout(() => bolt.remove(), 520);
  return bolt;
}
function addZigZagBolt(layer, a, b, theme, cls) {
  const segs = 6;
  let prev = { x: a.x, y: a.y };
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const jitter = i < segs ? (i % 2 === 0 ? 1 : -1) * (18 + Math.random() * 16) : 0;
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const next = {
      x: a.x + (b.x - a.x) * t + (nx / len) * jitter,
      y: a.y + (b.y - a.y) * t + (ny / len) * jitter,
    };
    addBoltLine(layer, prev, next, theme, cls);
    prev = next;
  }
}
function playAttackBolt(fromPlayer, toPlayer, theme, heavy) {
  return new Promise((resolve) => {
    const layer = fxLayer();
    const fromEl = $("fighter" + fromPlayer);
    const toEl = $("fighter" + toPlayer);
    if (!layer || !fromEl || !toEl) { resolve(); return; }
    const a = fxPoint(fromEl, 0.4);
    const b = fxPoint(toEl, 0.4);
    const dur = heavy ? 460 : 320;
    const kind = theme.name || "ink";
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const ox = (nx / len) * (heavy ? 14 : 8);
    const oy = (ny / len) * (heavy ? 14 : 8);

    if (kind === "thunder") {
      // 轟：折線雷鏈
      addZigZagBolt(layer, a, b, theme, "ghost");
      addZigZagBolt(layer, a, b, theme, heavy ? "heavy" : "");
      addZigZagBolt(layer, a, b, theme, "core");
    } else if (kind === "ink") {
      // 蒼：墨斬筆勢（單主線＋側翼淡筆）
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      addBoltLine(layer,
        { x: a.x + ox * 0.7, y: a.y + oy * 0.7 },
        { x: b.x + ox * 0.25, y: b.y + oy * 0.25 },
        theme, "");
    } else if (kind === "ember") {
      // 燐：粗焰軌＋沿途火星
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      addBoltLine(layer,
        { x: a.x + ox, y: a.y + oy },
        { x: b.x + ox * 0.35, y: b.y + oy * 0.35 },
        theme, "");
      addBoltLine(layer,
        { x: a.x - ox, y: a.y - oy },
        { x: b.x - ox * 0.35, y: b.y - oy * 0.35 },
        theme, "");
      const sparks = heavy ? 5 : 3;
      for (let i = 1; i <= sparks; i++) {
        const t = i / (sparks + 1);
        setTimeout(() => {
          const flame = document.createElement("div");
          flame.className = "fx-flame";
          styleFx(flame, theme);
          flame.style.left = (a.x + (b.x - a.x) * t) + "px";
          flame.style.top = (a.y + (b.y - a.y) * t) + "px";
          flame.style.setProperty("--dx", ((Math.random() - 0.5) * 20) + "px");
          flame.style.setProperty("--dy", (-28 - Math.random() * 24) + "px");
          layer.appendChild(flame);
          setTimeout(() => flame.remove(), 520);
        }, Math.round(dur * t * 0.7));
      }
    } else if (kind === "wind") {
      // 嵐：弧形風軌＋沿途風刃
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      addBoltLine(layer,
        { x: a.x + ox * 1.2, y: a.y + oy * 1.2 },
        { x: b.x + ox * 0.4, y: b.y + oy * 0.4 },
        theme, "");
      addBoltLine(layer,
        { x: a.x - ox * 1.2, y: a.y - oy * 1.2 },
        { x: b.x - ox * 0.4, y: b.y - oy * 0.4 },
        theme, "");
      const blades = heavy ? 5 : 3;
      for (let i = 1; i <= blades; i++) {
        const t = i / (blades + 1);
        setTimeout(() => {
          const gale = document.createElement("div");
          gale.className = "fx-wind-arc";
          styleFx(gale, theme);
          gale.style.left = (a.x + (b.x - a.x) * t) + "px";
          gale.style.top = (a.y + (b.y - a.y) * t) + "px";
          gale.style.setProperty("--dx", (ox * 1.5) + "px");
          gale.style.setProperty("--dy", (oy * 1.5) + "px");
          gale.style.setProperty("--rot", (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + "deg");
          layer.appendChild(gale);
          setTimeout(() => gale.remove(), 480);
        }, Math.round(dur * t * 0.7));
      }
    } else if (kind === "shadow") {
      // 玄：斷續影斬＋匕首殘影
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      const daggers = heavy ? 5 : 3;
      for (let i = 1; i <= daggers; i++) {
        const t = i / (daggers + 1);
        setTimeout(() => {
          const dagger = document.createElement("div");
          dagger.className = "fx-dagger";
          styleFx(dagger, theme);
          dagger.style.left = (a.x + (b.x - a.x) * t + ox * (i % 2 ? 1 : -1)) + "px";
          dagger.style.top = (a.y + (b.y - a.y) * t + oy * (i % 2 ? 1 : -1)) + "px";
          dagger.style.setProperty("--dx", ((Math.random() - 0.5) * 24) + "px");
          dagger.style.setProperty("--dy", ((Math.random() - 0.5) * 24) + "px");
          dagger.style.setProperty("--rot", (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90) + "deg");
          layer.appendChild(dagger);
          setTimeout(() => dagger.remove(), 480);
        }, Math.round(dur * t * 0.72));
      }
    } else if (kind === "seal") {
      // 章：墨束＋沿途符紙
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      const papers = heavy ? 5 : 3;
      for (let i = 1; i <= papers; i++) {
        const t = i / (papers + 1);
        setTimeout(() => {
          const ofuda = document.createElement("div");
          ofuda.className = "fx-ofuda";
          styleFx(ofuda, theme);
          ofuda.style.left = (a.x + (b.x - a.x) * t) + "px";
          ofuda.style.top = (a.y + (b.y - a.y) * t) + "px";
          ofuda.style.setProperty("--dx", ((Math.random() - 0.5) * 28) + "px");
          ofuda.style.setProperty("--dy", (-18 - Math.random() * 20) + "px");
          ofuda.style.setProperty("--rot", ((Math.random() - 0.5) * 40) + "deg");
          layer.appendChild(ofuda);
          setTimeout(() => ofuda.remove(), 520);
        }, Math.round(dur * t * 0.75));
      }
    } else if (kind === "light") {
      // 陽：金光扇軌＋月牙
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      addBoltLine(layer,
        { x: a.x + ox, y: a.y + oy },
        { x: b.x + ox * 0.3, y: b.y + oy * 0.3 },
        theme, "");
      const fans = heavy ? 4 : 3;
      for (let i = 1; i <= fans; i++) {
        const t = i / (fans + 1);
        setTimeout(() => {
          const crescent = document.createElement("div");
          crescent.className = "fx-crescent";
          styleFx(crescent, theme);
          crescent.style.left = (a.x + (b.x - a.x) * t) + "px";
          crescent.style.top = (a.y + (b.y - a.y) * t) + "px";
          crescent.style.setProperty("--rot", (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + "deg");
          layer.appendChild(crescent);
          setTimeout(() => crescent.remove(), 480);
        }, Math.round(dur * t * 0.7));
      }
    } else {
      // 夜：細冰束＋沿途碎晶
      addBoltLine(layer, a, b, theme, "ghost");
      addBoltLine(layer, a, b, theme, heavy ? "heavy" : "");
      addBoltLine(layer, a, b, theme, "core");
      const shards = heavy ? 5 : 3;
      for (let i = 1; i <= shards; i++) {
        const t = i / (shards + 1);
        setTimeout(() => {
          const crystal = document.createElement("div");
          crystal.className = "fx-crystal";
          styleFx(crystal, theme);
          crystal.style.left = (a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 12) + "px";
          crystal.style.top = (a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 12) + "px";
          crystal.style.setProperty("--dx", ((Math.random() - 0.5) * 36) + "px");
          crystal.style.setProperty("--dy", ((Math.random() - 0.5) * 36) + "px");
          layer.appendChild(crystal);
          setTimeout(() => crystal.remove(), 520);
        }, Math.round(dur * t * 0.75));
      }
    }

    const orb = document.createElement("div");
    orb.className = "fx-orb" + (heavy ? " heavy" : "");
    styleFx(orb, theme);
    orb.style.left = a.x + "px";
    orb.style.top = a.y + "px";
    layer.appendChild(orb);
    void orb.offsetWidth;
    orb.classList.add("go");
    orb.style.transition = "left " + dur + "ms var(--ease), top " + dur + "ms var(--ease)";
    requestAnimationFrame(() => {
      orb.style.left = b.x + "px";
      orb.style.top = b.y + "px";
    });

    const trailN = heavy ? 6 : 4;
    for (let i = 1; i <= trailN; i++) {
      const t = i / (trailN + 1);
      setTimeout(() => {
        const trail = document.createElement("div");
        trail.className = "fx-orb-trail";
        styleFx(trail, theme);
        trail.style.left = (a.x + (b.x - a.x) * t) + "px";
        trail.style.top = (a.y + (b.y - a.y) * t) + "px";
        layer.appendChild(trail);
        setTimeout(() => trail.remove(), 420);
      }, Math.round(dur * t * 0.85));
    }

    setTimeout(() => {
      orb.remove();
      resolve();
    }, dur + 50);
  });
}
function clearBattleFx() {
  const layer = fxLayer();
  if (layer) layer.innerHTML = "";
  const after = $("special-aftermath");
  if (after) {
    after.classList.remove("go");
    after.setAttribute("aria-hidden", "true");
  }
  document.querySelector(".duel-stage")?.classList.remove("fx-shake", "fx-shake-lg");
}
async function playSpecialAftermath(themeId) {
  const el = $("special-aftermath");
  if (!el) return;
  el.dataset.theme = themeId || "ao";
  el.classList.remove("go");
  void el.offsetWidth;
  el.classList.add("go");
  el.setAttribute("aria-hidden", "false");
  const theme = FX_THEMES[themeId] || FX_THEMES.ao;
  const layer = fxLayer();
  if (layer) {
    const flash = document.createElement("div");
    flash.className = "fx-flash heavy";
    styleFx(flash, theme);
    layer.appendChild(flash);
    setTimeout(() => flash.remove(), 420);
  }
  shakeBattle(true);
  await wait(980);
  el.classList.remove("go");
  el.setAttribute("aria-hidden", "true");
}
function showScreen(name) {
  if (name !== "battle" && name !== "practice") {
    cancelAllDrags();
    clearBattleFx();
  }
  ["start","chars","practice","battle","result"].forEach((n) => {
    $("screen-" + n)?.classList.toggle("hidden", name !== n);
  });
  document.querySelector(".app")?.classList.toggle("battle-mode", name === "battle");
  document.querySelector(".app")?.classList.toggle("char-mode", name === "chars");
  document.querySelector(".app")?.classList.toggle("cover-mode", name === "start");
}

// —— Drag / tap（雙人：依 pointerId 並行；換題／大招／回首頁強制清掉 ghost）——
const drags = new Map(); // pointerId → session
function clearSlotOver(boardId) {
  const board = boards[boardId];
  const root = board ? $(board.slotsId) : null;
  root?.querySelectorAll(".slot.over").forEach((s) => s.classList.remove("over"));
}
function scrubDragSession(session) {
  if (!session) return;
  if (session.ghost) { session.ghost.remove(); session.ghost = null; }
  session.el?.classList.remove("dragging");
  clearSlotOver(session.boardId);
}
function cancelDrag(pointerId) {
  const session = drags.get(pointerId);
  if (!session) return;
  drags.delete(pointerId);
  scrubDragSession(session);
  try { session.el?.releasePointerCapture?.(pointerId); } catch {}
}
function cancelDragsForBoard(boardId) {
  const key = String(boardId);
  for (const [pid, session] of [...drags]) {
    if (String(session.boardId) === key) cancelDrag(pid);
  }
}
function cancelAllDrags() {
  for (const pid of [...drags.keys()]) cancelDrag(pid);
  document.querySelectorAll(".drag-ghost").forEach((n) => n.remove());
  document.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
  document.querySelectorAll(".slot.over").forEach((s) => s.classList.remove("over"));
}
function bindDragSource(el, info) {
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const board = boards[info.boardId];
    if (board?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    if (drags.has(e.pointerId)) cancelDrag(e.pointerId);
    drags.set(e.pointerId, {
      ...info,
      el,
      ghost: null,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    });
    try { el.setPointerCapture(e.pointerId); } catch {}
  }, { passive: false });
}
function endDrag(e) {
  const pid = e?.pointerId;
  if (pid == null || !drags.has(pid)) return;
  const cur = drags.get(pid);
  drags.delete(pid);
  clearSlotOver(cur.boardId);
  const x = (e && typeof e.clientX === "number") ? e.clientX : cur.lastX;
  const y = (e && typeof e.clientY === "number") ? e.clientY : cur.lastY;
  const under = document.elementFromPoint(x, y);
  const slotEl = under?.closest?.(".slot");
  const poolHit = under?.closest?.(".pool");
  const board = boards[cur.boardId];
  if (cur.moved) {
    if (slotEl && board && slotEl.closest("#" + board.slotsId)) {
      const targetIdx = Number(slotEl.dataset.index);
      if (cur.from === "pool") board.place(cur.poolId, targetIdx);
      else if (cur.from === "slot" && cur.slotIndex !== targetIdx) {
        [board.slots[cur.slotIndex], board.slots[targetIdx]] = [board.slots[targetIdx], board.slots[cur.slotIndex]];
        board.render(); playSfx("sfx_click", 0.25);
        maybeAutoBattleSubmit(cur.boardId);
      }
    } else if (poolHit && cur.from === "slot" && board) {
      board.clearSlot(cur.slotIndex);
    } else if (cur.from === "pool" && board) {
      // 微移被當成拖曳但沒放到格子 → 仍當點選，支援快速連點
      board.place(cur.poolId);
    }
  } else if (board) {
    if (cur.from === "pool") board.place(cur.poolId);
    else if (cur.from === "slot") board.clearSlot(cur.slotIndex);
  }
  if (cur.ghost) cur.ghost.remove();
  cur.el?.classList.remove("dragging");
}
window.addEventListener("pointermove", (e) => {
  const drag = drags.get(e.pointerId);
  if (!drag) return;
  e.preventDefault();
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    drag.moved = true;
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = drag.kana;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.el.classList.add("dragging");
  }
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  clearSlotOver(drag.boardId);
  const board = boards[drag.boardId];
  const slotsRoot = board ? $(board.slotsId) : null;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".slot");
  if (over && slotsRoot?.contains(over)) over.classList.add("over");
}, { passive: false });
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
window.addEventListener("lostpointercapture", (e) => {
  if (drags.has(e.pointerId)) endDrag(e);
});

function createBoard(id, slotsId, poolId, feedbackId) {
  return {
    id, slotsId, poolId, feedbackId,
    slots: [], pool: [], promptRoma: null, locked: false,
    place(poolItemId, slotIndex) {
      if (this.locked) return;
      const item = this.pool.find((p) => p.id === poolItemId);
      if (!item || item.used) return;
      const idx = slotIndex != null ? slotIndex : this.slots.findIndex((v) => !v);
      if (idx < 0) return;
      if (this.slots[idx]) {
        const old = this.pool.find((p) => p.id === this.slots[idx].poolId);
        if (old) {
          old.used = false;
          const oldTile = $(this.poolId)?.querySelector('[data-pool-id="' + old.id + '"]');
          if (oldTile) oldTile.classList.remove("used");
        }
      }
      item.used = true;
      this.slots[idx] = { kana: item.kana, poolId: item.id };
      playSfx("sfx_click", 0.3);
      this.setFeedback("");
      const tile = $(this.poolId)?.querySelector('[data-pool-id="' + item.id + '"]');
      if (tile) tile.classList.add("used");
      else this.render();
      if (tile) this.renderSlots();
      maybeAutoBattleSubmit(this.id);
      if (battleOpen) {
        const pid = Number(this.id);
        if (pid === 1 || pid === 2) updateSkillUi(pid);
      }
    },
    clearSlot(i) {
      if (this.locked) return;
      const val = this.slots[i]; if (!val) return;
      const item = this.pool.find((p) => p.id === val.poolId);
      if (item) item.used = false;
      this.slots[i] = null;
      playSfx("sfx_miss", 0.3);
      const tile = $(this.poolId)?.querySelector('[data-pool-id="' + val.poolId + '"]');
      if (tile) tile.classList.remove("used");
      this.renderSlots();
      if (battleOpen) { const pid = Number(this.id); if (pid === 1 || pid === 2) updateSkillUi(pid); }
    },
    clearAll() {
      if (this.locked) return;
      cancelDragsForBoard(this.id);
      const had = this.slots.some((v) => v);
      this.slots = this.slots.map(() => null);
      this.pool.forEach((p) => (p.used = false));
      this.setFeedback("");
      if (had) playSfx("sfx_miss", 0.3);
      this.render();
      if (battleOpen) { const pid = Number(this.id); if (pid === 1 || pid === 2) updateSkillUi(pid); }
    },
    setFeedback(text, cls = "") {
      const el = $(this.feedbackId);
      if (!el) return;
      el.textContent = text; el.className = "feedback" + (cls ? " " + cls : "");
    },
    load(seq, opts) {
      cancelDragsForBoard(this.id);
      this.slots = seq.map(() => null);
      this.promptRoma = opts?.showRomaji ? romajiSequence(seq) : null;
      this.pool = buildPool(seq, opts?.distractorDelta || 0, {
        noDistractors: !!opts?.noDistractors,
      });
      this.locked = false;
      if (this.id === "1" || this.id === "2") $("board" + this.id)?.classList.remove("locked");
      this.setFeedback(""); this.render();
    },
    renderSlots() {
      const slotsEl = $(this.slotsId);
      if (!slotsEl) return;
      slotsEl.innerHTML = "";
      this.slots.forEach((val, i) => {
        const slot = document.createElement("div");
        const roma = this.promptRoma?.[i];
        slot.className = "slot" + (val ? " filled" : "");
        slot.dataset.index = i;
        slot.innerHTML = `<span class="idx">${i + 1}</span>`;
        if (roma) {
          const r = document.createElement("span");
          r.className = "roma";
          r.textContent = roma;
          slot.appendChild(r);
        }
        if (val) {
          const k = document.createElement("span");
          k.className = "kana"; k.textContent = val.kana;
          bindDragSource(k, { from: "slot", slotIndex: i, kana: val.kana, poolId: val.poolId, boardId: this.id });
          slot.appendChild(k);
        }
        slotsEl.appendChild(slot);
      });
    },
    render() {
      const poolEl = $(this.poolId);
      if (!poolEl) return;
      this.renderSlots();
      poolEl.innerHTML = "";
      this.pool.forEach((item) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "tile" + (item.used ? " used" : "");
        tile.dataset.poolId = item.id;
        tile.textContent = item.kana;
        // 即使 used 也綁定：之後撤回可立刻再點；place 內會擋 used
        bindDragSource(tile, { from: "pool", poolId: item.id, kana: item.kana, boardId: this.id });
        poolEl.appendChild(tile);
      });
    },
    markSlots(seq) {
      const nodes = $(this.slotsId).querySelectorAll(".slot");
      let wrong = 0;
      this.slots.forEach((v, i) => {
        nodes[i].classList.remove("correct", "wrong", "locked-gold");
        if (v && v.kana === seq[i]) nodes[i].classList.add("correct");
        else { nodes[i].classList.add("wrong"); wrong += 1; }
      });
      return wrong; // 0 = 全對
    },
    lockGold() {
      cancelDragsForBoard(this.id);
      this.locked = true;
      if (this.id === "1" || this.id === "2") $("board" + this.id)?.classList.add("locked");
      $(this.slotsId).querySelectorAll(".slot").forEach((n, i) => {
        setTimeout(() => { n.classList.remove("correct", "wrong"); n.classList.add("locked-gold"); }, i * 35);
      });
    },
  };
}
const boards = {
  practice: createBoard("practice", "slots", "pool", "feedback"),
  1: createBoard("1", "slots1", "pool1", "feedback1"),
  2: createBoard("2", "slots2", "pool2", "feedback2"),
};

// —— App state ——
let gameMode = "practice";
let pickP1 = null, pickP2 = null;
let readyP1 = false, readyP2 = false;
let qi = 0, results = [], busy = false;
let hp = { 1: MAX_HP, 2: MAX_HP };
let battleDeck = []; // shared shuffled question order
let playerQi = { 1: 0, 2: 0 }; // independent progress into battleDeck
let charge = { 1: 0, 2: 0 }; // accumulated attack value
let combo = { 1: 0, 2: 0 }; // consecutive correct → N COMBO
let gaugeHits = { 1: 0, 2: 0 }; // correct answers toward special (need GAUGE_HITS_TO_FULL)
let blockUntil = { 1: 0, 2: 0 }; // performance.now() deadline for block window
let submitLockUntil = { 1: 0, 2: 0 }; // locked from submitting (foe skill)
let attackLockUntil = { 1: 0, 2: 0 }; // locked from attacking (ya frost_seal)
let ampHits = { 1: 0, 2: 0 }; // extra hits on next attack (go active)
let skillTimers = { 1: { block: 0, lock: 0, attack: 0 }, 2: { block: 0, lock: 0, attack: 0 } };
let battleStats = null;
let battleOpen = false;
let battleStartedAt = 0, timerRaf = 0;
let attackQueue = Promise.resolve();
let everMissed = []; // practice: whether the question was missed at least once

// —— Character select UI（旋風式左右滑動；兩端同時選，不可同角）——
let charFocus = { 1: 0, 2: 0 };
const charSwipe = new Map(); // pointerId → { player, startX, lastX }
const lastCharSwipeAt = { 1: 0, 2: 0 };
function charOffsetClass(offset) {
  if (offset === 0) return "pos-0 focus";
  if (offset === -1) return "pos-l1";
  if (offset === 1) return "pos-r1";
  if (offset <= -2) return "pos-l2";
  return "pos-r2";
}
function wrappedCharOffset(index, focus, n) {
  let d = ((index - focus) % n + n) % n;
  if (d > n / 2) d -= n;
  return d;
}
function updateCharReadyButtons() {
  [1, 2].forEach((player) => {
    const btn = document.querySelector('[data-char-ready="' + player + '"]');
    if (!btn) return;
    const mine = player === 1 ? pickP1 : pickP2;
    const confirmed = player === 1 ? readyP1 : readyP2;
    if (confirmed) {
      btn.disabled = true;
      btn.classList.add("is-ready");
      btn.textContent = "已確定";
    } else {
      btn.classList.remove("is-ready");
      btn.textContent = "確定";
      btn.disabled = !mine;
    }
  });
}
function renderCharGrid() {
  const n = CHARACTERS.length;
  [1, 2].forEach((player) => {
    const stage = document.querySelector('[data-char-stage="' + player + '"]');
    if (!stage) return;
    const mine = player === 1 ? pickP1 : pickP2;
    const foe = player === 1 ? pickP2 : pickP1;
    const locked = player === 1 ? readyP1 : readyP2;
    if (mine) {
      const idx = CHARACTERS.findIndex((c) => c.id === mine.id);
      if (idx >= 0) charFocus[player] = idx;
    }
    const focus = ((charFocus[player] % n) + n) % n;
    charFocus[player] = focus;
    stage.innerHTML = "";
    CHARACTERS.forEach((c, i) => {
      const offset = wrappedCharOffset(i, focus, n);
      const visualOffset = player === 2 ? -offset : offset;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "char-card " + charOffsetClass(visualOffset);
      btn.dataset.charId = c.id;
      btn.dataset.charIndex = String(i);
      if (foe?.id === c.id) btn.classList.add("taken");
      else if (locked && mine?.id !== c.id) btn.classList.add("taken");
      btn.innerHTML = `
        <span class="badge">${c.title}</span>
        <img src="${c.image}" alt="${c.name}" draggable="false" />
        <div class="meta"><strong>${c.name}</strong><span>${c.skill}</span><span class="passive">${c.passive?.label || ""}：${c.passive?.desc || ""}${c.active ? " · 主動「" + c.active.label + "」" : ""}</span></div>`;
      if (!locked) {
        bindTap(btn, () => {
          if (performance.now() - (lastCharSwipeAt[player] || 0) < 320) return;
          if (i === focus) onPickChar(player, c);
          else stepCharFocus(player, offset > 0 ? 1 : -1);
        });
      } else {
        btn.style.pointerEvents = "none";
      }
      stage.appendChild(btn);
    });
    const label = document.querySelector('[data-char-picked="' + player + '"]');
    if (label) {
      label.textContent = mine
        ? (mine.name + (mine.passive?.label ? " · " + mine.passive.label : ""))
        : "—";
    }
    document.querySelectorAll('[data-char-carousel="' + player + '"] .char-nav').forEach((nav) => {
      nav.disabled = !!locked;
    });
  });
  updateCharReadyButtons();
}
function stepCharFocus(player, dir) {
  if ((player === 1 && readyP1) || (player === 2 && readyP2)) return;
  const n = CHARACTERS.length;
  charFocus[player] = ((charFocus[player] + dir) % n + n) % n;
  const c = CHARACTERS[charFocus[player]];
  const foe = player === 1 ? pickP2 : pickP1;
  playSfx("sfx_click", 0.22);
  if (foe?.id === c.id) {
    // 焦點停在已被選走的角：只轉盤，不選定
    if (player === 1) { pickP1 = null; readyP1 = false; }
    else { pickP2 = null; readyP2 = false; }
    renderCharGrid();
    return;
  }
  onPickChar(player, c);
}
function onPickChar(player, c) {
  if ((player === 1 && readyP1) || (player === 2 && readyP2)) return;
  const foe = player === 1 ? pickP2 : pickP1;
  if (foe?.id === c.id) {
    playSfx("sfx_miss", 0.3);
    return;
  }
  const idx = CHARACTERS.findIndex((x) => x.id === c.id);
  if (idx >= 0) charFocus[player] = idx;
  if (player === 1) { pickP1 = c; readyP1 = false; }
  else { pickP2 = c; readyP2 = false; }
  playSfx("pop", 0.32);
  renderCharGrid();
}
function onCharConfirm(player) {
  const mine = player === 1 ? pickP1 : pickP2;
  if (!mine) return;
  if (player === 1) readyP1 = true;
  else readyP2 = true;
  ensureAudioCtx();
  playSfx("sfx_click", 0.35);
  renderCharGrid();
  if (readyP1 && readyP2 && pickP1 && pickP2) playVsThenBattle();
}
function bindCharCarouselSwipe() {
  document.querySelectorAll("[data-char-stage]").forEach((stage) => {
    const player = Number(stage.getAttribute("data-char-stage"));
    stage.addEventListener("pointerdown", (e) => {
      if ((player === 1 && readyP1) || (player === 2 && readyP2)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      charSwipe.set(e.pointerId, { player, startX: e.clientX, lastX: e.clientX, moved: false });
      try { stage.setPointerCapture(e.pointerId); } catch {}
    }, { capture: true, passive: true });
    stage.addEventListener("pointermove", (e) => {
      const s = charSwipe.get(e.pointerId);
      if (!s) return;
      s.lastX = e.clientX;
      if (Math.abs(e.clientX - s.startX) > 12) s.moved = true;
    }, { capture: true, passive: true });
    const end = (e) => {
      const s = charSwipe.get(e.pointerId);
      if (!s) return;
      charSwipe.delete(e.pointerId);
      const dx = s.lastX - s.startX;
      if (Math.abs(dx) < 40) return;
      lastCharSwipeAt[s.player] = performance.now();
      // 左滑看下一位（與旋風選角手感一致；P2 已鏡像排列）
      stepCharFocus(s.player, dx < 0 ? 1 : -1);
    };
    stage.addEventListener("pointerup", end, { capture: true });
    stage.addEventListener("pointercancel", end, { capture: true });
  });
  document.querySelectorAll("[data-char-step]").forEach((btn) => {
    bindTap(btn, () => {
      if (btn.disabled) return;
      const player = Number(btn.dataset.p);
      const step = Number(btn.dataset.charStep);
      // P2 半場旋轉後左右鍵對調，配合鏡像排列
      const dir = player === 2 ? -step : step;
      stepCharFocus(player, dir);
    });
  });
}

// —— Practice ——
function currentQ() { return QUESTIONS[qi]; }
function startPractice() {
  gameMode = "practice";
  cancelAllDrags();
  // 從大題庫抽一輪，避免一次上百題
  QUESTIONS = shuffle(ALL_QUESTIONS).slice(0, Math.min(PRACTICE_ROUND_SIZE, ALL_QUESTIONS.length));
  qi = 0; results = QUESTIONS.map(() => null); everMissed = QUESTIONS.map(() => false); busy = false;
  hideReward(); showScreen("practice"); loadPracticeQuestion(true);
}
async function loadPracticeQuestion(autoSpeak) {
  const q = currentQ();
  boards.practice.load(q.kanaSequence);
  $("progress-text").textContent = `${qi + 1} / ${QUESTIONS.length}`;
  $("progress-dots").innerHTML = "";
  results.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === qi ? " current" : r === "ok" ? " ok" : everMissed[i] ? " miss" : "");
    $("progress-dots").appendChild(d);
  });
  $("q-type").textContent = TYPE_LABEL[q.contentType] || q.contentType;
  const title = $("q-title");
  title.textContent = questionPromptTitle(q);
  title.classList.add("mystery");
  $("portrait-name").textContent = "聽音練習";
  $("slots-hint").textContent = `共 ${q.kanaSequence.length} 格 · 請先聽音再拼（不顯示答案）`;
  $("q-diff").textContent = diamonds(q.kanaSequence.length);
  $("reward-tag").textContent = q.rewardMode === "cast_skill" ? "答對 · 喊招" : "答對 · 慶祝";
  $("reward-tag").className = "tag" + (q.rewardMode === "cast_skill" ? " cast" : "");
  $("avatar-img").src = q.image;
  if (autoSpeak) await speakGoogleTts(q.speakText);
}
async function practiceSubmit() {
  if (busy) return;
  const q = currentQ(), b = boards.practice;
  if (b.slots.some((v) => !v)) { b.setFeedback("還有空格。", "bad"); return; }
  playSfx("ready", 0.45);
  if (b.markSlots(q.kanaSequence)) {
    b.setFeedback("不正確，再試。", "bad"); playSfx("sfx_miss", 0.35); everMissed[qi] = true; return;
  }
  results[qi] = "ok";
  // 答對才揭曉
  $("q-title").textContent = q.displayName;
  $("q-title").classList.remove("mystery");
  $("portrait-name").textContent = q.displayName;
  await playReward(q);
}
function hideReward() {
  $("reward-stage").classList.remove("show");
  const vid = $("reward-video");
  try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {}
  $("reward-timer-bar").classList.remove("run");
}
function playCastVideo(q) {
  return new Promise((resolve) => {
    const vid = $("reward-video"), still = $("reward-still"), bar = $("reward-timer-bar");
    bar.classList.remove("run"); void bar.offsetWidth; bar.classList.add("run");
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const hard = setTimeout(finish, 3100);
    if (q.castVideo) {
      still.classList.add("hidden"); vid.classList.remove("hidden");
      vid.onended = () => { clearTimeout(hard); finish(); };
      vid.onerror = () => { still.classList.remove("hidden"); still.src = q.image; setTimeout(() => { clearTimeout(hard); finish(); }, 3000); };
      vid.src = q.castVideo; vid.muted = true;
      vid.play().catch(() => { still.classList.remove("hidden"); still.src = q.image; setTimeout(() => { clearTimeout(hard); finish(); }, 3000); });
    } else {
      vid.classList.add("hidden"); still.classList.remove("hidden"); still.src = q.image;
      setTimeout(() => { clearTimeout(hard); finish(); }, 3000);
    }
  });
}
async function playReward(q) {
  busy = true; boards.practice.lockGold(); playSfx("skillpop", 0.5);
  showCombo(q.rewardMode === "cast_skill" ? "詠唱完成" : "完璧！");
  await wait(250);
  $("reward-stage").classList.add("show");
  if (q.rewardMode === "cast_skill") {
    $("reward-kicker").textContent = "SKILL CAST · 3s";
    $("reward-title").textContent = "技能發動";
    $("cast-name").textContent = q.castSubtitle || q.displayName;
    $("cast-kana").textContent = q.kanaSequence.join("・");
    $("reward-sub").textContent = q.castVideo ? "角色動畫" : "立繪展示 3 秒";
    $("btn-replay").style.display = "";
    await Promise.all([playCastVideo(q), speakGoogleTts(q.castSpeakText || q.speakText + "！", { rate: "0.95" })]);
  } else {
    $("reward-kicker").textContent = "CELEBRATE · 3s";
    $("reward-title").textContent = "完璧！";
    $("cast-name").textContent = ""; $("cast-kana").textContent = "";
    $("reward-sub").textContent = `記住了「${q.displayName}」`;
    $("btn-replay").style.display = "none";
    playSfx("win", 0.4);
    await Promise.all([playCastVideo(q), speakGoogleTts(q.speakText)]);
  }
  busy = false;
}
function practiceNext() {
  if (busy) return;
  hideReward();
  if (qi >= QUESTIONS.length - 1) {
    const ok = results.filter((r) => r === "ok").length;
    const perfect = results.filter((r, i) => r === "ok" && !everMissed[i]).length;
    setResultScreen("練習結束", `答對 ${ok} / ${QUESTIONS.length} · 一次過關 ${perfect} 題`);
    playSfx("fanfare", 0.4); return;
  }
  qi++; loadPracticeQuestion(true);
}

// —— Battle ——
function charOf(player) { return player === 1 ? pickP1 : pickP2; }
function fighterImgEl(player) { return $("fighter" + player + "-img"); }
function setFighterPose(player, pose) {
  const ch = charOf(player);
  const img = fighterImgEl(player);
  if (!ch || !img) return;
  let src = ch.image;
  if (pose === "atk" && ch.imageAtk) src = ch.imageAtk;
  else if (pose === "hit" && ch.imageHit) src = ch.imageHit;
  if (img.getAttribute("src") !== src) img.src = src;
}
function preloadFighterPoses(ch) {
  if (!ch) return;
  [ch.image, ch.imageAtk, ch.imageHit].forEach(function (url) {
    if (!url) return;
    const im = new Image();
    im.src = url;
  });
}
function playerQ(player) {
  if (!battleDeck.length) return null;
  return battleDeck[playerQi[player] % battleDeck.length];
}
function updateHpUi() {
  $("hp1-text").textContent = Math.max(0, hp[1]);
  $("hp2-text").textContent = Math.max(0, hp[2]);
  $("hp1-bar").style.width = (Math.max(0, hp[1]) / MAX_HP * 100) + "%";
  $("hp2-bar").style.width = (Math.max(0, hp[2]) / MAX_HP * 100) + "%";
  $("hp1-name").textContent = "P1 " + (pickP1?.name || "");
  $("hp2-name").textContent = "P2 " + (pickP2?.name || "");
}
/** 攻擊鈕顯示與實際結算共用同一條公式，避免兩邊算出不同數字 */
function projectedAttackDamage(player) {
  const special = gaugeHits[player] >= GAUGE_HITS_TO_FULL;
  let dmg = charge[player] || 0;
  if (dmg <= 0) return { dmg: 0, hits: 0, special };
  if (special) dmg = Math.round(dmg * specialMultOf(player));
  const hits = Math.max(1, (combo[player] || 1) + hitBonusOf(player) + (ampHits[player] || 0));
  return { dmg: Math.round(dmg * (1 + (hits - 1) * COMBO_DAMAGE_PER_HIT)), hits, special };
}
function updatePlayerMeters(player) {
  const c = charge[player];
  const hits = gaugeHits[player];
  const ready = hits >= GAUGE_HITS_TO_FULL && c > 0;
  const gaugePct = Math.min(100, (hits / GAUGE_HITS_TO_FULL) * 100);
  const bar = $("gauge-bar-" + player);
  if (bar) bar.style.width = gaugePct + "%";
  $("gauge-wrap-" + player)?.classList.toggle("ready", ready);
  const btn = $("btn-attack-" + player);
  if (btn) {
    const atkLocked = isAttackLocked(player);
    btn.disabled = c <= 0 || atkLocked;
    btn.classList.toggle("special", ready && !atkLocked);
    if (atkLocked) btn.textContent = "凍結中";
    else if (c <= 0) btn.textContent = "攻擊 0";
    else btn.textContent = (ready ? "大招 " : "攻擊 ") + projectedAttackDamage(player).dmg;
  }
  const f = $("fighter" + player);
  if (f) f.classList.toggle("active-turn", ready && !isAttackLocked(player));
  updateSkillUi(player);
}
function nowMs() { return performance.now(); }
function isBlocking(player) { return nowMs() < (blockUntil[player] || 0); }
function isSubmitLocked(player) { return nowMs() < (submitLockUntil[player] || 0); }
function isAttackLocked(player) { return nowMs() < (attackLockUntil[player] || 0); }
function spendCombo(player, cost) {
  if ((combo[player] || 0) < cost) return false;
  combo[player] -= cost;
  return true;
}
function clearSkillTimers(player) {
  const t = skillTimers[player];
  if (!t) return;
  if (t.block) { clearTimeout(t.block); t.block = 0; }
  if (t.lock) { clearTimeout(t.lock); t.lock = 0; }
  if (t.attack) { clearTimeout(t.attack); t.attack = 0; }
}
function scheduleBlockExpire(player) {
  const t = skillTimers[player];
  if (t.block) clearTimeout(t.block);
  const left = Math.max(0, (blockUntil[player] || 0) - nowMs());
  t.block = setTimeout(function () {
    t.block = 0;
    const f = $("fighter" + player);
    if (f) f.classList.remove("blocking");
    updateSkillUi(player);
  }, left + 16);
}
function scheduleSubmitLockExpire(player) {
  const t = skillTimers[player];
  if (t.lock) clearTimeout(t.lock);
  const left = Math.max(0, (submitLockUntil[player] || 0) - nowMs());
  t.lock = setTimeout(function () {
    t.lock = 0;
    updateSkillUi(player);
    const b = boards[player];
    if (b && !b.locked) b.setFeedback("");
  }, left + 16);
}
function scheduleAttackLockExpire(player) {
  const t = skillTimers[player];
  if (t.attack) clearTimeout(t.attack);
  const left = Math.max(0, (attackLockUntil[player] || 0) - nowMs());
  t.attack = setTimeout(function () {
    t.attack = 0;
    updatePlayerMeters(player);
    const b = boards[player];
    if (b && !b.locked) b.setFeedback("");
  }, left + 16);
}
function updateSkillUi(player) {
  const chip = $("combo-chip-" + player);
  if (chip) chip.textContent = "COMBO " + (combo[player] || 0);
  const blocking = isBlocking(player);
  const f = $("fighter" + player);
  if (f) f.classList.toggle("blocking", blocking);
  const btnBlock = $("btn-skill-block-" + player);
  if (btnBlock) {
    btnBlock.disabled = !battleOpen || (combo[player] || 0) < BLOCK_COMBO_COST;
    btnBlock.classList.toggle("is-active", blocking);
    btnBlock.textContent = blocking ? "格擋中" : "格擋";
  }
  const btnHeal = $("btn-skill-heal-" + player);
  if (btnHeal) {
    const full = hp[player] >= MAX_HP;
    btnHeal.disabled = !battleOpen || full || (combo[player] || 0) < HEAL_COMBO_COST;
  }
  const ch = charOf(player);
  const act = ch?.active;
  const btnU = $("btn-skill-unique-" + player);
  if (btnU) {
    const cost = act?.cost || 2;
    btnU.textContent = act?.label || "專屬";
    btnU.title = act?.desc || "";
    let can = battleOpen && !!act && (combo[player] || 0) >= cost;
    if (act?.id === "ember_steal" || act?.id === "light_drain") {
      const foe = player === 1 ? 2 : 1;
      can = can && (charge[foe] || 0) > 0;
    } else if (act?.id === "thunder_amp") {
      can = can && (ampHits[player] || 0) <= 0;
    }
    btnU.disabled = !can;
    btnU.classList.toggle("is-active", act?.id === "thunder_amp" && (ampHits[player] || 0) > 0);
  }
  const btnSubmit = $("btn-submit-" + player);
  if (btnSubmit) {
    const locked = isSubmitLocked(player);
    btnSubmit.disabled = locked;
    btnSubmit.textContent = locked ? "封鎖中" : "提交";
  }
}
function battleActivateBlock(player) {
  if (!battleOpen) return;
  if (!spendCombo(player, BLOCK_COMBO_COST)) {
    boards[player]?.setFeedback("需要 " + BLOCK_COMBO_COST + " COMBO", "bad");
    return;
  }
  blockUntil[player] = nowMs() + BLOCK_DURATION_MS;
  scheduleBlockExpire(player);
  playSfx("ready", 0.55);
  playSfx("skillpop", 0.35);
  playBlockActivate(player);
  showCombo("格擋", "sm");
  boards[player]?.setFeedback("格擋 " + (BLOCK_DURATION_MS / 1000) + " 秒 · 傷半", "ok");
  updatePlayerMeters(player);
}
function battleActivateHeal(player) {
  if (!battleOpen) return;
  if (hp[player] >= MAX_HP) {
    boards[player]?.setFeedback("血量已滿", "bad");
    return;
  }
  if (!spendCombo(player, HEAL_COMBO_COST)) {
    boards[player]?.setFeedback("需要 " + HEAL_COMBO_COST + " COMBO", "bad");
    return;
  }
  const before = hp[player];
  hp[player] = Math.min(MAX_HP, hp[player] + HEAL_AMOUNT);
  const gained = hp[player] - before;
  playSfx("fanfare", 0.28);
  showCombo("+" + gained + " HP", "sm");
  boards[player]?.setFeedback("回墨 +" + gained, "ok");
  updateHpUi();
  updatePlayerMeters(player);
}
function battleActivateUnique(player) {
  if (!battleOpen) return;
  const act = charOf(player)?.active;
  if (!act) return;
  const cost = act.cost || 2;
  const foe = player === 1 ? 2 : 1;
  if (act.id === "ink_seal" || act.id === "shadow_bind") {
    if (!spendCombo(player, cost)) {
      boards[player]?.setFeedback("需要 " + cost + " COMBO", "bad");
      return;
    }
    const label = act.label || "封鎖";
    submitLockUntil[foe] = nowMs() + SUBMIT_LOCK_MS;
    scheduleSubmitLockExpire(foe);
    playSfx("skillpop", 0.4);
    showCombo(label, "sm");
    boards[player]?.setFeedback(label + " · 對手提交封鎖", "ok");
    boards[foe]?.setFeedback("提交被封鎖！", "bad");
    updatePlayerMeters(player);
    updateSkillUi(foe);
    return;
  }
  if (act.id === "ember_steal" || act.id === "light_drain") {
    const avail = charge[foe] || 0;
    if (avail <= 0) {
      boards[player]?.setFeedback("對手沒有蓄力", "bad");
      return;
    }
    if (!spendCombo(player, cost)) {
      boards[player]?.setFeedback("需要 " + cost + " COMBO", "bad");
      return;
    }
    const stolen = Math.min(avail, Math.max(STEAL_CHARGE_MIN, Math.round(avail * STEAL_CHARGE_RATIO)));
    charge[foe] -= stolen;
    charge[player] += stolen;
    const label = act.label || "奪取";
    playSfx("skillpop", 0.45);
    showCombo(label + " +" + stolen, "md");
    boards[player]?.setFeedback(label + " +" + stolen, "ok");
    boards[foe]?.setFeedback("蓄力被奪 −" + stolen, "bad");
    updatePlayerMeters(player);
    updatePlayerMeters(foe);
    return;
  }
  if (act.id === "frost_seal" || act.id === "seal_silence") {
    if (!spendCombo(player, cost)) {
      boards[player]?.setFeedback("需要 " + cost + " COMBO", "bad");
      return;
    }
    const label = act.label || "封鎖";
    attackLockUntil[foe] = nowMs() + ATTACK_LOCK_MS;
    scheduleAttackLockExpire(foe);
    playSfx("skillpop", 0.4);
    showCombo(label, "sm");
    boards[player]?.setFeedback(label + " · 對手攻擊封鎖", "ok");
    boards[foe]?.setFeedback("攻擊被封鎖！", "bad");
    updatePlayerMeters(player);
    updatePlayerMeters(foe);
    return;
  }
  if (act.id === "thunder_amp") {
    if ((ampHits[player] || 0) > 0) {
      boards[player]?.setFeedback("連鳴已待機", "bad");
      return;
    }
    if (!spendCombo(player, cost)) {
      boards[player]?.setFeedback("需要 " + cost + " COMBO", "bad");
      return;
    }
    ampHits[player] = AMP_HIT_BONUS;
    playSfx("ready", 0.4);
    showCombo("連鳴 +"+ AMP_HIT_BONUS, "sm");
    boards[player]?.setFeedback("連鳴 · 下次攻擊 +" + AMP_HIT_BONUS + " 段", "ok");
    updatePlayerMeters(player);
    return;
  }
  if (act.id === "wind_step") {
    if (!spendCombo(player, cost)) {
      boards[player]?.setFeedback("需要 " + cost + " COMBO", "bad");
      return;
    }
    submitLockUntil[player] = 0;
    attackLockUntil[player] = 0;
    blockUntil[player] = nowMs() + 3000;
    scheduleBlockExpire(player);
    playSfx("ready", 0.45);
    playSfx("skillpop", 0.3);
    playBlockActivate(player);
    showCombo("風閃", "sm");
    boards[player]?.setFeedback("風閃 · 解鎖並格擋 3 秒", "ok");
    updatePlayerMeters(player);
    updateSkillUi(player);
  }
}
function calcChargeGain(player, q) {
  // combo 已含本題（答對後先 +1 再呼叫）
  const streak = combo[player];
  const base = 58 + q.kanaSequence.length * 6;
  const comboMult = 1 + Math.max(0, streak - 1) * 0.08;
  let gain = Math.max(40, Math.round(base * comboMult));
  const chargeMult = charOf(player)?.passive?.chargeMult;
  if (chargeMult != null) gain = Math.max(36, Math.round(gain * chargeMult));
  return gain;
}
function gaugeGainOf(player) {
  return Math.max(1, charOf(player)?.passive?.gaugePerCorrect || 1);
}
function specialMultOf(player) {
  return charOf(player)?.passive?.specialMult || SPECIAL_MULT;
}
function hitBonusOf(player) {
  return Math.max(0, charOf(player)?.passive?.hitBonus || 0);
}
function syncFighterPassive(player) {
  const chip = $("passive-chip-" + player);
  const ch = charOf(player);
  const f = $("fighter" + player);
  if (f) f.dataset.theme = ch?.id || "";
  if (!chip) return;
  chip.textContent = ch?.passive?.label || "";
  chip.title = ch?.passive?.desc || "";
  chip.hidden = !ch?.passive?.label;
}

function playVsThenBattle() {
  if (!pickP1 || !pickP2) return;
  document.querySelectorAll('[data-vs="img1"]').forEach((el) => { el.src = pickP1.image; });
  document.querySelectorAll('[data-vs="img2"]').forEach((el) => { el.src = pickP2.image; });
  document.querySelectorAll('[data-vs="name1"]').forEach((el) => {
    el.textContent = pickP1.name + " · " + (pickP1.passive?.label || pickP1.skill || pickP1.title);
  });
  document.querySelectorAll('[data-vs="name2"]').forEach((el) => {
    el.textContent = pickP2.name + " · " + (pickP2.passive?.label || pickP2.skill || pickP2.title);
  });
  document.querySelectorAll('[data-vs="rule"]').forEach((el) => { el.textContent = "INK REALM"; });
  const stage = $("vs-stage");
  stage.classList.remove("show");
  void stage.offsetWidth;
  stage.classList.add("show");
  stage.setAttribute("aria-hidden", "false");
  playSfx("fanfare", 0.35);
  setTimeout(() => {
    stage.classList.remove("show");
    stage.setAttribute("aria-hidden", "true");
    startBattle();
  }, 4000);
}

function startBattle() {
  gameMode = "battle";
  cancelAllDrags();
  clearBattleFx();
  setSfxDuck(1);
  stopVoice();
  hp = { 1: MAX_HP, 2: MAX_HP };
  battleDeck = buildBattleDeck();
  const rule = $("rule-chip");
  if (rule) {
    const bits = ["墨域・言靈対決"];
    if (!battleOpts.distractors) bits.push("無干擾");
    if (battleOpts.maxLen > 0) bits.push("≤" + battleOpts.maxLen + "字");
    if (battleOpts.script === "hira") bits.push("平假名");
    if (battleOpts.script === "kata") bits.push("片假名");
    rule.textContent = bits.join(" · ");
  }
  playerQi = { 1: 0, 2: 0 };
  charge = { 1: 0, 2: 0 };
  combo = { 1: 0, 2: 0 };
  gaugeHits = { 1: 0, 2: 0 };
  blockUntil = { 1: 0, 2: 0 };
  submitLockUntil = { 1: 0, 2: 0 };
  attackLockUntil = { 1: 0, 2: 0 };
  ampHits = { 1: 0, 2: 0 };
  clearSkillTimers(1);
  clearSkillTimers(2);
  resetBattleStats();
  battleOpen = true;
  attackQueue = Promise.resolve();
  $("fighter1").classList.remove("defeated", "hit", "hit-strong", "attacking", "blocking");
  $("fighter2").classList.remove("defeated", "hit", "hit-strong", "attacking", "blocking");
  document.querySelector(".duel-stage")?.classList.remove("ko-hold");
  $("fighter1-img").src = pickP1.image;
  $("fighter2-img").src = pickP2.image;
  preloadFighterPoses(pickP1);
  preloadFighterPoses(pickP2);
  syncFighterPassive(1);
  syncFighterPassive(2);
  ensureCastLayers();
  updateHpUi();
  updatePlayerMeters(1);
  updatePlayerMeters(2);
  showScreen("battle");
  loadPlayerQuestion(1);
  loadPlayerQuestion(2);
  battleStartedAt = performance.now();
  cancelAnimationFrame(timerRaf);
  tickBattleClock();
  startBattleBgm().catch(() => {});
}

function playVoice(url, volume = 0.88) {
  return new Promise(async (resolve) => {
    if (!url) { resolve(false); return; }
    stopVoice();
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const ctx = await ensureAudioCtx();
      if (ctx) {
        let buf = voiceBufCache.get(url);
        if (!buf) {
          const res = await fetch(url);
          if (res.ok) {
            buf = await ctx.decodeAudioData(await res.arrayBuffer());
            voiceBufCache.set(url, buf);
          }
        }
        if (buf) {
          const src = ctx.createBufferSource();
          const g = ctx.createGain();
          g.gain.value = Math.min(1, volume);
          src.buffer = buf;
          src.connect(g);
          g.connect(ctx.destination);
          voiceWebSrc = src;
          src.onended = () => { if (voiceWebSrc === src) voiceWebSrc = null; done(true); };
          src.start(0);
          setTimeout(() => done(true), Math.ceil(buf.duration * 1000) + 120);
          return;
        }
      }
    } catch {}
    try {
      const a = new Audio(url);
      voiceHtml = a;
      a.volume = Math.min(1, volume);
      a.onended = () => { if (voiceHtml === a) voiceHtml = null; done(true); };
      a.onerror = () => done(false);
      a.play().then(() => {}).catch(() => done(false));
      setTimeout(() => done(false), 4500);
    } catch {
      done(false);
    }
  });
}

function resetBattleStats() {
  battleStats = {
    maxCombo: { 1: 0, 2: 0 },
    bestAnswerMs: { 1: null, 2: null },
    totalAnswerMs: { 1: 0, 2: 0 },
    corrects: { 1: 0, 2: 0 },
    firstSpecial: null,
    qOpenedAt: { 1: 0, 2: 0 },
  };
}
function noteQuestionOpen(player) {
  if (!battleStats) return;
  battleStats.qOpenedAt[player] = performance.now();
}
function noteCorrectAnswer(player) {
  if (!battleStats) return;
  const opened = battleStats.qOpenedAt[player] || battleStartedAt || performance.now();
  const ms = Math.max(0, performance.now() - opened);
  battleStats.corrects[player] += 1;
  battleStats.totalAnswerMs[player] += ms;
  if (battleStats.bestAnswerMs[player] == null || ms < battleStats.bestAnswerMs[player]) {
    battleStats.bestAnswerMs[player] = ms;
  }
  battleStats.maxCombo[player] = Math.max(battleStats.maxCombo[player] || 0, combo[player] || 0);
}
function noteSpecialFired(player) {
  if (!battleStats) return;
  if (battleStats.firstSpecial == null) battleStats.firstSpecial = player;
}
function formatAnswerSec(ms) {
  if (ms == null || !isFinite(ms)) return "—";
  return (ms / 1000).toFixed(1) + "s";
}
function buildBattleStatsRows() {
  if (!battleStats) return "";
  const p1Name = pickP1?.name || "P1";
  const p2Name = pickP2?.name || "P2";
  const p1 = '<span class="tag-p1">P1</span>';
  const p2 = '<span class="tag-p2">P2</span>';
  const winMark = function (player) {
    if (!player) return "";
    const cls = player === 1 ? "tag-p1" : "tag-p2";
    return ' <span class="tag-win">（<span class="' + cls + '">P' + player + "</span>）</span>";
  };
  const pairText = function (v1, v2, winner, tieLabel) {
    return p1 + " " + v1 + " · " + p2 + " " + v2 +
      (winner ? winMark(winner) : (tieLabel || ""));
  };

  const mc1 = battleStats.maxCombo[1] || 0;
  const mc2 = battleStats.maxCombo[2] || 0;
  const maxComboWinner = mc1 === mc2 ? null : (mc1 > mc2 ? 1 : 2);
  const maxComboText = pairText(String(mc1), String(mc2), maxComboWinner, mc1 > 0 ? " <span class=\"tag-win\">（平手）</span>" : "");

  const b1 = battleStats.bestAnswerMs[1];
  const b2 = battleStats.bestAnswerMs[2];
  let fastestWinner = null;
  if (b1 != null && b2 != null) fastestWinner = b1 === b2 ? null : (b1 < b2 ? 1 : 2);
  else if (b1 != null) fastestWinner = 1;
  else if (b2 != null) fastestWinner = 2;
  const fastestText = pairText(
    formatAnswerSec(b1),
    formatAnswerSec(b2),
    fastestWinner,
    b1 != null && b2 != null ? " <span class=\"tag-win\">（平手）</span>" : ""
  );

  const c1 = battleStats.corrects[1] || 0;
  const c2 = battleStats.corrects[2] || 0;
  const avg1 = c1 > 0 ? battleStats.totalAnswerMs[1] / c1 : null;
  const avg2 = c2 > 0 ? battleStats.totalAnswerMs[2] / c2 : null;
  let avgWinner = null;
  if (avg1 != null && avg2 != null) avgWinner = avg1 === avg2 ? null : (avg1 < avg2 ? 1 : 2);
  else if (avg1 != null) avgWinner = 1;
  else if (avg2 != null) avgWinner = 2;
  const avgText = pairText(
    formatAnswerSec(avg1),
    formatAnswerSec(avg2),
    avgWinner,
    avg1 != null && avg2 != null ? " <span class=\"tag-win\">（平手）</span>" : ""
  );

  let specialText = "本場未開大招";
  if (battleStats.firstSpecial === 1) specialText = p1 + " " + p1Name;
  else if (battleStats.firstSpecial === 2) specialText = p2 + " " + p2Name;

  return [
    ["最大連段", maxComboText],
    ["最快答題", fastestText],
    ["平均答題", avgText],
    ["先開大招", specialText],
  ].map(function (row) {
    return "<li><span>" + row[0] + "</span><b>" + row[1] + "</b></li>";
  }).join("");
}

function colorizePlayerTags(text) {
  return String(text || "")
    .replace(/P1/g, '<span class="tag-p1">P1</span>')
    .replace(/P2/g, '<span class="tag-p2">P2</span>');
}

function setResultScreen(title, summary, withBattleStats) {
  document.querySelectorAll(".result-title").forEach((el) => { el.innerHTML = colorizePlayerTags(title); });
  document.querySelectorAll(".result-summary").forEach((el) => { el.innerHTML = colorizePlayerTags(summary || "—"); });
  const rows = withBattleStats ? buildBattleStatsRows() : "";
  document.querySelectorAll("[data-result-stats]").forEach((el) => {
    if (rows) {
      el.innerHTML = rows;
      el.classList.remove("hidden");
    } else {
      el.innerHTML = "";
      el.classList.add("hidden");
    }
  });
  showScreen("result");
}

/** 敗北餘韻：先讓灰階／慘叫留在對戰畫面，再進結算 */
async function finishBattleDefeat(loser, winner, title, summary) {
  battleOpen = false;
  cancelAnimationFrame(timerRaf);
  cancelAllDrags();
  // 壓低連打音效，避免蓋過敗北慘叫
  setSfxDuck(0.04);
  stopVoice();
  const stage = document.querySelector(".duel-stage");
  const loserEl = $("fighter" + loser);
  const winnerEl = $("fighter" + winner);
  const loserCh = charOf(loser);
  stage?.classList.add("ko-hold");
  if (winnerEl) {
    winnerEl.classList.remove("hit", "hit-strong", "attacking");
    setFighterPose(winner, "idle");
  }
  if (loserEl) {
    loserEl.classList.remove("hit", "hit-strong", "attacking", "active-turn");
    setFighterPose(loser, "hit");
    void loserEl.offsetWidth;
    loserEl.classList.add("defeated");
  }
  showCombo("KO", "lg");
  shakeBattle(true);
  stopBattleBgm();
  // 等最後幾下 hit SFX 衰减，再清楚播慘叫
  await wait(420);
  await playVoice(loserCh && loserCh.voiceDefeat, 1);
  // 黑白敗北餘韻再多留一秒再進結算
  await wait(1900);
  setSfxDuck(1);
  clearBattleFx();
  stage?.classList.remove("ko-hold");
  setResultScreen(title, summary, true);
  playSfx("fanfare", 0.55);
}

function hideSpecialStage() {
  const stage = $("special-stage");
  if (!stage) return;
  stage.classList.remove("show", "portrait-cast", "foe-upright");
  stage.setAttribute("aria-hidden", "true");
  const vid = $("special-video");
  try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {}
}

/** 大招：播 6s 影片（內建喊招＋音效），結束後才接連打；畫面朝對手正向 */
function playSpecialUltimate(player) {
  return new Promise(async (resolve) => {
    cancelAllDrags();
    const ch = charOf(player);
    const stage = $("special-stage");
    const vid = $("special-video");
    const still = $("special-still");
    if (!ch || !stage) { resolve(false); return; }

    stage.dataset.theme = ch.id;
    $("special-name").textContent = ch.name;
    $("special-skill").textContent = ch.skill || "";
    stage.classList.remove("portrait-cast", "foe-upright");
    // P1 放招 → 整層轉 180°，對座 P2 看正面；P2 放招則不轉，P1 看正面
    stage.classList.toggle("foe-upright", player === 1);
    stage.classList.add("show");
    stage.setAttribute("aria-hidden", "false");
    keepBattleBgmAlive();

    await new Promise((done) => {
      let settled = false;
      let pulse = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (pulse) clearInterval(pulse);
        done();
      };
      const hard = setTimeout(finish, 7000);
      pulse = setInterval(keepBattleBgmAlive, 120);
      const usePortrait = () => {
        if (pulse) { clearInterval(pulse); pulse = null; }
        still.src = ch.image;
        stage.classList.add("portrait-cast");
        setTimeout(() => { clearTimeout(hard); finish(); }, 3000);
      };
      vid.onended = () => { clearTimeout(hard); finish(); };
      vid.onerror = () => { clearTimeout(hard); usePortrait(); };
      vid.muted = false;
      vid.volume = 1;
      vid.setAttribute("playsinline", "");
      vid.setAttribute("webkit-playsinline", "");
      vid.src = ch.castVideo;
      try { vid.currentTime = 0; } catch {}
      vid.play().then(() => {
        keepBattleBgmAlive();
      }).catch(() => { clearTimeout(hard); usePortrait(); });
    });

    hideSpecialStage();
    keepBattleBgmAlive();
    // 影片後 HTMLAudio 可能被擋；確保 hit 用 Web Audio
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    resolve(true);
  });
}

function ensureCastLayers() {
  [1, 2].forEach((p) => {
    const f = $("fighter" + p);
    if (!f) return;
    if (!f.querySelector(".hit-flash")) {
      const flash = document.createElement("div");
      flash.className = "hit-flash";
      f.appendChild(flash);
    }
    ensureBlockLayers(f);
  });
}

function loadPlayerQuestion(player) {
  const q = playerQ(player);
  if (!q) return;
  const ch = charOf(player);
  const noDistractors = !battleOpts.distractors;
  boards[player].load(q.kanaSequence, {
    showRomaji: true,
    noDistractors,
    distractorDelta: noDistractors ? 0 : (ch?.passive?.distractorDelta || 0),
  });
  noteQuestionOpen(player);
  updatePlayerMeters(player);
}

function tickBattleClock() {
  if (!battleOpen) return;
  const sec = (performance.now() - battleStartedAt) / 1000;
  const el = $("battle-timer");
  if (el) el.textContent = sec.toFixed(1) + "s";
  timerRaf = requestAnimationFrame(tickBattleClock);
}

function showDmgFloat(player, dmg, hitIndex) {
  const el = $("dmg" + player);
  el.textContent = "-" + dmg;
  el.classList.remove("show", "hit-lg");
  if (hitIndex >= 4) el.classList.add("hit-lg");
  void el.offsetWidth;
  el.classList.add("show");
}

function splitComboDamage(total, hits) {
  const n = Math.max(1, hits);
  const weights = [];
  let sumW = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 + Math.min(i, 4) * 0.35; // 越後面越痛
    weights.push(w);
    sumW += w;
  }
  const parts = weights.map((w) => Math.max(1, Math.round(total * (w / sumW))));
  let diff = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += diff;
  if (parts[parts.length - 1] < 1) parts[parts.length - 1] = 1;
  return parts;
}

function enqueueAttack(fn) {
  attackQueue = attackQueue.then(fn).catch(function () {});
  return attackQueue;
}

async function applyAttack(player, dmg, isSpecial, hitCount, comboCount) {
  const foe = player === 1 ? 2 : 1;
  const def = $("fighter" + foe);
  const atk = $("fighter" + player);
  const foeCh = charOf(foe);
  const atkTheme = fxThemeOf(player);
  const hits = Math.max(1, hitCount || 1);
  // 演出段數可能被上限截短，報數字時仍用玩家實際累積的 COMBO
  const shownCombo = comboCount || hits;
  // 攻擊開始時若對方在格擋窗內，整包傷害（含大招長動畫後結算）都減半
  let guarded = isBlocking(foe);
  const label = isSpecial ? "大招" : "攻擊";
  playSfx("skillpop", 0.45);
  showCombo(label + " · " + shownCombo + " COMBO", shownCombo >= 5 ? "lg" : shownCombo >= 3 ? "md" : "sm");

  if (isSpecial) {
    setFighterPose(player, "atk");
    atk.classList.add("attacking");
    await playSpecialUltimate(player);
    await playSpecialAftermath(atkTheme.id);
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
    await preloadBattleSfx().catch(() => {});
    // 大招開場連射兩道
    playAttackBolt(player, foe, atkTheme, true);
    await wait(90);
    await playAttackBolt(player, foe, atkTheme, true);
    shakeBattle(true);
  } else {
    playCastBurst(atk, atkTheme);
    setFighterPose(player, "atk");
    atk.classList.add("attacking");
    await playAttackBolt(player, foe, atkTheme, hits >= 3);
    if (hits >= 4) {
      playAttackBolt(player, foe, atkTheme, true);
      await wait(70);
    }
  }

  // 演出期間若補按格擋，也算擋下本包
  if (isBlocking(foe)) guarded = true;
  if (guarded) {
    showCombo("格擋!", "sm");
    spawnBlockParry(def, true);
    playSfx("ready", 0.5);
  }

  const parts = splitComboDamage(dmg, hits);
  setFighterPose(foe, "hit");
  for (let i = 0; i < parts.length; i++) {
    if (!battleOpen || hp[foe] <= 0) break;
    const hitNo = i + 1;
    const sfxNo = Math.min(hitNo, 5);
    let partDmg = parts[i];
    if (guarded) partDmg = Math.max(1, Math.round(partDmg * BLOCK_DAMAGE_MULT));
    const willKill = hp[foe] - partDmg <= 0;
    playHitSfx(sfxNo);
    // 致命一擊留給敗北慘叫，避免受擊語音蓋過
    if (!willKill && (hitNo === 1 || hitNo === hits || hitNo === 3)) {
      playVoice(foeCh && foeCh.voiceHit, 0.7);
    }
    const tier = hitNo >= 5 ? "lg" : hitNo >= 3 ? "md" : "sm";
    showCombo("HIT " + hitNo, tier);
    hp[foe] = Math.max(0, hp[foe] - partDmg);
    updateHpUi();
    showDmgFloat(foe, partDmg, hitNo);
    if (guarded) {
      spawnBlockParry(def, hitNo === 1 || hitNo === hits || isSpecial);
    } else {
      spawnHitBurst(def, atkTheme, hitNo + (isSpecial ? 2 : 0));
    }
    shakeBattle(hitNo >= 3 || isSpecial || hitNo === hits);
    def.classList.remove("hit", "hit-strong", "block-absorb");
    void def.offsetWidth;
    if (guarded) def.classList.add("block-absorb");
    else def.classList.add(hitNo >= 4 || isSpecial ? "hit-strong" : "hit");
    const flash = def.querySelector(".hit-flash");
    if (flash && !guarded) {
      flash.className = "hit-flash theme-" + atkTheme.name;
      void flash.offsetWidth;
      flash.classList.add("go");
    }
    // 每下都補軌跡；大招／尾段更密
    playAttackBolt(player, foe, atkTheme, isSpecial || hitNo >= 3 || hitNo === hits);
    if (isSpecial && hitNo % 2 === 0) {
      setTimeout(() => playAttackBolt(player, foe, atkTheme, true), 40);
    }
    await wait(230 + Math.min(hitNo, 5) * 18);
    def.classList.remove("hit", "hit-strong", "block-absorb");
    if (hp[foe] <= 0) break;
    await wait(28);
  }

  if (guarded) {
    blockUntil[foe] = 0;
    if (skillTimers[foe]?.block) { clearTimeout(skillTimers[foe].block); skillTimers[foe].block = 0; }
    def?.classList.remove("blocking", "block-absorb");
    const shield = def?.querySelector(".fx-shield");
    if (shield) shield.classList.remove("rise");
    updateSkillUi(foe);
  }

  atk.classList.remove("attacking");
  setFighterPose(player, "idle");
  if (hp[foe] > 0) {
    setFighterPose(foe, "idle");
  }

  if (hp[foe] <= 0) {
    await finishBattleDefeat(
      foe,
      player,
      "P" + player + " 勝利！",
      pickP1.name + " vs " + pickP2.name + " · 墨域對決 · " + shownCombo + " COMBO · 決勝 " + dmg +
      (isSpecial ? "（大招）" : "")
    );
    return true;
  }
  return false;
}

function applySelfMissDamage(player, dmg, wrongCount) {
  playSfx("sfx_miss", 0.4);
  playHitSfx(Math.min(Math.max(1, wrongCount), 5));
  const me = $("fighter" + player);
  const selfCh = charOf(player);
  const theme = fxThemeOf(player);
  hp[player] = Math.max(0, hp[player] - dmg);
  updateHpUi();
  showDmgFloat(player, dmg, wrongCount);
  spawnHitBurst(me, theme, wrongCount);
  shakeBattle(wrongCount >= 3);
  if (me) {
    setFighterPose(player, "hit");
    me.classList.remove("hit", "hit-strong");
    void me.offsetWidth;
    me.classList.add(wrongCount >= 4 ? "hit-strong" : "hit");
    const flash = me.querySelector(".hit-flash");
    if (flash) {
      flash.className = "hit-flash theme-" + theme.name;
      void flash.offsetWidth;
      flash.classList.add("go");
    }
    setTimeout(() => {
      if (hp[player] > 0) {
        me.classList.remove("hit", "hit-strong");
        setFighterPose(player, "idle");
      }
    }, 400);
  }
  if (wrongCount >= 3) playVoice(selfCh && selfCh.voiceHit, 0.65);

  if (hp[player] <= 0) {
    const winner = player === 1 ? 2 : 1;
    // 走攻擊佇列，避免與進行中的攻擊演出搶畫面
    enqueueAttack(async function () {
      await finishBattleDefeat(
        player,
        winner,
        "P" + winner + " 勝利！",
        pickP1.name + " vs " + pickP2.name + " · 墨域對決 · 答錯自傷決勝（-" + dmg + "）"
      );
    });
  }
}

function maybeAutoBattleSubmit(boardId) {
  if (!battleOpen || gameMode !== "battle") return;
  const player = Number(boardId);
  if (player !== 1 && player !== 2) return;
  if (isSubmitLocked(player)) return;
  const b = boards[player];
  if (!b || b.locked) return;
  if (b.slots.some(function (v) { return !v; })) return;
  const q = playerQ(player);
  if (!q || !q.kanaSequence || q.kanaSequence.length !== b.slots.length) return;
  // 僅全對才自動提交；排錯仍用手按提交確認
  const allCorrect = b.slots.every(function (v, i) { return v && v.kana === q.kanaSequence[i]; });
  if (!allCorrect) return;
  battleSubmit(player);
}

function battleSubmit(player) {
  if (!battleOpen) return;
  if (isSubmitLocked(player)) {
    boards[player]?.setFeedback("提交被封鎖中", "bad");
    return;
  }
  const b = boards[player];
  if (b.locked) return;
  const q = playerQ(player);
  if (!q) return;
  if (b.slots.some(function (v) { return !v; })) { b.setFeedback("還有空格。", "bad"); return; }

  playSfx("ready", 0.45);
  const wrong = b.markSlots(q.kanaSequence);
  if (wrong) {
    const dmg = Math.max(1, wrong * MISS_SELF_DMG_PER_WRONG);
    combo[player] = 0;
    updatePlayerMeters(player);
    b.setFeedback("錯 " + wrong + " 格 · -" + dmg + " · 連擊中斷", "bad");
    applySelfMissDamage(player, dmg, wrong);
    return;
  }

  combo[player] += 1;
  gaugeHits[player] += gaugeGainOf(player);
  const gain = calcChargeGain(player, q);
  charge[player] += gain;
  noteCorrectAnswer(player);
  b.lockGold();
  b.setFeedback("+" + gain + " · " + combo[player] + " COMBO", "ok");
  updatePlayerMeters(player);
  showWordReveal(player, q);

  // 不等對方：立刻進自己的下一題（略延長讓飄字可讀）
  playerQi[player] += 1;
  setTimeout(function () {
    if (!battleOpen) return;
    loadPlayerQuestion(player);
  }, 900);
}

function battleFireAttack(player) {
  if (!battleOpen) return;
  if (isAttackLocked(player)) {
    boards[player]?.setFeedback("攻擊被凍結中", "bad");
    return;
  }
  if (charge[player] <= 0) return;
  const { dmg, hits, special: isSpecial } = projectedAttackDamage(player);
  // 段數多到一定程度只會拖長演出（對手在演出期間仍可自由作答），故僅上限演出段數
  const segments = Math.min(hits, MAX_ATTACK_SEGMENTS);
  ampHits[player] = 0;
  charge[player] = 0;
  combo[player] = 0; // 發動後消耗 COMBO
  if (isSpecial) {
    gaugeHits[player] = 0;
    noteSpecialFired(player);
  }
  updatePlayerMeters(player);
  enqueueAttack(async function () {
    await applyAttack(player, dmg, isSpecial, segments, hits);
  });
}

function battleSkip(player) {
  if (!battleOpen) return;
  const b = boards[player];
  if (b.locked) return;
  combo[player] = 0;
  updatePlayerMeters(player);
  b.setFeedback("跳過 · 連擊中斷");
  playSfx("sfx_miss", 0.25);
  playerQi[player] += 1;
  loadPlayerQuestion(player);
}

async function enterMode(mode) {
  try { await getSessionToken(); setTtsStatus(true, "session OK"); }
  catch { setTtsStatus(false, "請用 localhost:8001"); }
  if (mode === "battle") {
    pickP1 = CHARACTERS[0] || null;
    pickP2 = CHARACTERS[1] || CHARACTERS[0] || null;
    readyP1 = false; readyP2 = false;
    charFocus = { 1: 0, 2: CHARACTERS.length > 1 ? 1 : 0 };
    showScreen("chars"); renderCharGrid();
  } else startPractice();
}

// pointerup 點擊：雙人多指＋快速連點時比 click 穩；並避開雙擊放大攔截
function bindTap(el, fn) {
  if (!el) return;
  let lastPointerAct = 0;
  let downPtr = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (drags.has(e.pointerId)) return;
    downPtr = e.pointerId;
  });
  el.addEventListener("pointerup", (e) => {
    if (downPtr !== e.pointerId) return;
    downPtr = null;
    if (drags.has(e.pointerId)) return;
    lastPointerAct = performance.now();
    fn(e);
  });
  el.addEventListener("pointercancel", (e) => {
    if (downPtr === e.pointerId) downPtr = null;
  });
  el.addEventListener("click", () => {
    if (performance.now() - lastPointerAct < 500) return;
    fn();
  });
}

// —— Events ——
bindTap($("btn-mode-practice"), () => enterMode("practice"));
bindTap($("btn-mode-battle"), () => enterMode("battle"));
document.querySelectorAll(".btn-char-back").forEach((btn) => {
  bindTap(btn, () => showScreen("start"));
});
document.querySelectorAll(".btn-char-ready").forEach((btn) => {
  bindTap(btn, () => {
    const p = Number(btn.dataset.charReady);
    onCharConfirm(p);
  });
});
bindCharCarouselSwipe();

bindTap($("btn-home-p"), () => { stopTts(); hideReward(); cancelAllDrags(); showScreen("start"); });
bindTap($("btn-home-b"), () => {
  stopTts(); stopBattleBgm(); hideSpecialStage(); cancelAllDrags(); clearBattleFx();
  battleOpen = false; cancelAnimationFrame(timerRaf);
  clearSkillTimers(1); clearSkillTimers(2);
  showScreen("start");
});
document.querySelectorAll(".btn-again-home").forEach((btn) => {
  bindTap(btn, () => {
    cancelAllDrags();
    stopBattleBgm();
    hideSpecialStage();
    clearBattleFx();
    battleOpen = false;
    cancelAnimationFrame(timerRaf);
    clearSkillTimers(1);
    clearSkillTimers(2);
    readyP1 = false;
    readyP2 = false;
    if (!pickP1) pickP1 = CHARACTERS[0] || null;
    if (!pickP2) pickP2 = CHARACTERS[1] || CHARACTERS[0] || null;
    charFocus = {
      1: Math.max(0, CHARACTERS.findIndex((c) => c.id === pickP1?.id)),
      2: Math.max(0, CHARACTERS.findIndex((c) => c.id === pickP2?.id)),
    };
    showScreen("chars");
    renderCharGrid();
  });
});
document.querySelectorAll(".btn-again").forEach((btn) => {
  bindTap(btn, () => {
    if (gameMode === "battle") {
      if (pickP1 && pickP2) startBattle();
      else showScreen("chars");
    } else startPractice();
  });
});

// 關閉平板／手機雙擊放大與捏合縮放（不攔截快速連點的 pointerup）
["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
});
document.addEventListener("touchmove", (e) => {
  if (typeof e.scale === "number" && e.scale !== 1) e.preventDefault();
}, { passive: false });
let lastTouchEndAt = 0;
document.addEventListener("touchend", (e) => {
  const now = performance.now();
  // 阻擋瀏覽器雙擊放大；按鈕動作改走 pointerup，不受影響
  if (now - lastTouchEndAt > 0 && now - lastTouchEndAt < 350) e.preventDefault();
  lastTouchEndAt = now;
}, { passive: false });
document.addEventListener("dblclick", (e) => e.preventDefault());

bindTap($("portrait"), () => { if (!busy && currentQ()) speakGoogleTts(currentQ().speakText); });
bindTap($("btn-listen"), () => { if (!busy && currentQ()) speakGoogleTts(currentQ().speakText); });
bindTap($("btn-clear"), () => boards.practice.clearAll());
bindTap($("btn-submit"), () => practiceSubmit());
bindTap($("btn-next"), () => practiceNext());
bindTap($("btn-replay"), () => { if (!busy) playReward(currentQ()); });
document.querySelectorAll("[data-act]").forEach((btn) => {
  bindTap(btn, () => {
    if (btn.disabled) return;
    const p = Number(btn.dataset.p), act = btn.dataset.act;
    if (act === "clear") boards[p].clearAll();
    else if (act === "submit") battleSubmit(p);
    else if (act === "skip") battleSkip(p);
    else if (act === "attack") battleFireAttack(p);
    else if (act === "skill-block") battleActivateBlock(p);
    else if (act === "skill-heal") battleActivateHeal(p);
    else if (act === "skill-unique") battleActivateUnique(p);
  });
});

if (location.protocol === "file:") setTtsStatus(false, "請用 localhost:8001");
else if (!/^https?:\/\/(localhost|127\.0\.0\.1):8001$/.test(location.origin)) setTtsStatus(false, "建議 localhost:8001");
else setTtsStatus(true, "來源 OK");
const qmeta = $("qbank-meta");
if (qmeta) {
  qmeta.textContent = ALL_QUESTIONS.length
    ? `題庫 ${ALL_QUESTIONS.length} 題 · 練習 ${PRACTICE_ROUND_SIZE} 題／輪`
    : "題庫未載入（請用 http 伺服器開）";
}
showScreen("start");
