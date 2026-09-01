// Characters, question normalization, kana mappings, and battle configuration.
const CHARACTERS = [
  {
    id: "ao", name: "墨切・蒼", title: "墨刃", skill: "一筆断空",
    image: "assets/characters/ao.webp",
    imageAtk: "assets/characters/ao-atk.webp",
    imageHit: "assets/characters/ao-hit.webp",
    castVideo: "assets/anim/ao-cast.mp4",
    voiceHit: "assets/voice/ao/hit.mp3",
    voiceDefeat: "assets/voice/ao/defeat.mp3",
    active: { id: "ink_seal", label: "墨鎖", desc: "耗 3 COMBO · 清空對手已選字，並加入 3 個干擾字", cost: 3 },
  },
  {
    id: "rin", name: "焔詠・燐", title: "焔詠", skill: "焦言劫火",
    image: "assets/characters/rin.webp",
    imageAtk: "assets/characters/rin-atk.webp",
    imageHit: "assets/characters/rin-hit.webp",
    castVideo: "assets/anim/rin-cast.mp4",
    voiceHit: "assets/voice/rin/hit.mp3",
    voiceDefeat: "assets/voice/rin/defeat.mp3",
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
    active: { id: "frost_reflect", label: "霜返", desc: "耗 2 COMBO · 反彈下一次敵方實際傷害的 50%", cost: 2 },
  },
  {
    id: "go", name: "雷拳・轟", title: "雷拳", skill: "轟鳴崩拳",
    image: "assets/characters/go.webp",
    imageAtk: "assets/characters/go-atk.webp",
    imageHit: "assets/characters/go-hit.webp",
    castVideo: "assets/anim/go-cast.mp4",
    voiceHit: "assets/voice/go/hit.mp3",
    voiceDefeat: "assets/voice/go/defeat.mp3",
    active: { id: "thunder_amp", label: "連鳴", desc: "耗 2 COMBO · 下次攻擊傷害 ×1.2", cost: 2 },
  },
  {
    id: "ran", name: "風蹴・嵐", title: "風蹴", skill: "嵐脚千刃",
    image: "assets/characters/ran.webp",
    imageAtk: "assets/characters/ran-atk.webp",
    imageHit: "assets/characters/ran-hit.webp",
    castVideo: "assets/anim/ran-cast.mp4",
    voiceHit: "assets/voice/ran/hit.mp3",
    voiceDefeat: "assets/voice/ran/defeat.mp3",
    active: { id: "wind_step", label: "風閃", desc: "耗 1 COMBO · 下次答錯保留 COMBO，且自傷減半", cost: 1 },
  },
  {
    id: "gen", name: "影刃・玄", title: "影刃", skill: "墨影千刹",
    image: "assets/characters/gen.webp",
    imageAtk: "assets/characters/gen-atk.webp",
    imageHit: "assets/characters/gen-hit.webp",
    castVideo: "assets/anim/gen-cast.mp4",
    voiceHit: "assets/voice/gen/hit.mp3",
    voiceDefeat: "assets/voice/gen/defeat.mp3",
    active: { id: "shadow_dodge", label: "影閃", desc: "首次耗 2 COMBO，獲得 60% 閃避；再耗 1 COMBO可 +10%，最高 80%", cost: 2 },
  },
  {
    id: "sho", name: "符筆・章", title: "符筆", skill: "万符封言",
    image: "assets/characters/sho.webp",
    imageAtk: "assets/characters/sho-atk.webp",
    imageHit: "assets/characters/sho-hit.webp",
    castVideo: "assets/anim/sho-cast.mp4",
    voiceHit: "assets/voice/sho/hit.mp3",
    voiceDefeat: "assets/voice/sho/defeat.mp3",
    active: { id: "seal_break", label: "符削", desc: "耗 3 COMBO · 隨機削減對手 3～5 COMBO", cost: 3 },
  },
  {
    id: "yo", name: "光扇・陽", title: "光扇", skill: "扇華断空",
    image: "assets/characters/yo.webp",
    imageAtk: "assets/characters/yo-atk.webp",
    imageHit: "assets/characters/yo-hit.webp",
    castVideo: "assets/anim/yo-cast.mp4",
    voiceHit: "assets/voice/yo/hit.mp3",
    voiceDefeat: "assets/voice/yo/defeat.mp3",
    active: { id: "light_regen", label: "光癒", desc: "耗 2 COMBO · 每 3 秒回復 1.5% HP，持續 30 秒", cost: 2 },
  },
];

