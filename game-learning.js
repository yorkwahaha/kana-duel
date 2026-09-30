/* global startPractice, applyAudioSettings */
// Local-only learning data. No room credentials, account or network sync.
window.KanaLearning = (() => {
  const KEY = "kana-learning-v1";
  const defaults = { bgm: 1, sfx: 1, voice: 1, speed: 1, hints: true };
  const knownIds = new Set((window.KANA_QUESTIONS || []).map((q) => q.id));
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && localDay(new Date(`${value}T12:00:00`)) === value;
  const shiftDay = (day, delta) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + delta);
    return localDay(date);
  };
  const count = (value, max = 100000) => Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
  function normalizeSettings(raw = {}) {
    const out = { ...defaults };
    for (const key of ["bgm", "sfx", "voice"]) {
      if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = Math.max(0, Math.min(1, raw[key]));
    }
    out.speed = raw.speed === 0.75 ? 0.75 : 1;
    out.hints = typeof raw.hints === "boolean" ? raw.hints : true;
    return out;
  }
  let raw = {};
  try {
    const text = window.localStorage.getItem(KEY);
    if (text && text.length < 150000) raw = JSON.parse(text) || {};
  } catch {}
  let data = { settings: normalizeSettings(raw.settings || {}), days: {}, wrong: {}, daily: [] };
  for (const day of Object.keys(raw.days || {}).filter(validDay).sort().slice(-90)) {
    const value = raw.days[day] || {};
    const attempts = count(value.attempts);
    const correct = Math.min(attempts, count(value.correct));
    data.days[day] = { attempts, correct, maxStreak: Math.min(correct, count(value.maxStreak)), totalMs: count(value.totalMs, 864000000) };
  }
  for (const id of Object.keys(raw.wrong || {}).filter((id) => knownIds.has(id))) {
    const value = raw.wrong[id];
    if (value && validDay(value.due)) data.wrong[id] = { due: value.due, level: count(value.level, 4) };
  }
  data.daily = Array.isArray(raw.daily) ? [...new Set(raw.daily.filter(validDay))].sort().slice(-90) : [];
  let streak = 0;
  let storageAvailable = true;
  function save() {
    for (const day of Object.keys(data.days).sort().slice(0, -90)) delete data.days[day];
    data.daily = data.daily.sort().slice(-90);
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); storageAvailable = true; }
    catch { storageAvailable = false; }
    refresh();
  }
  function recordAttempt(id, correct, ms = 0, day = localDay()) {
    if (!knownIds.has(id) || !validDay(day)) return;
    const stat = data.days[day] ||= { attempts: 0, correct: 0, maxStreak: 0, totalMs: 0 };
    stat.attempts += 1;
    if (correct) {
      stat.correct += 1;
      stat.totalMs += count(ms, 3600000);
      stat.maxStreak = Math.max(stat.maxStreak, ++streak);
      if (data.wrong[id]) {
        const value = data.wrong[id];
        value.due = shiftDay(day, [1, 3, 7, 14, 30][value.level]);
        value.level = Math.min(4, value.level + 1);
      }
    } else {
      streak = 0;
      data.wrong[id] = { due: day, level: 0 };
    }
    save();
  }
  function dueIds(day = localDay()) {
    return Object.keys(data.wrong).filter((id) => data.wrong[id].due <= day)
      .sort((a, b) => data.wrong[a].due.localeCompare(data.wrong[b].due) || a.localeCompare(b));
  }
  function dailyIds(day = localDay()) {
    const score = (id) => {
      let hash = 2166136261;
      for (const char of `${day}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    return [...knownIds].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, 10);
  }
  function completeDaily(day = localDay()) {
    if (!validDay(day) || data.daily.includes(day)) return;
    data.daily.push(day);
    save();
  }
  function summary(day = localDay()) {
    const first = shiftDay(day, -6);
    const stats = Object.entries(data.days).filter(([date]) => date >= first && date <= day).map(([, stat]) => stat);
    const total = (key) => stats.reduce((sum, stat) => sum + stat[key], 0);
    let dailyStreak = 0;
    let cursor = data.daily.includes(day) ? day : shiftDay(day, -1);
    while (data.daily.includes(cursor)) { dailyStreak += 1; cursor = shiftDay(cursor, -1); }
    return { attempts: total("attempts"), correct: total("correct"), maxStreak: Math.max(0, ...stats.map((stat) => stat.maxStreak)),
      averageMs: total("correct") ? total("totalMs") / total("correct") : null,
      dailyStreak, dailyComplete: data.daily.includes(day), wrongCount: Object.keys(data.wrong).length, due: dueIds(day).length };
  }
  function refresh() {
    const home = document.getElementById("learning-summary");
    if (!home) return;
    const stats = summary();
    const accuracy = stats.attempts ? `${Math.round(stats.correct / stats.attempts * 100)}%` : "—";
    home.textContent = stats.attempts ? `近 7 日 ${accuracy} · 待複習 ${stats.due} 詞` : "每天十詞，讓假名成為你的力量";
    const detail = document.getElementById("learning-stats");
    if (detail) {
      for (const [id, value] of Object.entries({ "learn-accuracy": accuracy, "learn-streak": `${stats.maxStreak} 題`,
        "learn-time": stats.averageMs == null ? "—" : (stats.averageMs / 1000).toFixed(1) + " 秒", "learn-daily": `${stats.dailyStreak} 天` })) {
        const el = document.getElementById(id); if (el) el.textContent = value;
      }
      const attempts = document.getElementById("learning-attempts");
      if (attempts) attempts.textContent = `近 7 日 ${stats.correct}/${stats.attempts} 次完整作答答對；略過計未答對，平均時間計至答對（含重試）。`;
    }
    const note = document.getElementById("learning-note");
    if (note) note.textContent = `${stats.wrongCount} 詞在錯題本；今天 ${stats.due} 詞到期。${stats.dailyComplete ? "今日十詞已完成。" : ""}${storageAvailable ? "紀錄只存在此瀏覽器。" : "瀏覽器無法保存，這次紀錄僅留在目前頁面。"}`;
    const review = document.getElementById("btn-learning-review");
    if (review) review.disabled = !stats.due;
    const list = document.getElementById("learning-wrong-list");
    if (list) {
      list.replaceChildren();
      const bank = window.KANA_QUESTIONS || [];
      for (const id of Object.keys(data.wrong).sort((a, b) => data.wrong[a].due.localeCompare(data.wrong[b].due))) {
        const q = bank.find((q) => q.id === id);
        const item = document.createElement("li");
        item.textContent = `${q.zh} · ${q.kanaSequence?.join("") || q.displayName || id} · ${data.wrong[id].due} 複習`;
        list.appendChild(item);
      }
    }
  }
  function init() {
    const get = (id) => document.getElementById(id);
    if (!get("learning-dialog")) return;
    get("btn-learning").addEventListener("click", () => { refresh(); get("learning-dialog").showModal(); });
    get("btn-settings").addEventListener("click", () => {
      for (const key of Object.keys(defaults)) {
        const control = get(`setting-${key}`);
        if (key === "hints") control.checked = data.settings[key];
        else control.value = String(data.settings[key]);
      }
      get("settings-dialog").showModal();
    });
    for (const kind of ["daily", "review", "zh"]) {
      get(`btn-learning-${kind}`).addEventListener("click", () => { get("learning-dialog").close(); startPractice({ kind }); });
    }
    get("settings-controls").addEventListener("change", () => {
      const next = {};
      for (const key of Object.keys(defaults)) next[key] = key === "hints" ? get(`setting-${key}`).checked : Number(get(`setting-${key}`).value);
      api.setSettings(next);
      applyAudioSettings();
      get("settings-note").textContent = storageAvailable ? "設定已儲存。羅馬字提示只適用羅馬字競速，不會揭露聽力或中翻日答案。" : "目前瀏覽器無法保存，設定僅在本頁生效。";
    });
    get("btn-learning-clear").addEventListener("click", () => {
      if (!window.confirm("清除本機學習紀錄與錯題本？音量設定會保留。")) return;
      data = { settings: data.settings, days: {}, wrong: {}, daily: [] };
      streak = 0; save();
    });
    let step = 0;
    const copy = [
      ["01 · 聽與讀", "單人聽音練習先聽單詞；中翻日先看中文。需要時按「再聽」，或在設定切換 0.75 倍速。"],
      ["02 · 拼出答案", "依序點選假名填入格子，再按確認。促音與長音各占一格；答錯可重試，也會進入錯題本。"],
      ["03 · 對戰出招", "答對累積蓄力與 COMBO；攻擊消耗蓄力，技能消耗 COMBO。大招槽滿即可施放，兩名玩家各自作答。"],
    ];
    const renderGuide = () => {
      get("guide-title").textContent = copy[step][0]; get("guide-copy").textContent = copy[step][1];
      get("guide-next").textContent = step === 2 ? "開始練習" : "下一步";
      get("guide-prev").disabled = step === 0;
    };
    get("btn-guide").addEventListener("click", () => { step = 0; renderGuide(); get("guide-dialog").showModal(); });
    get("guide-prev").addEventListener("click", () => { step = Math.max(0, step - 1); renderGuide(); });
    get("guide-next").addEventListener("click", () => {
      if (step === 2) { get("guide-dialog").close(); startPractice(); }
      else { step += 1; renderGuide(); }
    });
    refresh();
  }
  const api = { settings: () => ({ ...data.settings }), setSettings(value) { data.settings = normalizeSettings({ ...data.settings, ...value }); save(); },
    localDay, recordAttempt, dueIds, dailyIds, completeDaily, summary, beginSession() { streak = 0; }, refresh };
  window.addEventListener?.("DOMContentLoaded", init, { once: true });
  return api;
})();
