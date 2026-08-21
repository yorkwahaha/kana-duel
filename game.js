/* global $, ALL_QUESTIONS, AMP_HIT_BONUS, ATTACK_LOCK_MS, BLOCK_COMBO_COST */
/* global BLOCK_DAMAGE_MULT, BLOCK_DURATION_MS, CHARACTERS, COMBO_DAMAGE_PER_HIT */
/* global DRAG_THRESHOLD, GAUGE_HITS_TO_FULL, HEAL_AMOUNT, HEAL_COMBO_COST */
/* global MAX_ATTACK_SEGMENTS, MAX_HP, MISS_SELF_DMG_PER_WRONG, PRACTICE_ROUND_SIZE */
/* global SPECIAL_MULT, STEAL_CHARGE_MIN, STEAL_CHARGE_RATIO, SUBMIT_LOCK_MS */
/* global TYPE_LABEL, audioCtx, battleOpts, buildBattleDeck, buildPool, categoryLabelOf, clearBattleFx */
/* global diamonds, ensureAudioCtx, ensureBlockLayers, fxThemeOf, getSessionToken */
/* global isListenBattle, keepBattleBgmAlive, playAttackBolt, playBlockActivate */
/* global playCastBurst, playHitSfx, playSfx, playSpecialAftermath */
/* global preloadBattleSfx, prefersReducedMotion, questionPromptTitle, readBattleOptsFromUi, speakQuestionAudio */
/* global romajiSequence, setSfxDuck, setTtsStatus, shakeBattle, showCombo, shuffle */
/* global spawnBlockParry, spawnHitBurst, speakGoogleTts, startBattleBgm, stopBattleBgm */
/* global stopTts, stopVoice, voiceBufCache, wait */
/* global QUESTIONS:writable, voiceHtml:writable, voiceWebSrc:writable */
// Main interaction, practice, and battle state runtime.
function hasKanjiText(t) {
  return /[\u4e00-\u9fff\u3005\u3007\u303B]/.test(t || "");
}
function wordRevealCopy(q) {
  const reading = (q.kanaSequence || []).join("");
  // 優先漢字表記；沒有漢字時用 displayName；再附假名與中文詞義
  const kanji = (q.kanji && hasKanjiText(q.kanji)) ? q.kanji
    : (hasKanjiText(q.displayName) ? q.displayName : "");
  const title = kanji || q.displayName || reading;
  const subBits = [];
  if (reading && reading !== title) subBits.push(reading);
  if (q.zh) subBits.push(q.zh);
  return { title, sub: subBits.join(" · ") };
}
function showWordReveal(player, q) {
  if (!q) return;
  const host = document.body.classList.contains("online-battle")
    ? $("board1")
    : ($("duel-half-" + player) || $("board" + player));
  if (!host) return;
  host.querySelectorAll(".word-reveal").forEach((n) => n.remove());
  const copy = wordRevealCopy(q);
  const el = document.createElement("div");
  el.className = "word-reveal";
  el.innerHTML = "<strong></strong><span></span>";
  el.querySelector("strong").textContent = copy.title;
  el.querySelector("span").textContent = copy.sub;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function showScreen(name) {
  if (name !== "battle" && name !== "practice") {
    cancelAllDrags();
    clearBattleFx();
  }
  ["start","online","chars","practice","battle","result"].forEach((n) => {
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
function activateBoardSource(info, focusPlacedSlot) {
  const board = boards[info.boardId];
  if (!board || board.locked) return;
  if (info.from === "pool") {
    const idx = board.place(info.poolId);
    if (focusPlacedSlot && idx >= 0) {
      requestAnimationFrame(() => {
        $(board.slotsId)?.querySelector('[data-index="' + idx + '"]')?.focus();
      });
    }
    return;
  }
  if (info.from !== "slot") return;
  if (board.id === "practice" && board.slots[info.slotIndex] && !busy) {
    const mora = board.targetSeq?.[info.slotIndex] || board.slots[info.slotIndex].kana;
    if (mora) speakGoogleTts(mora);
  } else {
    board.clearSlot(info.slotIndex);
  }
}
function bindDragSource(el, info) {
  el.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    activateBoardSource(info, info.from === "pool");
  });
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
      }
    } else if (poolHit && cur.from === "slot" && board) {
      board.clearSlot(cur.slotIndex);
    } else if (cur.from === "pool" && board) {
      // 微移被當成拖曳但沒放到格子 → 仍當點選，支援快速連點
      board.place(cur.poolId);
    }
  } else if (board) {
    activateBoardSource(cur, false);
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
    slots: [], pool: [], promptRoma: null, locked: false, targetSeq: null,
    place(poolItemId, slotIndex) {
      if (this.locked) return -1;
      const item = this.pool.find((p) => p.id === poolItemId);
      if (!item || item.used) return -1;
      const idx = slotIndex != null ? slotIndex : this.slots.findIndex((v) => !v);
      if (idx < 0) return -1;
      if (this.slots[idx]) {
        const old = this.pool.find((p) => p.id === this.slots[idx].poolId);
        if (old) {
          old.used = false;
          const oldTile = $(this.poolId)?.querySelector('[data-pool-id="' + old.id + '"]');
          if (oldTile) {
            oldTile.classList.remove("used");
            oldTile.tabIndex = 0;
            oldTile.setAttribute("aria-disabled", "false");
          }
        }
      }
      item.used = true;
      this.slots[idx] = { kana: item.kana, poolId: item.id };
      playSfx("sfx_click", 0.3);
      this.setFeedback("");
      const tile = $(this.poolId)?.querySelector('[data-pool-id="' + item.id + '"]');
      if (tile) {
        tile.classList.add("used");
        tile.tabIndex = -1;
        tile.setAttribute("aria-disabled", "true");
        tile.setAttribute("aria-label", `假名 ${item.kana}，已選入第 ${idx + 1} 格`);
      }
      else this.render();
      if (tile) this.renderSlots();
      if (battleOpen) {
        const pid = Number(this.id);
        if (pid === 1 || pid === 2) updateSkillUi(pid);
      }
      return idx;
    },
    clearSlot(i) {
      if (this.locked) return;
      const val = this.slots[i]; if (!val) return;
      const item = this.pool.find((p) => p.id === val.poolId);
      if (item) item.used = false;
      this.slots[i] = null;
      playSfx("sfx_miss", 0.3);
      const tile = $(this.poolId)?.querySelector('[data-pool-id="' + val.poolId + '"]');
      if (tile) {
        tile.classList.remove("used");
        tile.tabIndex = 0;
        tile.setAttribute("aria-disabled", "false");
        tile.setAttribute("aria-label", `假名 ${item?.kana || val.kana}，填入下一個空格`);
      }
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
      this.targetSeq = (seq || []).slice();
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
      const practiceHints = this.id === "practice";
      this.slots.forEach((val, i) => {
        const slot = document.createElement("div");
        const roma = this.promptRoma?.[i];
        slot.className = "slot" + (val ? " filled" : "");
        slot.dataset.index = i;
        slot.setAttribute("aria-label", `第 ${i + 1} 格，${val ? "假名 " + val.kana : "空格"}`);
        if (practiceHints && val) slot.title = "點一下聽此格讀音；拖回字池可拿掉";
        slot.innerHTML = `<span class="idx">${i + 1}</span>`;
        if (roma) {
          const r = document.createElement("span");
          r.className = "roma";
          r.textContent = roma;
          slot.appendChild(r);
        }
        if (val) {
          slot.tabIndex = 0;
          slot.setAttribute("role", "button");
          const k = document.createElement("span");
          k.className = "kana"; k.textContent = val.kana;
          slot.appendChild(k);
          bindDragSource(slot, { from: "slot", slotIndex: i, kana: val.kana, poolId: val.poolId, boardId: this.id });
        }
        slotsEl.appendChild(slot);
      });
    },
    render() {
      const poolEl = $(this.poolId);
      if (!poolEl) return;
      this.renderSlots();
      poolEl.innerHTML = "";
      const poolLayout = this.pool.length <= 10 ? "five" : "six";
      poolEl.dataset.layout = poolLayout;
      poolEl.dataset.count = String(this.pool.length);
      this.pool.forEach((item) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "tile" + (item.used ? " used" : "");
        tile.dataset.poolId = item.id;
        tile.textContent = item.kana;
        tile.tabIndex = item.used ? -1 : 0;
        tile.setAttribute("aria-disabled", item.used ? "true" : "false");
        tile.setAttribute("aria-label", item.used ? `假名 ${item.kana}，已選取` : `假名 ${item.kana}，填入下一個空格`);
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
        if (v && v.kana === seq[i]) {
          nodes[i].classList.add("correct");
          nodes[i].setAttribute("aria-label", `第 ${i + 1} 格，${v.kana}，正確`);
        } else {
          nodes[i].classList.add("wrong");
          nodes[i].setAttribute("aria-label", `第 ${i + 1} 格，${v?.kana || "空格"}，錯誤`);
          wrong += 1;
        }
      });
      return wrong; // 0 = 全對
    },
    lockGold() {
      cancelDragsForBoard(this.id);
      this.locked = true;
      if (this.id === "1" || this.id === "2") $("board" + this.id)?.classList.add("locked");
      $(this.slotsId).querySelectorAll(".slot").forEach((n, i) => {
        setTimeout(() => {
          n.classList.remove("correct", "wrong");
          n.classList.add("locked-gold");
          const value = this.slots[i]?.kana || "";
          n.setAttribute("aria-label", `第 ${i + 1} 格，${value}，已確認正確`);
        }, i * 35);
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
let playerQi = { 1: 0, 2: 0 }; // race: independent progress into battleDeck
let sharedQi = 0; // listen: shared round index
let listenRoundClaimed = false; // listen: first fully-correct claim
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
let battleEpoch = 0;
let everMissed = []; // practice: whether the question was missed at least once
let rewardReturnFocus = null;

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
      const taken = foe?.id === c.id || (locked && mine?.id !== c.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "char-card " + charOffsetClass(visualOffset);
      btn.dataset.charId = c.id;
      btn.dataset.charIndex = String(i);
      if (taken) btn.classList.add("taken");
      btn.tabIndex = !locked && i === focus && !taken ? 0 : -1;
      btn.setAttribute("aria-current", i === focus ? "true" : "false");
      btn.setAttribute("aria-pressed", mine?.id === c.id ? "true" : "false");
      if (taken) btn.setAttribute("aria-disabled", "true");
      btn.innerHTML = `
        <span class="badge">${c.title}</span>
        <img src="${c.image}" alt="${c.name}" draggable="false" />
        <div class="meta"><strong>${c.name}</strong><span>${c.skill}</span><span class="passive">${c.passive?.label || ""}：${c.passive?.desc || ""}${c.active ? " · 主動「" + c.active.label + "」" : ""}</span></div>`;
      if (!locked && !taken) {
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
const SEGMENT_MIN_LEN = 6;
const SEGMENT_SIZE = 4;
let practiceSegIndex = 0;

function practiceSegments(q) {
  const seq = q?.kanaSequence || [];
  if (seq.length < SEGMENT_MIN_LEN) return [];
  const segs = [];
  for (let i = 0; i < seq.length; i += SEGMENT_SIZE) {
    segs.push({ from: i, to: Math.min(seq.length, i + SEGMENT_SIZE) });
  }
  return segs;
}
function updatePracticeListenUi(q) {
  const segBtn = $("btn-listen-seg");
  if (!segBtn) return;
  const segs = practiceSegments(q);
  if (!segs.length) {
    segBtn.classList.add("hidden");
    return;
  }
  segBtn.classList.remove("hidden");
  practiceSegIndex = ((practiceSegIndex % segs.length) + segs.length) % segs.length;
  const s = segs[practiceSegIndex];
  segBtn.textContent = `分段 ${practiceSegIndex + 1}/${segs.length}（${s.from + 1}–${s.to}）`;
}
function practiceSpeakSegment() {
  const q = currentQ();
  if (busy || !q) return;
  const segs = practiceSegments(q);
  if (!segs.length) {
    speakQuestionAudio(q);
    return;
  }
  const s = segs[practiceSegIndex];
  const text = q.kanaSequence.slice(s.from, s.to).join("");
  speakGoogleTts(text);
  practiceSegIndex = (practiceSegIndex + 1) % segs.length;
  updatePracticeListenUi(q);
}

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
  practiceSegIndex = 0;
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
  const n = q.kanaSequence.length;
  $("slots-hint").textContent = n >= SEGMENT_MIN_LEN
    ? `共 ${n} 格 · 點已填格聽單音 · 可分段重聽`
    : `共 ${n} 格 · 點已填格聽單音 · 拖回字池可拿掉`;
  $("q-diff").textContent = diamonds(q.kanaSequence.length);
  $("reward-tag").textContent = q.rewardMode === "cast_skill" ? "答對 · 喊招" : "答對 · 慶祝";
  $("reward-tag").className = "tag" + (q.rewardMode === "cast_skill" ? " cast" : "");
  $("avatar-img").src = q.image;
  updatePracticeListenUi(q);
  if (autoSpeak) await speakQuestionAudio(q);
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
  const stage = $("reward-stage");
  const focusWasInside = !!stage?.contains(document.activeElement);
  stage?.classList.remove("show");
  stage?.setAttribute("aria-hidden", "true");
  const vid = $("reward-video");
  try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {}
  $("reward-timer-bar").classList.remove("run");
  if (focusWasInside && rewardReturnFocus?.isConnected) rewardReturnFocus.focus();
  rewardReturnFocus = null;
}
function playCastVideo(q) {
  return new Promise((resolve) => {
    const vid = $("reward-video"), still = $("reward-still"), bar = $("reward-timer-bar");
    if (prefersReducedMotion()) {
      bar.classList.remove("run");
      try { vid.pause(); vid.removeAttribute("src"); } catch {}
      vid.classList.add("hidden");
      still.classList.remove("hidden");
      still.src = q.image;
      setTimeout(resolve, 600);
      return;
    }
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
  rewardReturnFocus = document.activeElement;
  $("btn-next").disabled = true;
  $("btn-replay").disabled = true;
  showCombo(q.rewardMode === "cast_skill" ? "詠唱完成" : "完璧！");
  await wait(250);
  const rewardStage = $("reward-stage");
  rewardStage.classList.add("show");
  rewardStage.setAttribute("aria-hidden", "false");
  rewardStage.querySelector(".reward-panel")?.focus();
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
    const reveal = wordRevealCopy(q);
    $("reward-title").textContent = reveal.title;
    $("cast-name").textContent = ""; $("cast-kana").textContent = "";
    $("reward-sub").textContent = reveal.sub || `記住了「${q.displayName}」`;
    $("btn-replay").style.display = "none";
    playSfx("win", 0.4);
    await Promise.all([playCastVideo(q), speakQuestionAudio(q)]);
  }
  busy = false;
  $("btn-next").disabled = false;
  $("btn-replay").disabled = false;
  $("btn-next").focus();
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
  qi++;
  loadPracticeQuestion(true);
  requestAnimationFrame(() => $("pool")?.querySelector('.tile:not([aria-disabled="true"])')?.focus());
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
  if (isListenBattle()) return battleDeck[sharedQi % battleDeck.length];
  return battleDeck[playerQi[player] % battleDeck.length];
}
function updateHpUi() {
  const hp1 = Math.max(0, hp[1]);
  const hp2 = Math.max(0, hp[2]);
  $("hp1-text").textContent = hp1;
  $("hp2-text").textContent = hp2;
  $("hp1-bar").style.width = (hp1 / MAX_HP * 100) + "%";
  $("hp2-bar").style.width = (hp2 / MAX_HP * 100) + "%";
  $("hp-meter-1")?.setAttribute("aria-valuenow", String(hp1));
  $("hp-meter-2")?.setAttribute("aria-valuenow", String(hp2));
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
  const gaugeWrap = $("gauge-wrap-" + player);
  gaugeWrap?.classList.toggle("ready", ready);
  gaugeWrap?.setAttribute("aria-valuenow", String(Math.min(GAUGE_HITS_TO_FULL, hits)));
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
  readBattleOptsFromUi();
  document.querySelectorAll('[data-vs="img1"]').forEach((el) => { el.src = pickP1.image; });
  document.querySelectorAll('[data-vs="img2"]').forEach((el) => { el.src = pickP2.image; });
  document.querySelectorAll('[data-vs="name1"]').forEach((el) => {
    el.textContent = pickP1.name + " · " + (pickP1.passive?.label || pickP1.skill || pickP1.title);
  });
  document.querySelectorAll('[data-vs="name2"]').forEach((el) => {
    el.textContent = pickP2.name + " · " + (pickP2.passive?.label || pickP2.skill || pickP2.title);
  });
  document.querySelectorAll('[data-vs="rule"]').forEach((el) => {
    el.textContent = isListenBattle() ? "LISTEN DUEL" : "SPEED DUEL";
  });
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
  }, prefersReducedMotion() ? 600 : 4000);
}

function startBattle() {
  battleEpoch += 1;
  gameMode = "battle";
  cancelAllDrags();
  clearBattleFx();
  setSfxDuck(1);
  stopVoice();
  stopTts();
  hp = { 1: MAX_HP, 2: MAX_HP };
  battleDeck = buildBattleDeck();
  const listen = isListenBattle();
  const rule = $("rule-chip");
  if (rule) {
    const bits = [listen ? "聽力搶答" : "競速對決"];
    if (!battleOpts.distractors) bits.push("無干擾");
    if (battleOpts.maxLen > 0) bits.push("≤" + battleOpts.maxLen + "字");
    if (battleOpts.script === "hira") bits.push("平假名");
    if (battleOpts.script === "kata") bits.push("片假名");
    if (battleOpts.category !== "all") bits.push(categoryLabelOf(battleOpts.category));
    rule.textContent = bits.join(" · ");
  }
  playerQi = { 1: 0, 2: 0 };
  sharedQi = 0;
  listenRoundClaimed = false;
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
  const stage = document.querySelector(".duel-stage");
  stage?.classList.remove("ko-hold");
  stage?.classList.toggle("listen-mode", listen);
  $("btn-battle-listen")?.classList.toggle("hidden", !listen);
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
  if (listen) loadSharedListenRound(true);
  else {
    loadPlayerQuestion(1);
    loadPlayerQuestion(2);
  }
  battleStartedAt = performance.now();
  cancelAnimationFrame(timerRaf);
  tickBattleClock();
  startBattleBgm().catch(() => {});
}

async function playVoice(url, volume = 0.88) {
  if (!url) return false;
  stopVoice();
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
        await new Promise((resolve) => {
          let settled = false;
          const done = () => { if (!settled) { settled = true; resolve(); } };
          src.onended = () => { if (voiceWebSrc === src) voiceWebSrc = null; done(); };
          src.start(0);
          setTimeout(done, Math.ceil(buf.duration * 1000) + 120);
        });
        return true;
      }
    }
  } catch {}
  try {
    const a = new Audio(url);
    voiceHtml = a;
    a.volume = Math.min(1, volume);
    return await new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      a.onended = () => { if (voiceHtml === a) voiceHtml = null; done(true); };
      a.onerror = () => done(false);
      a.play().then(() => {}).catch(() => done(false));
      setTimeout(() => done(false), 4500);
    });
  } catch {
    return false;
  }
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

