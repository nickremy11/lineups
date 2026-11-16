// Pointer-event drag & drop (mouse + touch long-press) for ".tile[data-pid]" elements.
// onDrop(src, target, event): src = {pid, from (data-slot of the tile, "" if none), tile}, target = element matching dropSelector.
// Caller re-renders afterwards.
export function initDnd({ dropSelector, onDrop }) {
  let drag = null;

  document.body.addEventListener("pointerdown", (e) => {
    const tile = e.target.closest(".tile[data-pid]");
    if (!tile || tile.classList.contains("ghost") || e.target.closest("[data-action]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = { tile, pid: tile.dataset.pid, from: tile.dataset.slot || "", x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== "mouse", timer: null, ghost: null, over: null };
    if (drag.touch) drag.timer = setTimeout(() => begin(e.clientX, e.clientY), 220);
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.active) {
      if (drag.touch) { if (moved > 8) cancel(); return; } // let the page scroll
      if (moved < 4) return;
      begin(e.clientX, e.clientY);
    }
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(dropSelector);
    if (t !== drag.over) { drag.over?.classList.remove("over"); t?.classList.add("over"); drag.over = t; }
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    if (!d.active) return;
    d.ghost.remove();
    d.over?.classList.remove("over");
    d.tile.classList.remove("dragging");
    if (d.over) onDrop({ pid: d.pid, from: d.from, tile: d.tile }, d.over, e);
  });
  window.addEventListener("pointercancel", () => cancel());
  document.addEventListener("touchmove", (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });
  document.addEventListener("selectstart", (e) => { if (drag) e.preventDefault(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });

  function begin(x, y) {
    if (!drag || drag.active) return;
    drag.active = true;
    const r = drag.tile.getBoundingClientRect();
    drag.dx = x - r.left; drag.dy = y - r.top;
    const g = drag.tile.cloneNode(true);
    g.classList.add("ghost");
    g.style.width = `${r.width}px`;
    g.style.left = `${r.left}px`; g.style.top = `${r.top}px`;
    document.body.appendChild(g);
    drag.ghost = g;
    drag.tile.classList.add("dragging");
    if (navigator.vibrate) navigator.vibrate(8);
  }
  function cancel() {
    if (!drag) return;
    clearTimeout(drag.timer);
    drag.ghost?.remove();
    drag.tile.classList.remove("dragging");
    drag.over?.classList.remove("over");
    drag = null;
  }
  return { cancel };
}
