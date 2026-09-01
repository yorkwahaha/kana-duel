/* global $, charOf, prefersReducedMotion, wait */
// Battle presentation and visual-effect helpers.
function showCombo(text, tier) {
  const el = $("combo-float");
  if (!el) return;
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
  if (prefersReducedMotion()) return;
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
    after.replaceChildren();
    after.setAttribute("aria-hidden", "true");
  }
  document.querySelector(".duel-stage")?.classList.remove("fx-shake", "fx-shake-lg");
}

const SPECIAL_AFTERMATH_DURATION = Object.freeze({
  ao: 1320,
  gen: 1420,
  go: 1480,
  ran: 1380,
  rin: 1780,
  sho: 1720,
  ya: 1540,
  yo: 1600,
});

const ULTIMATE_PARTICLE_COUNTS = Object.freeze({
  ao: 20,
  gen: 28,
  go: 26,
  ran: 24,
  rin: 36,
  sho: 32,
  ya: 30,
  yo: 28,
});

function ultimateSvg(className, markup) {
  const shell = document.createElement("div");
  shell.className = className;
  shell.innerHTML = `<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${markup}</svg>`;
  return shell;
}

function addUltimateParticles(scene, themeId) {
  const count = ULTIMATE_PARTICLE_COUNTS[themeId] || 20;
  const field = document.createElement("div");
  field.className = "ultimate-impact__particles";
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("i");
    particle.className = `ultimate-particle ultimate-particle--${themeId}`;
    const angle = ((i * 137.5 + themeId.charCodeAt(0) * 11) % 360) * Math.PI / 180;
    const distance = 18 + ((i * 29) % 44);
    particle.style.setProperty("--x", `${43 + ((i * 31) % 18)}%`);
    particle.style.setProperty("--y", `${40 + ((i * 17) % 27)}%`);
    particle.style.setProperty("--dx", `${(Math.cos(angle) * distance).toFixed(1)}vmin`);
    particle.style.setProperty("--dy", `${(Math.sin(angle) * distance - (themeId === "rin" ? 18 : 0)).toFixed(1)}vmin`);
    particle.style.setProperty("--delay", `${70 + (i % 8) * 43}ms`);
    particle.style.setProperty("--scale", `${0.55 + (i % 5) * 0.19}`);
    particle.style.setProperty("--rot", `${(i * 47) % 180 - 90}deg`);
    field.appendChild(particle);
  }
  scene.appendChild(field);
}