function setResultScreen(title, summary, withBattleStats, customRows = "") {
  document.querySelectorAll(".result-title").forEach((el) => { el.innerHTML = colorizePlayerTags(title); });
  document.querySelectorAll(".result-summary").forEach((el) => { el.innerHTML = colorizePlayerTags(summary || "—"); });
  const rows = customRows || (withBattleStats ? buildBattleStatsRows() : "");
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
async function playBattleDefeatOutro(loser, winner) {
  battleOpen = false;
  battleEpoch += 1;
  cancelAnimationFrame(timerRaf);
  cancelAllDrags();
  stopTts();
  // 壓低連打音效，避免蓋過敗北慘叫
  setSfxDuck(0.04);
  stopVoice();
  const stage = document.querySelector(".duel-stage");
  const loserEl = $("fighter" + loser);
  const winnerEl = $("fighter" + winner);
  const loserCh = charOf(loser);
  stage?.classList.add("ko-hold");
  stage?.classList.remove("listen-mode");
  $("btn-battle-listen")?.classList.add("hidden");
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
  await wait(prefersReducedMotion() ? 140 : 420);
  await playVoice(loserCh && loserCh.voiceDefeat, 1);
  // 黑白敗北餘韻再多留一秒再進結算
  await wait(prefersReducedMotion() ? 520 : 1900);
  setSfxDuck(1);
  clearBattleFx();
  stage?.classList.remove("ko-hold");
}

async function finishBattleDefeat(loser, winner, title, summary) {
  await playBattleDefeatOutro(loser, winner);
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
async function playSpecialUltimate(player) {
  cancelAllDrags();
  const ch = charOf(player);
  const stage = $("special-stage");
  const vid = $("special-video");
  const still = $("special-still");
  if (!ch || !stage) return false;

  stage.dataset.theme = ch.id;
  $("special-name").textContent = ch.name;
  $("special-skill").textContent = ch.skill || "";
  stage.classList.remove("portrait-cast", "foe-upright");
  // 同機對坐時 P1 的演出轉向對手；線上模式每台裝置都保持正向。
  stage.classList.toggle("foe-upright", !document.body.classList.contains("online-battle") && player === 1);
  stage.classList.add("show");
  stage.setAttribute("aria-hidden", "false");
  keepBattleBgmAlive();

  if (prefersReducedMotion()) {
    still.src = ch.imageAtk || ch.image;
    stage.classList.add("portrait-cast");
    await wait(700);
    hideSpecialStage();
    return true;
  }

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
  return true;
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
    showRomaji: !isListenBattle(),
    noDistractors,
    distractorDelta: noDistractors ? 0 : (ch?.passive?.distractorDelta || 0),
  });
  noteQuestionOpen(player);
  updatePlayerMeters(player);
}

