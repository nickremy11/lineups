// Helpers shared by every sport page.
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/** Team dropdown. teams: [{abbrev, name, logo, group}] */
export function initTeamPicker({ teams, getCurrent, onPick }) {
  const render = (filter = "") => {
    const f = filter.trim().toLowerCase();
    const groups = {};
    for (const t of teams) {
      if (f && !t.name.toLowerCase().includes(f) && !t.abbrev.toLowerCase().includes(f)) continue;
      (groups[t.group] ??= []).push(t);
    }
    $("#teamList").innerHTML = Object.keys(groups).sort().map((g) => `<h4>${esc(g)}</h4><div class="team-grid">${groups[g].map((t) =>
      `<button data-team="${t.abbrev}" class="${t.abbrev === getCurrent() ? "on" : ""}"><img src="${esc(t.logo)}" alt="" loading="lazy">${esc(t.name)}</button>`).join("")}</div>`).join("");
  };
  $("#teamBtn").addEventListener("click", () => {
    const pop = $("#teamPop");
    pop.hidden = !pop.hidden;
    if (!pop.hidden) $("#teamSearch").focus();
  });
  $("#teamSearch").addEventListener("input", (e) => render(e.target.value));
  $("#teamList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-team]");
    if (!b) return;
    $("#teamPop").hidden = true;
    onPick(b.dataset.team);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#teamPop, #teamBtn")) $("#teamPop").hidden = true;
  });
  render();
  return { render: () => render($("#teamSearch").value) };
}

/** "Add player" modal: search tab + custom form. Returns {close}. */
export function initAddModal({ searchUrl, playerUrl, onAdd, onCustom }) {
  const modal = $("#modal");
  const close = () => (modal.hidden = true);
  $("#addBtn").addEventListener("click", () => { modal.hidden = false; $("#playerSearch").focus(); });
  $("#modalClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    modal.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
    $("#tabSearch").hidden = t.dataset.tab !== "search";
    $("#tabCustom").hidden = t.dataset.tab !== "custom";
  }));
  let timer;
  $("#playerSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $("#searchResults").innerHTML = ""; return; }
    timer = setTimeout(async () => {
      try {
        const rs = await (await fetch(`${searchUrl}?q=${encodeURIComponent(q)}`)).json();
        $("#searchResults").innerHTML = rs.length
          ? rs.map((r) => `<button data-id="${esc(r.id)}"><span>${esc(r.name)} <small>${esc(r.pos)}${r.number != null && r.number !== "" ? " #" + esc(r.number) : ""}</small></span><small>${esc(r.team || "—")}</small></button>`).join("")
          : `<small>No active players found.</small>`;
      } catch { $("#searchResults").innerHTML = `<small>Search failed.</small>`; }
    }, 250);
  });
  $("#searchResults").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    b.disabled = true;
    try {
      const res = await fetch(`${playerUrl}/${b.dataset.id}`);
      if (!res.ok) throw new Error("not found");
      onAdd(await res.json());
    } catch { toast("Couldn't load that player."); b.disabled = false; }
  });
  $("#tabCustom").addEventListener("submit", (e) => {
    e.preventDefault();
    onCustom(Object.fromEntries(new FormData(e.target)));
    e.target.reset();
  });
  return { close };
}

/**
 * Screenshot button: copy the lineup board as a PNG to the clipboard, or download it.
 * getTarget(): element to capture; getTitle(): { title, sub }; filename(): base file name;
 * exclude: optional CSS selector for parts of the board to leave out of the image (e.g. special teams).
 */
export function initScreenshot({ getTarget, getTitle, filename, exclude }) {
  const btn = $("#shotBtn");
  if (!btn) return;
  const menu = document.createElement("div");
  menu.className = "shot-menu";
  menu.hidden = true;
  menu.innerHTML = `<button data-act="copy">Copy image to clipboard</button><button data-act="save">Download PNG</button>`;
  document.body.appendChild(menu);

  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 230))}px`;
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); place(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.hidden = true; });

  async function capture() {
    const el = getTarget();
    if (!el) throw new Error("Nothing to capture yet");
    const { domToBlob } = await import("/shared/vendor/modern-screenshot.mjs");
    // route cross-origin images through our same-origin proxy so the canvas isn't tainted
    const swapped = [];
    for (const img of el.querySelectorAll("img")) {
      if (!/^https?:/.test(img.src) || new URL(img.src).origin === location.origin) continue;
      swapped.push([img, img.getAttribute("src")]);
      img.loading = "eager";
      img.src = `/api/img?u=${encodeURIComponent(img.src)}`;
    }
    await Promise.all(swapped.map(([img]) => img.decode().catch(() => {})));
    // title strip on top of the captured area
    const { title, sub } = getTitle();
    const cap = document.createElement("div");
    cap.className = "shot-cap";
    cap.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span><i>lineups.bruisedbanana.dev</i>`;
    el.prepend(cap);
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
      return await domToBlob(el, {
        scale: 1.5, backgroundColor: bg, type: "image/png", font: false,
        filter: exclude ? (node) => !(node.nodeType === 1 && node.matches(exclude)) : undefined,
      });
    } finally {
      cap.remove();
      for (const [img, src] of swapped) img.setAttribute("src", src);
    }
  }

  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    menu.hidden = true;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Capturing…";
    try {
      const blobPromise = capture();
      const download = async () => {
        const blob = await blobPromise;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${filename()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };
      if (act === "copy") {
        try {
          // pass the promise so Safari keeps the user gesture; Chrome/Firefox accept it too
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
          toast("Lineup image copied to clipboard.");
        } catch {
          await download();
          toast("Couldn't write to the clipboard here — downloaded the image instead.");
        }
      } else {
        await download();
        toast("Image downloaded.");
      }
    } catch (err) {
      toast(`Couldn't capture the lineup (${err.message || err}).`);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
}
