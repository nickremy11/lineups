// NCAAB depth chart editor: half-court by position (no photos). Talks to /api/ncaab/*.
import { $, esc, clone, store, toast, initTeamPicker, initAddModal, initScreenshot } from "/shared/ui.js";
import { initDnd } from "/shared/dnd.js";

const POS = ["PG", "SG", "SF", "PF", "C"];
const state = {
  teams: [], abbrev: null, payload: null,
  players: new Map(), def: null, cur: null, added: [],
  copy: false,
  stats: store.get("lineups:ncaab:stats") === true, // collapsed (no stats) by default
};

// ---------- formatting ----------
const f1 = (n) => (n == null ? "–" : n.toFixed(1));
const injOut = (p) => p.injury && !/day|dtd|questionable|probable/i.test(p.injury.status);

function statGrid(p) {
  if (!state.stats) return "";
  const s = p.stats;
  if (!s) return `<div class="nostats">No stats</div>`;
  const cell = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
  return `<div class="statgrid">${cell("MPG", f1(s.mpg))}${cell("PPG", f1(s.ppg))}${cell("RPG", f1(s.rpg))}${cell("APG", f1(s.apg))}${cell("FG%", f1(s.fg))}${cell("3P%", f1(s.tp))}</div>`;
}

function tileHtml(p, slotId) {
  const slotPos = slotId ? slotId.split(".")[0] : null;
  const off = slotPos && !p.pos.includes(slotPos);
  const changed = slotId && state.def[slotPos][+slotId.split(".")[1]] !== p.id;
  const inj = p.injury ? `<span class="chip ${injOut(p) ? "inj" : "gtd"}" title="${esc(p.injury.note || "")}">${esc(p.injury.status.toUpperCase())}</span>` : "";
    return `<div class="tile${off ? " off" : ""}${changed ? " changed" : ""}" data-pid="${esc(p.id)}" data-slot="${slotId || ""}" ${off ? `title="Not usually a ${esc(slotPos)}"` : ""}>
    <div class="body">
      <div class="name"><span class="num">${p.number != null && p.number !== "" ? esc(p.number) : ""}</span><span>${esc(p.name)}</span></div>
      <div class="meta">${p.pos.map((x, i) => `<span class="chip${i ? " pos-alt" : ""}">${esc(x)}</span>`).join("")}${p.cls ? `<span class="chip cls" title="Class year">${esc(p.cls)}</span>` : ""}${inj}${p.added ? `<span class="chip new">NEW</span>` : ""}</div>
      ${statGrid(p)}
    </div>
    ${p.added && !slotId ? `<button class="x" data-action="remove" title="Remove player">✕</button>` : ""}
  </div>`;
}

function spotHtml(pos, n) {
  const list = state.cur[pos];
  const tile = (i) => {
    const p = state.players.get(list[i]);
    return p ? tileHtml(p, `${pos}.${i}`) : "";
  };
  const starter = list.length
    ? `<div class="slot starter" data-slot="${pos}.0">${tile(0)}</div>`
    : `<div class="slot starter empty" data-slot="${pos}.0"><span class="ph">STARTER</span></div>`;
  const backups = list.slice(1).map((_, i) => `<div class="slot" data-slot="${pos}.${i + 1}">${tile(i + 1)}</div>`).join("");
  const add = list.length ? `<div class="slot add empty" data-slot="${pos}.${list.length}"><span class="ph">+ BACKUP</span></div>` : "";
  return `<div class="spot" data-pos="${pos}"><div class="spot-head"><i>${n}</i>${pos}</div>${starter}<div class="backups">${backups}${add}</div></div>`;
}