/** 聽力搶答：雙方同題、無羅馬音、播一次 TTS */
function loadSharedListenRound(autoSpeak) {
  listenRoundClaimed = false;
  loadPlayerQuestion(1);
  loadPlayerQuestion(2);
  const q = playerQ(1);
  if (autoSpeak && q) speakQuestionAudio(q);
}

function lockBoardForListen(player, asWinner) {
  const b = boards[player];
  if (!b) return;
  cancelDragsForBoard(String(player));
  b.locked = true;
  $("board" + player)?.classList.add("locked");
  if (asWinner) b.lockGold();
}

async function resolveListenRoundWin(player) {
  const roundEpoch = battleEpoch;
  const foe = player === 1 ? 2 : 1;
  const q = playerQ(player);
  lockBoardForListen(foe, false);
  boards[foe]?.setFeedback("搶答落敗 · 捱打", "bad");
  if (q) {
    showWordReveal(player, q);
    showWordReveal(foe, q);
  }
  await wait(350);
  if (!battleOpen || roundEpoch !== battleEpoch) return;

  combo[foe] = 0;
  updatePlayerMeters(foe);

  if (charge[player] > 0 && !isAttackLocked(player)) {
    const { dmg, hits, special: isSpecial } = projectedAttackDamage(player);
    const segments = Math.min(hits, MAX_ATTACK_SEGMENTS);
    ampHits[player] = 0;
    charge[player] = 0;
    if (isSpecial) {
      gaugeHits[player] = 0;
      noteSpecialFired(player);
    }
    updatePlayerMeters(player);
    await applyAttack(player, dmg, isSpecial, segments, hits);
  } else if (isAttackLocked(player)) {
    boards[player]?.setFeedback("攻擊被凍結 · 本輪落空", "bad");
    charge[player] = 0;
    combo[player] = 0;
    updatePlayerMeters(player);
    await wait(700);
  }

  if (!battleOpen || roundEpoch !== battleEpoch) return;
  sharedQi += 1;
  loadSharedListenRound(true);
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
  const queuedEpoch = battleEpoch;
  attackQueue = attackQueue.then(function () {
    if (!battleOpen || queuedEpoch !== battleEpoch) return false;
    return fn();
  }).catch(function (error) {
    console.error("Battle action failed", error);
    return false;
  });
  return attackQueue;
}

