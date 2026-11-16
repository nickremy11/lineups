// NHL depth chart editor. No build step; talks to /api/nhl/*.
import { $, esc, clone, store, toast, initTeamPicker, initAddModal, initScreenshot } from "/shared/ui.js";
import { initDnd } from "/shared/dnd.js";

const state = {
  teams: [], abbrev: null, payload: null,
  players: new Map(), // id -> player (includes added)
  def: null,          // default lineup
  cur: null,          // current (edited) lineup
  added: [],          // players added by the user
};

// ---------- slots ----------
const FW = ["LW", "C", "RW"], DP = ["LD", "RD"];
const parse = (id) => id.split(".");
const isST = (id) => id.startsWith("pp.") || id.startsWith("pk.");
function getSlot(L, id) {
  const [k, i, j] = parse(id);
  return k === "g" ? L.g[+i] : L[k][+i][+j];
}
function setSlot(L, id, v) {
  const [k, i, j] = parse(id);
  if (k === "g") L.g[+i] = v; else L[k][+i][+j] = v;
}
function required(id) {
  const [k, , j] = parse(id);
  return k === "f" ? FW[+j] : k === "d" ? DP[+j] : k === "g" ? "G" : null;
}
function allSlotIds(L) {
  const ids = [];
  L.f.forEach((r, i) => r.forEach((_, j) => ids.push(`f.${i}.${j}`)));
  L.d.forEach((r, i) => r.forEach((_, j) => ids.push(`d.${i}.${j}`)));
  L.g.forEach((_, i) => ids.push(`g.${i}`));
  L.pp.forEach((r, i) => r.forEach((_, j) => ids.push(`pp.${i}.${j}`)));
  L.pk.forEach((r, i) => r.forEach((_, j) => ids.push(`pk.${i}.${j}`)));
  return ids;
}
const evIds = (L) => allSlotIds(L).filter((id) => !isST(id));