function buildUltimateAttack(themeId) {
  if (themeId === "rin") return ultimateSvg("ultimate-impact__attack ultimate-fire-pillar", `
    <g class="fire-bed"><path d="M145 865C225 765 306 811 372 714C429 629 478 667 516 533C553 659 631 608 675 722C715 824 806 759 873 875C692 947 309 956 145 865Z"/></g>
    <g class="fire-tongue fire-tongue--a"><path d="M362 905C283 735 401 680 374 516C447 571 446 438 497 285C548 451 519 561 579 616C630 662 611 803 548 907Z"/></g>
    <g class="fire-tongue fire-tongue--b"><path d="M482 914C424 792 511 710 526 590C566 660 611 574 654 448C678 611 754 709 666 914Z"/></g>
    <g class="fire-wisp fire-wisp--a"><path d="M278 874C226 755 309 705 292 602C356 662 368 724 345 790C331 832 342 857 360 891Z"/></g>
    <g class="fire-wisp fire-wisp--b"><path d="M666 899C634 816 714 765 713 662C768 733 760 810 716 901Z"/></g>
    <g class="fire-core"><path d="M421 910C378 798 460 746 483 635C514 715 553 650 585 577C610 706 670 795 612 910Z"/></g>`);

  if (themeId === "ran") return ultimateSvg("ultimate-impact__attack ultimate-wind-cuts", `
    <path class="wind-cut wind-cut--a" d="M-80 724C225 294 564 184 1056 274C634 294 306 481 53 835"/>
    <path class="wind-edge wind-edge--a" d="M-64 722C246 322 580 222 1038 285"/>
    <path class="wind-cut wind-cut--b" d="M-25 926C249 563 604 434 1088 522C662 542 314 686 62 1008"/>
    <path class="wind-edge wind-edge--b" d="M-7 918C270 594 613 474 1060 536"/>
    <path class="wind-cut wind-cut--c" d="M1080 834C765 451 474 367 47 454C425 480 735 604 1010 918"/>`);

  if (themeId === "go") return ultimateSvg("ultimate-impact__attack ultimate-lightning", `
    <path class="lightning lightning--main" d="M648 -80L586 154L627 211L515 392L557 438L461 625L503 676L387 1062"/>
    <path class="lightning lightning--left" d="M526 380L421 463L448 517L302 606L365 638L229 794"/>
    <path class="lightning lightning--right" d="M475 619L648 572L619 689L795 731L682 782"/>
    <path class="electric-crawl electric-crawl--a" d="M169 677C257 614 334 672 409 593C472 525 538 572 622 514C704 457 782 488 890 418"/>
    <path class="electric-crawl electric-crawl--b" d="M247 395C337 445 395 377 469 429C548 485 616 417 752 471"/>`);

  if (themeId === "gen") return ultimateSvg("ultimate-impact__attack ultimate-ink-cut", `
    <path class="ink-wash" d="M-92 602C83 521 154 540 270 469C394 392 457 436 579 389C725 333 850 350 1094 252C892 431 770 472 636 509C490 549 372 531 225 612C111 675 5 689-92 602Z"/>
    <path class="ink-cut-core" d="M-70 618C223 554 435 488 1060 284"/>
    <path class="ink-drybrush" d="M-24 653C238 574 503 541 955 351"/>
    <path class="ink-tail" d="M91 686C302 611 428 613 655 527"/>`);

  if (themeId === "ao") return ultimateSvg("ultimate-impact__attack ultimate-vertical-cleave", `
    <path class="cleave-shadow" d="M554 -90C511 199 548 312 474 511C428 637 460 766 374 1084L570 754C618 672 568 561 634 411C682 298 649 140 688 -85Z"/>
    <path class="cleave-edge" d="M624 -76C580 220 604 318 526 523C474 661 516 762 431 1063"/>
    <path class="cleave-core" d="M636 -65C598 225 618 337 543 530C502 638 532 756 451 1049"/>
    <path class="cleave-splinter cleave-splinter--a" d="M497 533C382 489 298 436 173 352"/>
    <path class="cleave-splinter cleave-splinter--b" d="M548 540C694 494 778 443 922 337"/>`);

  if (themeId === "ya") return ultimateSvg("ultimate-impact__attack ultimate-ice-lances", `
    <path class="ice-lance ice-lance--a" d="M-126 188L454 516L408 565L-126 290L302 532L-126 252Z"/>
    <path class="ice-lance ice-lance--b" d="M1128 65L559 492L604 548L1128 176L682 517L1128 132Z"/>
    <path class="ice-lance ice-lance--c" d="M1094 730L593 572L568 632L1094 836L662 601L1094 786Z"/>
    <path class="ice-lance ice-lance--d" d="M-92 842L442 590L475 651L-92 946L385 625L-92 900Z"/>
    <path class="ice-crack" d="M507 448L467 526L501 549L455 626L527 588L550 654L588 575L548 540L589 472L523 508Z"/>`);

  if (themeId === "yo") return ultimateSvg("ultimate-impact__attack ultimate-leaf-storm", `
    <g class="leaf leaf--a" transform="translate(54 218) rotate(-24)"><path d="M0 0C91-34 154 8 176 83C91 104 28 72 0 0ZM18 10L145 69"/></g>
    <g class="leaf leaf--b" transform="translate(752 126) rotate(38)"><path d="M0 0C91-34 154 8 176 83C91 104 28 72 0 0ZM18 10L145 69"/></g>
    <g class="leaf leaf--c" transform="translate(78 690) rotate(18)"><path d="M0 0C91-34 154 8 176 83C91 104 28 72 0 0ZM18 10L145 69"/></g>
    <g class="leaf leaf--d" transform="translate(759 699) rotate(-49)"><path d="M0 0C91-34 154 8 176 83C91 104 28 72 0 0ZM18 10L145 69"/></g>
    <g class="leaf leaf--e" transform="translate(394 58) rotate(91)"><path d="M0 0C91-34 154 8 176 83C91 104 28 72 0 0ZM18 10L145 69"/></g>
    <path class="leaf-focus" d="M135 814C362 650 565 413 889 197"/>
    <path class="leaf-focus leaf-focus--dark" d="M101 763C395 625 596 431 914 247"/>`);

  return ultimateSvg("ultimate-impact__attack ultimate-ofuda-blasts", `
    <g class="ofuda ofuda--a"><path d="M222 112L323 91L348 278L244 299Z"/><path d="M273 132L291 254M247 176L318 161M255 220L326 204"/></g>
    <g class="ofuda ofuda--b"><path d="M668 127L776 151L733 337L629 310Z"/><path d="M708 169L679 292M662 205L745 224M652 250L735 268"/></g>
    <g class="ofuda ofuda--c"><path d="M132 504L240 480L276 664L168 691Z"/><path d="M183 521L211 649M158 569L247 548M168 615L257 594"/></g>
    <g class="ofuda ofuda--d"><path d="M735 499L843 478L874 661L765 683Z"/><path d="M789 518L812 641M759 564L849 547M769 610L859 591"/></g>
    <g transform="translate(330 390)"><g class="blast blast--a"><path d="M0-155C31-78 68-107 78-48C127-72 128-17 171 0C104 27 134 64 78 70C92 126 39 104 0 158C-20 89-60 116-73 65C-126 89-117 31-166 0C-103-19-131-62-70-72C-92-123-29-107 0-155Z"/></g></g>
    <g transform="translate(653 564)"><g class="blast blast--b"><path d="M0-155C31-78 68-107 78-48C127-72 128-17 171 0C104 27 134 64 78 70C92 126 39 104 0 158C-20 89-60 116-73 65C-126 89-117 31-166 0C-103-19-131-62-70-72C-92-123-29-107 0-155Z"/></g></g>
    <g transform="translate(514 684)"><g class="blast blast--c"><path d="M0-155C31-78 68-107 78-48C127-72 128-17 171 0C104 27 134 64 78 70C92 126 39 104 0 158C-20 89-60 116-73 65C-126 89-117 31-166 0C-103-19-131-62-70-72C-92-123-29-107 0-155Z"/></g></g>`);
}