async function applyAttack(player, dmg, isSpecial, hitCount, comboCount) {
  const actionEpoch = battleEpoch;
  if (!battleOpen) return false;
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
    if (!battleOpen || actionEpoch !== battleEpoch) return false;
    await playSpecialAftermath(atkTheme.id);
    if (!battleOpen || actionEpoch !== battleEpoch) return false;
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
    if (!battleOpen || actionEpoch !== battleEpoch) return false;
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
    if (!battleOpen || actionEpoch !== battleEpoch || hp[foe] <= 0) break;
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
    if (!battleOpen || actionEpoch !== battleEpoch) return false;
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
  const missEpoch = battleEpoch;
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
      if (battleOpen && missEpoch === battleEpoch && hp[player] > 0) {
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

  if (isListenBattle()) {
    if (listenRoundClaimed) {
      b.setFeedback("本輪已被搶走", "bad");
      return;
    }
    listenRoundClaimed = true;
    combo[player] += 1;
    gaugeHits[player] += gaugeGainOf(player);
    const gain = calcChargeGain(player, q);
    charge[player] += gain;
    noteCorrectAnswer(player);
    lockBoardForListen(player, true);
    b.setFeedback("搶答成功 · +" + gain, "ok");
    updatePlayerMeters(player);
    playSfx("skillpop", 0.5);
    showCombo("搶答！", "md");
    enqueueAttack(async function () {
      await resolveListenRoundWin(player);
    });
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

  // 競速：不等對方，立刻進自己的下一題
  playerQi[player] += 1;
  const questionEpoch = battleEpoch;
  setTimeout(function () {
    if (!battleOpen || questionEpoch !== battleEpoch) return;
    loadPlayerQuestion(player);
  }, 900);
}

function battleFireAttack(player) {
  if (!battleOpen) return;
  if (isListenBattle()) {
    boards[player]?.setFeedback("聽力搶答由系統自動攻擊", "bad");
    return;
  }
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
  if (isListenBattle()) {
    boards[player]?.setFeedback("聽力搶答不可跳過", "bad");
    return;
  }
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
$("reward-stage")?.addEventListener("keydown", (e) => {
  const stage = $("reward-stage");
  if (e.key !== "Tab" || !stage?.classList.contains("show")) return;
  const focusable = Array.from(stage.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.hidden && el.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) {
    e.preventDefault();
    stage.querySelector(".reward-panel")?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
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
  if (window.KanaBattleOnline?.isActive()) {
    window.KanaBattleOnline.leaveBattle();
    return;
  }
  stopTts(); stopBattleBgm(); hideSpecialStage(); cancelAllDrags(); clearBattleFx();
  battleOpen = false; battleEpoch += 1; cancelAnimationFrame(timerRaf);
  clearSkillTimers(1); clearSkillTimers(2);
  document.querySelector(".duel-stage")?.classList.remove("listen-mode");
  $("btn-battle-listen")?.classList.add("hidden");
  showScreen("start");
});
bindTap($("btn-battle-listen"), () => {
  if (window.KanaBattleOnline?.isActive()) {
    window.KanaBattleOnline.replayQuestion();
    return;
  }
  if (!battleOpen || !isListenBattle() || listenRoundClaimed) return;
  const q = playerQ(1);
  if (q) speakQuestionAudio(q);
});
document.querySelectorAll(".btn-again-home").forEach((btn) => {
  bindTap(btn, () => {
    if (window.KanaBattleOnline?.isActive()) {
      window.KanaBattleOnline.returnToLobby();
      return;
    }
    cancelAllDrags();
    stopBattleBgm();
    stopTts();
    hideSpecialStage();
    clearBattleFx();
    battleOpen = false;
    battleEpoch += 1;
    cancelAnimationFrame(timerRaf);
    clearSkillTimers(1);
    clearSkillTimers(2);
    document.querySelector(".duel-stage")?.classList.remove("listen-mode");
    $("btn-battle-listen")?.classList.add("hidden");
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
    if (window.KanaBattleOnline?.isActive()) {
      window.KanaBattleOnline.readyRematch();
      return;
    }
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

bindTap($("portrait"), () => { if (!busy && currentQ()) speakQuestionAudio(currentQ()); });
bindTap($("btn-listen"), () => { if (!busy && currentQ()) speakQuestionAudio(currentQ()); });
bindTap($("btn-listen-seg"), () => practiceSpeakSegment());
bindTap($("btn-clear"), () => boards.practice.clearAll());
bindTap($("btn-submit"), () => practiceSubmit());
bindTap($("btn-next"), () => practiceNext());
bindTap($("btn-replay"), () => { if (!busy) playReward(currentQ()); });
document.querySelectorAll("[data-act]").forEach((btn) => {
  bindTap(btn, () => {
    if (btn.disabled) return;
    const p = Number(btn.dataset.p), act = btn.dataset.act;
    if (window.KanaBattleOnline?.isActive()) {
      window.KanaBattleOnline.handleAction(p, act);
      return;
    }
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