const TYPE_LABEL = {
  character: "角色名",
  skill: "招式名",
  vocab: "詞彙",
};

/** 從 questions-data.js 與擴充檔載入；練習可抽樣、對戰用完整庫洗牌 */
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
      rewardMode: q.rewardMode || (q.contentType === "skill" ? "cast_skill" : "celebrate"),
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
  if (q.contentType === "skill") return "assets/characters/rin.webp";
  if (q.contentType === "character") return "assets/characters/ao.webp";
  return "assets/characters/ya.webp";
}
const ALL_QUESTIONS = normalizeQuestions(window.KANA_QUESTIONS || []);
const CATEGORY_OPTIONS = window.KANA_CATEGORY_OPTIONS || [{ value: "all", label: "全部類別" }];
function categoryLabelOf(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label || "全部類別";
}
function populateCategorySelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = CATEGORY_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
}
populateCategorySelect("opt-category");
populateCategorySelect("online-category");
let QUESTIONS = ALL_QUESTIONS.slice();
const PRACTICE_ROUND_SIZE = 12; // 單人一輪題數（從大題庫抽）
const MAX_HP = 2400;
const GAUGE_HITS_TO_FULL = 8;
const SPECIAL_MULT = 1.5;
const COMBO_DAMAGE_PER_HIT = 0.05; // 每多一段連打 +5% 總傷
const MAX_ATTACK_SEGMENTS = 8; // 演出段數上限；傷害仍照完整段數計算
const MISS_SELF_DMG_PER_WRONG = 72; // 答錯每格對自己扣血
const DRAG_THRESHOLD = 4;
const BLOCK_COMBO_COST = 3;
const BLOCK_DAMAGE_MULT = 0.2;
const HEAL_COMBO_COST = 2;
const HEAL_AMOUNT = 200;
const STEAL_CHARGE_MIN = 40;
const STEAL_CHARGE_RATIO = 0.2;
const ATTACK_BOOST_MULT = 1.2;
const REFLECT_DAMAGE_RATIO = 0.5;
const MISTAKE_GUARD_DAMAGE_MULT = 0.5;
const DODGE_START_CHANCE = 60;
const DODGE_STEP_CHANCE = 10;
const DODGE_MAX_CHANCE = 80;
const REGEN_TICK_MS = 3000;
const REGEN_TICKS = 10;
const REGEN_HP_PER_TICK = Math.round(MAX_HP * 0.015);

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function prefersReducedMotion() {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
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
  // 形近／音近／拗音易錯；表外則靠 buildPool 的通用字補足
  const m = {
    あ:["お","め","わ"],い:["り","ん","え"],う:["つ","ら","お","ん","む"],え:["へ","そ","い"],お:["あ","を","む"],
    か:["が","け","こ","た"],が:["か","ぎ","げ"],き:["ぎ","ち","け","さ"],ぎ:["き","じ","げ"],く:["ぐ","き","け","わ"],ぐ:["く","ご","が"],け:["げ","く","か"],げ:["け","ご","が"],こ:["ご","に","た","か"],ご:["こ","が","ぐ"],
    さ:["ざ","し","た","き"],ざ:["さ","じ","だ"],し:["じ","つ","ち","さ"],じ:["し","ち","ぎ"],す:["ず","つ","ぬ"],ず:["す","づ","つ"],せ:["ぜ","さ","れ"],ぜ:["せ","じ","で"],そ:["ぞ","ろ","ん"],ぞ:["そ","ど"],
    た:["だ","な","か"],だ:["た","ら","な"],ち:["ぢ","ら","き","し"],つ:["っ","づ","う","す"],づ:["つ","ず"],て:["で","た","ち","と"],で:["て","ど","れ"],と:["ど","て","り"],ど:["と","ろ","で"],
    な:["た","ら","め"],に:["り","こ","ぬ"],ぬ:["め","の","す"],ね:["れ","わ","め"],の:["め","ぬ","ん"],
    は:["ば","ぱ","ほ","わ"],ば:["は","ぱ","ぼ"],ぱ:["は","ば","ぽ"],ひ:["び","ぴ","い"],び:["ひ","ぴ","じ"],ぴ:["ひ","び"],ふ:["ぶ","ぷ","う"],ぶ:["ふ","ぷ","む"],ぷ:["ふ","ぶ"],へ:["べ","ぺ","え"],べ:["へ","ぺ"],ぺ:["へ","べ"],ほ:["ぼ","ぽ","は","ま"],ぼ:["ほ","ぽ","も"],ぽ:["ほ","ぼ"],
    ま:["も","は","ほ"],み:["り","ひ","む"],む:["ん","う","ぬ"],め:["ぬ","あ","ね"],も:["ま","を","ぼ"],
    や:["ゃ","ま","ゆ"],ゆ:["ゅ","つ","よ"],よ:["ょ","ま","ゆ"],
    ら:["り","ろ","な","う"],り:["い","ん","ろ","み"],る:["ろ","う","れ"],れ:["ね","わ","る"],ろ:["る","ら","そ"],
    わ:["れ","ね","は"],を:["お","も"],ん:["む","の","う","そ"],っ:["つ","く"],
    きゃ:["きゅ","き","や"],きゅ:["きょ","き","ゆ"],きょ:["きゅ","き","よ"],
    ぎゃ:["ぎゅ","ぎ","や"],ぎゅ:["ぎょ","ぎ","ゆ"],ぎょ:["ぎゅ","ぎ","よ"],
    しゃ:["しゅ","し","や"],しゅ:["しょ","し","ゆ"],しょ:["しゅ","し","よ"],
    じゃ:["じゅ","じ","や"],じゅ:["じょ","じ","ゆ"],じょ:["じゅ","じ","よ"],
    ちゃ:["ちゅ","ち","や"],ちゅ:["ちょ","ち","ゆ"],ちょ:["ちゅ","ち","よ"],
    にゃ:["にゅ","に","や"],にゅ:["にょ","に","ゆ"],にょ:["にゅ","に","よ"],
    ひゃ:["ひゅ","ひ","や"],ひゅ:["ひょ","ひ","ゆ"],ひょ:["ひゅ","ひ","よ"],
    みゃ:["みゅ","み","や"],みゅ:["みょ","み","ゆ"],みょ:["みゅ","み","よ"],
    りゃ:["りゅ","り","や"],りゅ:["りょ","り","ゆ"],りょ:["りゅ","り","よ"],
    ア:["メ","ワ","オ"],イ:["リ","ン","エ"],ウ:["ツ","ラ","オ"],エ:["ヘ","ソ","イ"],オ:["ア","ヲ","ム"],
    カ:["ガ","ケ","コ"],ガ:["カ","ギ","ゲ"],キ:["ギ","チ","ケ"],ギ:["キ","ジ"],ク:["グ","キ","ケ"],グ:["ク","ゴ"],ケ:["ゲ","ク"],コ:["ゴ","ニ"],ゴ:["コ","ガ","グ"],
    サ:["ザ","シ","タ"],シ:["ジ","ツ","チ"],ス:["ズ","ツ"],セ:["ゼ","サ"],ソ:["ゾ","ロ"],
    タ:["ダ","ナ"],チ:["ラ","キ"],ツ:["ッ","ウ","ス"],テ:["デ","タ","チ"],ト:["ド","テ"],
    ナ:["タ","ラ"],ニ:["リ","コ"],ヌ:["メ","ノ"],ネ:["レ","ワ"],ノ:["メ","ン"],
    ハ:["バ","パ","ホ"],ヒ:["ビ","ピ"],フ:["ブ","プ"],ヘ:["ベ","ペ"],ホ:["ボ","ポ","ハ"],
    マ:["モ","ハ"],ミ:["リ","ヒ"],ム:["ン","ウ"],メ:["ヌ","ネ"],モ:["マ","ヲ"],
    ヤ:["ャ","マ"],ユ:["ュ","ヨ"],ヨ:["ョ","ユ"],
    ラ:["リ","ロ","ナ"],リ:["イ","ン","ロ"],ル:["ロ","ウ"],レ:["ネ","ワ"],ロ:["ル","ラ"],
    ワ:["レ","ネ"],ン:["ム","ノ","ウ"],ッ:["ツ","ク"],
    キャ:["キュ","キ","ヤ"],キュ:["キョ","キ"],キョ:["キュ","キ","ヨ"],
    シャ:["シュ","シ"],シュ:["ショ","シ"],ショ:["シュ","シ","ヨ"],
    ジャ:["ジュ","ジ"],ジュ:["ジョ","ジ"],ジョ:["ジュ","ジ"],
    チャ:["チュ","チ"],チュ:["チョ","チ"],チョ:["チュ","チ"],
    ニャ:["ニュ","ニ"],ニュ:["ニョ","ニ"],ニョ:["ニュ","ニ"],
    ヒャ:["ヒュ","ヒ"],ヒュ:["ヒョ","ヒ"],ヒョ:["ヒュ","ヒ"],
    ミャ:["ミュ","ミ"],ミュ:["ミョ","ミ"],ミョ:["ミュ","ミ"],
    リャ:["リュ","リ"],リュ:["リョ","リ","ユ"],リョ:["リュ","リ","ヨ"],
    フィ:["ヒ","フ","ピ"],ファ:["ハ","フ"],フェ:["ヘ","フ"],フォ:["ホ","フ"],
    ヴァ:["バ","ワ"],ヴィ:["ビ","イ"],ヴェ:["ベ","エ"],ヴォ:["ボ","オ"],
    ー:["う","ウ","っ"],
  };
  return (m[k] || []).filter((d, i, arr) => d && d !== k && arr.indexOf(d) === i);
}
function buildPool(seq, distractorDelta = 0, opts = {}) {
  const correct = seq.map((kana, i) => ({ id: "c"+i+"_"+Math.random().toString(36).slice(2,5), kana, used: false }));
  // 手機需保留至少 52px 的觸控寬度：總字池最多 12 格（5×2 或 6×2）。
  // 長題保留所有正確假名，只縮減干擾字。
  const baseExtras = opts.noDistractors ? 0 : (seq.length <= 4 ? 3 : 4);
  const desiredExtras = Math.max(0, baseExtras + (distractorDelta || 0));
  if (desiredExtras === 0) return shuffle(correct);
  const extraN = Math.min(desiredExtras, Math.max(0, 12 - correct.length));
  const bag = new Set();
  seq.forEach((k) => nearDistractors(k).forEach((d) => bag.add(d)));
  ["あ","い","う","ん","き","し","つ","よ"].forEach((d) => bag.add(d));
  seq.forEach((k) => bag.delete(k));
  const extras = shuffle([...bag]).slice(0, extraN).map((kana, i) => ({ id: "d"+i+"_"+Math.random().toString(36).slice(2,5), kana, used: false }));
  return shuffle([...correct, ...extras]);
}