// ---------- court art ----------
function drawCourt() {
  const court = $("#court");
  if (!court) return;
  const w = court.clientWidth;
  const s = w / 50; // px per foot (court is 50ft wide)
  const h = court.clientHeight;
  const cx = w / 2, rim = 5.25 * s, ln = "#fffaf0";
  const corner = 5.25 + Math.sqrt(23.75 ** 2 - 22 ** 2);
  const svg = $("#courtArt");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = `
    <g fill="none" stroke="${ln}" stroke-width="2">
      <rect x="${cx - 8 * s}" y="0" width="${16 * s}" height="${19 * s}" fill="#b5482f" fill-opacity=".38"/>
      <path d="M ${cx - 6 * s} ${19 * s} A ${6 * s} ${6 * s} 0 0 0 ${cx + 6 * s} ${19 * s}"/>
      <path d="M ${cx - 6 * s} ${19 * s} A ${6 * s} ${6 * s} 0 0 1 ${cx + 6 * s} ${19 * s}" stroke-dasharray="6 6"/>
      <path d="M ${cx - 4 * s} ${rim} A ${4 * s} ${4 * s} 0 0 0 ${cx + 4 * s} ${rim}"/>
      <line x1="${cx - 3 * s}" y1="${4 * s}" x2="${cx + 3 * s}" y2="${4 * s}" stroke-width="3"/>
      <circle cx="${cx}" cy="${rim}" r="${0.75 * s}" stroke="#e8590c" stroke-width="3"/>
      <path d="M ${3 * s} 0 V ${corner * s} A ${23.75 * s} ${23.75 * s} 0 0 0 ${w - 3 * s} ${corner * s} V 0"/>
      ${[7, 8, 11, 14].map((y) => `<line x1="${cx - 8 * s}" y1="${y * s}" x2="${cx - 9 * s}" y2="${y * s}"/><line x1="${cx + 8 * s}" y1="${y * s}" x2="${cx + 9 * s}" y2="${y * s}"/>`).join("")}
    </g>`;
}
new ResizeObserver(() => drawCourt()).observe($("#board"));

// ---------- render ----------
function render() {
  const src = state.payload.source;
  $("#board").innerHTML = `<div class="source">${esc(state.payload.team.name)}${state.payload.team.conference ? " · " + esc(state.payload.team.conference) : ""} · default depth chart: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a> · stats from ESPN · drag a tile to reorder, move or bench a player.</div>
    <div class="court-wrap"><div class="court${state.stats ? "" : " collapsed"}" id="court"><svg class="court-art" id="courtArt" aria-hidden="true"></svg>
      ${spotHtml("PF", 4)}${spotHtml("C", 5)}${spotHtml("SG", 2)}${spotHtml("SF", 3)}${spotHtml("PG", 1)}
    </div></div>`;
  drawCourt();
  renderBench();
  const n = countChanges();
  $("#changes").textContent = n ? `${n} position${n > 1 ? "s" : ""} changed` : "";
  $("#resetBtn").disabled = !n && !state.added.length;
}

function renderBench() {
  const used = new Set(POS.flatMap((p) => state.cur[p]));
  const bench = [...state.players.values()].filter((p) => !used.has(p.id)).sort((a, b) => (b.stats?.mpg ?? -1) - (a.stats?.mpg ?? -1));
  const out = bench.filter(injOut), healthy = bench.filter((p) => !injOut(p));
  const grp = (t, arr) => arr.length ? `<h5>${t} (${arr.length})</h5>${arr.map((p) => tileHtml(p, "")).join("")}` : "";
  $("#bench").innerHTML = `<h3>Bench &amp; unassigned</h3>${grp("Available", healthy)}${grp("Injured", out)}${bench.length ? "" : `<div class="empty">Everyone is on the court.</div>`}`;
}

// number of positions whose depth order differs from the default
function countChanges() {
  return POS.filter((p) => JSON.stringify(state.cur[p]) !== JSON.stringify(state.def[p])).length;
}

// ---------- moves ----------
function applyMove(from, to, pid, copy) {
  const C = state.cur;
  if (to === "bench") {
    if (from && !copy) { const [fp, fi] = from.split("."); C[fp].splice(+fi, 1); }
    return;
  }
  const [tp, tiRaw] = to.split(".");
  let at = +tiRaw;
  const list = C[tp];
  if (from) {
    const [fp, fi] = from.split(".");
    if (fp !== tp && !copy) C[fp].splice(+fi, 1);
  }
  const existing = list.indexOf(pid);
  if (existing >= 0) { list.splice(existing, 1); if (existing < at) at--; }
  list.splice(Math.min(at, list.length), 0, pid);
}

initDnd({
  dropSelector: ".slot, .bench",
  onDrop(src, target, ev) {
    const to = target.classList.contains("bench") ? "bench" : target.dataset.slot;
    applyMove(src.from || null, to, src.pid, state.copy || ev.altKey);
    persist();
    render();
  },
});

$("#bench").addEventListener("click", (e) => {
  if (!e.target.closest("[data-action=remove]")) return;
  const pid = e.target.closest(".tile").dataset.pid;
  state.players.delete(pid);
  state.added = state.added.filter((p) => p.id !== pid);
  for (const p of POS) state.cur[p] = state.cur[p].filter((id) => id !== pid);
  persist();
  render();
});