// ---------- formatting ----------
const fmtToi = (s) => (s == null ? "–" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const fmtPm = (n) => (n == null ? "–" : n > 0 ? `+${n}` : String(n));
const fmtSv = (n) => (n == null ? "–" : n.toFixed(3).replace(/^0/, ""));
const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
const isOut = (p) => p.injury && !["gtd", "dtd"].includes(p.injury.status.toLowerCase());

function statsHtml(p) {
  if (p.goalie) {
    const g = p.goalie;
    return `<div class="stats"><span>GP <b>${g.gp}</b></span><span>W <b>${g.w}</b></span><span>GAA <b>${g.gaa == null ? "–" : g.gaa.toFixed(2)}</b></span><span>SV% <b>${fmtSv(g.svp)}</b></span></div>`;
  }
  if (p.skater) {
    const s = p.skater;
    return `<div class="stats"><span>TOI <b>${fmtToi(s.toi)}</b></span><span>G <b>${s.g}</b></span><span>A <b>${s.a}</b></span><span>+/- <b>${fmtPm(s.pm)}</b></span></div>`;
  }
  return `<div class="stats"><span>No stats</span></div>`;
}

function tileHtml(p, slotId) {
  const req = slotId ? required(slotId) : null;
  const off = req && p.pos !== req && !p.alt.includes(req);
  const changed = slotId && getSlot(state.def, slotId) !== p.id;
  const inj = p.injury
    ? `<span class="chip ${isOut(p) ? "inj" : "gtd"}" title="${esc(p.injury.note || "")}">${esc(p.injury.status.toUpperCase())}</span>` : "";
  const face = p.headshot ? `<img src="${esc(p.headshot)}" alt="" draggable="false" loading="lazy">` : esc(initials(p.name));
  return `<div class="tile${off ? " off" : ""}${changed ? " changed" : ""}" data-pid="${esc(p.id)}" data-slot="${slotId || ""}" ${off ? `title="Playing out of position (${esc(req)})"` : ""}>
    <div class="face">${face}</div>
    <div class="body">
      <div class="name"><span class="num">${p.number != null ? p.number : ""}</span><span>${esc(p.name)}</span></div>
      <div class="meta"><span class="chip">${p.pos}</span>${p.alt.map((a) => `<span class="chip alt">${a}</span>`).join("")}${p.shoots ? `<span class="chip hand" title="${p.pos === "G" ? "Catches" : "Shoots"} ${p.shoots === "L" ? "left" : "right"}">${p.shoots}</span>` : ""}${inj}${p.added ? `<span class="chip new">NEW</span>` : ""}</div>
      ${statsHtml(p)}
    </div>
    ${p.added && !slotId ? `<button class="x" data-action="remove" title="Remove player">✕</button>` : ""}
  </div>`;
}

function slotHtml(id, label) {
  const pid = getSlot(state.cur, id);
  const p = pid && state.players.get(pid);
  return `<div class="slot" data-slot="${id}">${label ? `<span class="slot-tag">${label}</span>` : ""}${p ? tileHtml(p, id) : `<span class="ph">${label || "EMPTY"}</span>`}</div>`;
}

// ---------- render ----------
function render() {
  const L = state.cur;
  const src = state.payload.source;
  const upd = src.updatedAt ? ` · updated ${new Date(src.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  let h = `<div class="source">Default lines: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>${upd} · positions from PuckPedia · stats from NHL.com</div>`;

  h += `<div class="sec"><h3>Forwards</h3>`;
  L.f.forEach((_, i) => {
    h += `<div class="row" style="--cols:3"><div class="lbl">L${i + 1}</div>${FW.map((lab, j) => slotHtml(`f.${i}.${j}`, lab)).join("")}</div>`;
  });
  h += `</div><div class="sec"><h3>Defense</h3>`;
  L.d.forEach((_, i) => {
    h += `<div class="row d" style="--cols:2"><div class="lbl">D${i + 1}</div>${DP.map((lab, j) => slotHtml(`d.${i}.${j}`, lab)).join("")}</div>`;
  });
  h += `</div><div class="sec"><h3>Goalies</h3><div class="row" style="--cols:2"><div class="lbl"></div>${L.g.map((_, i) => slotHtml(`g.${i}`, i ? "BACKUP" : "STARTER")).join("")}</div></div>`;

  const units = (key, title) => L[key].map((u, i) => `<div><div class="unit-title">${title} ${i + 1}</div><div class="unit">${u.map((_, j) => slotHtml(`${key}.${i}.${j}`, "")).join("")}</div></div>`).join("");
  h += `<div class="sec compact"><h3>Special teams <span style="text-transform:none;letter-spacing:0">drop a player here to add them to a unit; drag out to remove</span></h3><div class="units">${units("pp", "Power play")}${units("pk", "Penalty kill")}</div></div>`;
  $("#board").innerHTML = h;
  renderBench();
  const n = countChanges();
  $("#changes").textContent = n ? `${n} change${n > 1 ? "s" : ""}` : "";
  $("#resetBtn").disabled = !n && !state.added.length;
}

function renderBench() {
  const used = new Set(evIds(state.cur).map((id) => getSlot(state.cur, id)).filter(Boolean));
  const bench = [...state.players.values()].filter((p) => !used.has(p.id));
  const fam = (p) => (p.pos === "G" ? "G" : p.pos === "LD" || p.pos === "RD" ? "D" : "F");
  const sortKey = (p) => (p.skater?.toi ?? (p.goalie?.gp ?? 0) * 60);
  const sorted = (arr) => arr.sort((a, b) => sortKey(b) - sortKey(a));
  const out = bench.filter(isOut), healthy = bench.filter((p) => !isOut(p));
  const grp = (title, arr) => arr.length ? `<h5>${title} (${arr.length})</h5>${sorted(arr).map((p) => tileHtml(p, "")).join("")}` : "";
  $("#bench").innerHTML = `<h3>Bench &amp; injured</h3>
    ${grp("Forwards", healthy.filter((p) => fam(p) === "F"))}
    ${grp("Defense", healthy.filter((p) => fam(p) === "D"))}
    ${grp("Goalies", healthy.filter((p) => fam(p) === "G"))}
    ${grp("Injured", out)}
    ${bench.length ? "" : `<div class="empty">Everyone is in the lineup.</div>`}`;
}

function countChanges() {
  return evIds(state.cur).filter((id) => getSlot(state.cur, id) !== getSlot(state.def, id)).length +
    allSlotIds(state.cur).filter((id) => isST(id) && getSlot(state.cur, id) !== getSlot(state.def, id)).length;
}

// ---------- moves ----------
function applyMove(from, to, pid) {
  const L = state.cur;
  if (from === to) return;
  const fromST = from && isST(from), toST = to && isST(to);
  if (to === "bench") {
    if (from) setSlot(L, from, null); // leave lineup / unit
    return;
  }
  if (toST) {
    const unit = to.split(".").slice(0, 2).join(".");
    const prev = getSlot(L, to);
    if (fromST) setSlot(L, from, prev); // swap within / across units
    setSlot(L, to, pid);
    // a player appears once per unit
    for (const id of allSlotIds(L)) {
      if (id !== to && isST(id) && id.startsWith(unit + ".") && getSlot(L, id) === pid) setSlot(L, id, id === from ? prev : null);
    }
    return;
  }
  if (fromST) { toast("Special-teams tiles can only move within units or back to the bench."); return; }
  const prev = getSlot(L, to);
  if (from) setSlot(L, from, prev); // swap with the occupant; from=bench leaves occupant on bench
  setSlot(L, to, pid);
}

// ---------- drag & drop ----------
const dnd = initDnd({
  dropSelector: ".slot, .bench",
  onDrop(src, target) {
    const to = target.classList.contains("bench") ? "bench" : target.dataset.slot;
    applyMove(src.from || null, to, src.pid);
    persist();
    render();
  },
});

$("#bench").addEventListener("click", (e) => {
  if (e.target.closest("[data-action=remove]")) {
    const pid = e.target.closest(".tile").dataset.pid;
    removePlayer(pid);
  }
});

function removePlayer(pid) {
  state.players.delete(pid);
  state.added = state.added.filter((p) => p.id !== pid);
  for (const id of allSlotIds(state.cur)) if (getSlot(state.cur, id) === pid) setSlot(state.cur, id, null);
  persist();
  render();
}

// ---------- persistence ----------
const key = () => `lineups:nhl:${state.abbrev}`;
function persist() {
  const changed = countChanges() > 0 || state.added.length > 0;
  if (changed) store.set(key(), { lineup: state.cur, added: state.added }); else store.del(key());
}

// ---------- loading ----------
async function loadTeam(abbrev) {
  state.abbrev = abbrev;
  store.set("lineups:nhl:last", abbrev);
  history.replaceState(null, "", `?team=${abbrev}`);
  $("#board").innerHTML = `<div class="loading">Loading ${esc(abbrev)}…</div>`;
  $("#bench").innerHTML = "";
  let payload;
  try {
    const res = await fetch(`/api/nhl/teams/${abbrev}`);
    payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.status);
  } catch (e) {
    $("#board").innerHTML = `<div class="loading">Couldn't load this team (${esc(e.message)}). <button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  state.payload = payload;
  state.players = new Map(payload.players.map((p) => [p.id, p]));
  state.def = payload.lineup;
  state.cur = clone(payload.lineup);
  state.added = [];

  const saved = store.get(key());
  if (saved) {
    for (const p of saved.added || []) { state.players.set(p.id, p); state.added.push(p); }
    const L = saved.lineup;
    const ok = (id) => (id == null || state.players.has(id) ? id : null);
    for (const sid of allSlotIds(state.cur)) {
      try { setSlot(state.cur, sid, ok(getSlot(L, sid))); } catch { /* shape changed; keep default */ }
    }
  }
  const t = payload.team;
  $("#teamBtn").innerHTML = `<img src="${esc(t.logo)}" alt=""> ${esc(t.name)} ▾`;
  document.title = `${t.name} depth chart · Lineups`;
  const warn = payload.warnings.slice(0, 3).join(" ");
  $("#banner").hidden = !warn;
  $("#banner").textContent = warn;
  render();
  markTeamPicker();
}

// ---------- team picker ----------
let picker;
const markTeamPicker = () => picker?.render();

// ---------- reset ----------
$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Reset this team to the default lineup? Added players will be removed.")) return;
  store.del(key());
  loadTeam(state.abbrev);
});