let battleOpts = { mode: "race", distractors: true, maxLen: 0, script: "all", category: "all" };
function isListenBattle() { return battleOpts.mode === "listen"; }
function isChineseRaceBattle() { return battleOpts.mode === "zh-race"; }
function battleModeLabel(mode) {
  if (mode === "listen") return "聽力搶答";
  if (mode === "zh-race") return "中翻日競速";
  return "羅馬字競速";
}
function battleModeIntroLabel(mode) {
  if (mode === "listen") return "LISTEN DUEL";
  if (mode === "zh-race") return "中翻日 DUEL";
  return "SPEED DUEL";
}
function readBattleOptsFromUi() {
  const dist = $("opt-distractors");
  const maxEl = $("opt-maxlen");
  const scriptEl = $("opt-script");
  const categoryEl = $("opt-category");
  const modeEl = $("opt-battle-mode");
  battleOpts = {
    mode: modeEl && ["listen", "zh-race"].includes(modeEl.value) ? modeEl.value : "race",
    distractors: dist ? !!dist.checked : true,
    maxLen: maxEl ? (Number(maxEl.value) || 0) : 0,
    script: scriptEl ? (scriptEl.value || "all") : "all",
    category: categoryEl ? (categoryEl.value || "all") : "all",
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
function selectBattleQuestions(options) {
  const eligible = options.mode === "zh-race"
    ? ALL_QUESTIONS.filter((q) => typeof q.zh === "string" && q.zh.trim())
    : ALL_QUESTIONS.slice();
  let list = eligible.slice();
  if (options.category !== "all") list = list.filter((q) => q.category === options.category);
  if (options.maxLen > 0) list = list.filter((q) => q.kanaSequence.length <= options.maxLen);
  if (options.script === "hira" || options.script === "kata") {
    list = list.filter((q) => scriptOfSeq(q.kanaSequence) === options.script);
  }
  if (list.length) return list;

  // 篩太嚴時保留類別，依序放寬假名與長度；只有「全部類別」才回全庫。
  list = options.category === "all"
    ? eligible.slice()
    : eligible.filter((q) => q.category === options.category);
  if (options.maxLen > 0) {
    const limited = list.filter((q) => q.kanaSequence.length <= options.maxLen);
    if (limited.length) list = limited;
  }
  return list;
}
function buildBattleDeck() {
  readBattleOptsFromUi();
  return shuffle(selectBattleQuestions(battleOpts));
}