function syncStatsBtn() {
  $("#statsBtn").setAttribute("aria-pressed", state.stats);
  $("#statsBtn").textContent = `Stats: ${state.stats ? "on" : "off"}`;
}
syncStatsBtn();
$("#statsBtn").addEventListener("click", () => {
  state.stats = !state.stats;
  store.set("lineups:ncaab:stats", state.stats);
  syncStatsBtn();
  if (state.payload) render();
});

$("#copyBtn").addEventListener("click", () => {
  state.copy = !state.copy;
  $("#copyBtn").setAttribute("aria-pressed", state.copy);
  $("#copyBtn").textContent = `Copy mode: ${state.copy ? "on" : "off"}`;
  if (state.copy) toast("Copy mode: dragging a starter/backup to another position adds them there too.");
});

// ---------- persistence ----------
const key = () => `lineups:ncaab:${state.abbrev}`;
function persist() {
  if (countChanges() > 0 || state.added.length) store.set(key(), { depth: state.cur, added: state.added });
  else store.del(key());
}

// ---------- loading ----------
async function loadTeam(abbrev) {
  state.abbrev = abbrev;
  store.set("lineups:ncaab:last", abbrev);
  history.replaceState(null, "", `?team=${abbrev}`);
  $("#board").innerHTML = `<div class="loading">Loading ${esc(abbrev)}…</div>`;
  $("#bench").innerHTML = "";
  let payload;
  try {
    const res = await fetch(`/api/ncaab/teams/${abbrev}`);
    payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.status);
  } catch (e) {
    $("#board").innerHTML = `<div class="loading">Couldn't load this team (${esc(e.message)}). <button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  state.payload = payload;
  state.players = new Map(payload.players.map((p) => [p.id, p]));
  state.def = payload.depth;
  state.cur = clone(payload.depth);
  state.added = [];
  const saved = store.get(key());
  if (saved) {
    for (const p of saved.added || []) { state.players.set(p.id, p); state.added.push(p); }
    for (const pos of POS) {
      const l = saved.depth?.[pos];
      if (Array.isArray(l)) state.cur[pos] = l.filter((id) => state.players.has(id));
    }
  }
  const t = payload.team;
  $("#teamBtn").innerHTML = `<img src="${esc(t.logo)}" alt=""> ${esc(t.name)} ▾`;
  document.title = `${t.name} depth chart · Lineups`;
  const warn = payload.warnings.slice(0, 3).join(" ");
  $("#banner").hidden = !warn;
  $("#banner").textContent = warn;
  render();
  picker?.render();
}

$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Reset this team to the default depth chart? Added players will be removed.")) return;
  store.del(key());
  loadTeam(state.abbrev);
});

// ---------- add player ----------
const addModal = initAddModal({
  searchUrl: "/api/ncaab/search",
  playerUrl: "/api/ncaab/player",
  onAdd: (p) => addPlayer(p),
  onCustom(f) {
    const pos = f.pos.toUpperCase().split(/[\s,\/|]+/).filter((x) => POS.includes(x));
    if (!pos.length) { toast("Use positions PG, SG, SF, PF or C."); return; }
    const n = (v) => (v === "" || v == null ? null : +v);
    addPlayer({
      id: `c-${Date.now()}`, name: f.name.trim(), number: f.number === "" ? null : String(f.number), pos,
      stats: { gp: null, mpg: n(f.mpg), ppg: n(f.ppg), rpg: n(f.rpg), apg: n(f.apg), fg: n(f.fg), tp: n(f.tp) },
    });
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
  toast(`${p.name} added to the bench — drag them onto the court.`);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { addModal.close(); $("#teamPop").hidden = true; } });

// ---------- boot ----------
let picker;
(async function init() {
  try {
    state.teams = await (await fetch("/api/ncaab/teams")).json();
  } catch {
    $("#board").innerHTML = `<div class="loading">Couldn't load teams.</div>`;
    return;
  }
  const want = new URLSearchParams(location.search).get("team") || store.get("lineups:ncaab:last") || "150";
  picker = initTeamPicker({
    teams: state.teams.map((t) => ({ ...t, abbrev: t.id, group: t.conference })),
    getCurrent: () => state.abbrev,
    onPick: (ab) => loadTeam(ab),
  });
  loadTeam(state.teams.some((t) => t.id === want) ? want : "150");
})();

// ---------- screenshot ----------
initScreenshot({
  getTarget: () => (state.payload ? $("#board") : null),
  getTitle: () => ({
    title: state.payload.team.name,
    sub: $("#changes").textContent ? `Edited lineup · ${$("#changes").textContent}` : "Default lineup",
  }),
  filename: () => `${state.payload.team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-lineup`,
});