// ---------- add player ----------
const addModal = initAddModal({
  searchUrl: "/api/nhl/search",
  playerUrl: "/api/nhl/player",
  onAdd: (p) => addPlayer(p),
  onCustom(f) {
    const pos = f.pos;
    const alt = (f.alt || "").toUpperCase().split(/[\s,\/|]+/).filter((x) => ["C", "LW", "RW", "LD", "RD", "G"].includes(x) && x !== pos);
    const p = {
      id: `c-${Date.now()}`, name: f.name.trim(), number: f.number === "" ? null : +f.number,
      pos, alt, shoots: pos === "LD" ? "L" : pos === "RD" ? "R" : f.shoots, custom: true,
    };
    const num = (v) => (v === "" || v == null ? 0 : +v);
    if (pos === "G") p.goalie = { gp: 0, w: 0, gaa: null, svp: null };
    else {
      let toi = null;
      if (f.toi) { const [m, s] = f.toi.split(":").map(Number); toi = m * 60 + (s || 0); }
      p.skater = { gp: 0, toi, g: num(f.g), a: num(f.a), pm: f.pm === "" ? null : +f.pm };
    }
    addPlayer(p);
  },
});

function addPlayer(p) {
  if (state.players.has(p.id)) { toast(`${p.name} is already on this roster.`); return; }
  p.added = true;
  state.players.set(p.id, p);
  state.added.push(p);
  persist();
  render();
  addModal.close();
  toast(`${p.name} added to the bench — drag them into the lineup.`);
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") { addModal.close(); $("#teamPop").hidden = true; } });

// ---------- boot ----------
(async function init() {
  try {
    state.teams = await (await fetch("/api/nhl/teams")).json();
  } catch {
    $("#board").innerHTML = `<div class="loading">Couldn't load teams.</div>`;
    return;
  }
  const want = new URLSearchParams(location.search).get("team")?.toUpperCase() || store.get("lineups:nhl:last") || "BOS";
  picker = initTeamPicker({
    teams: state.teams.map((t) => ({ ...t, group: `${t.conference} · ${t.division}` })),
    getCurrent: () => state.abbrev,
    onPick: (ab) => loadTeam(ab),
  });
  loadTeam(state.teams.some((t) => t.abbrev === want) ? want : "BOS");
})();

// ---------- screenshot ----------
initScreenshot({
  exclude: ".sec.compact", // image = lines, D pairings, goalies (no PP/PK)
  getTarget: () => (state.payload ? $("#board") : null),
  getTitle: () => ({
    title: state.payload.team.name,
    sub: $("#changes").textContent ? `Edited lineup · ${$("#changes").textContent}` : "Default lineup",
  }),
  filename: () => `${state.payload.team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-lineup`,
});
