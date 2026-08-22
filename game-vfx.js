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
  if (prefersReducedMotion()) {
    await wait(120);
    el.classList.remove("go");
    el.setAttribute("aria-hidden", "true");
    return;
  }
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