function buildSpecialAftermath(themeId) {
  const scene = document.createElement("div");
  scene.className = `ultimate-impact ultimate-impact--${themeId}`;
  scene.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "ultimate-impact__backdrop";
  scene.appendChild(backdrop);

  const target = document.createElement("div");
  target.className = "ultimate-impact__target";
  scene.appendChild(target);

  scene.appendChild(buildUltimateAttack(themeId));
  addUltimateParticles(scene, themeId);

  const hitStop = document.createElement("div");
  hitStop.className = "ultimate-impact__hit-stop";
  scene.appendChild(hitStop);

  return scene;
}

async function playSpecialAftermath(themeId) {
  const el = $("special-aftermath");
  if (!el) return;
  const resolvedTheme = SPECIAL_AFTERMATH_DURATION[themeId] ? themeId : "ao";
  const duration = SPECIAL_AFTERMATH_DURATION[resolvedTheme];
  el.dataset.theme = resolvedTheme;
  el.style.setProperty("--ultimate-duration", `${duration}ms`);
  el.classList.remove("go");
  el.replaceChildren(buildSpecialAftermath(resolvedTheme));
  void el.offsetWidth;
  el.classList.add("go");
  el.setAttribute("aria-hidden", "false");
  if (prefersReducedMotion()) {
    await wait(180);
    el.classList.remove("go");
    el.replaceChildren();
    el.setAttribute("aria-hidden", "true");
    return;
  }
  shakeBattle(true);
  await wait(duration);
  el.classList.remove("go");
  el.replaceChildren();
  el.setAttribute("aria-hidden", "true");
}
