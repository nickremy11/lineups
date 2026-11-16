// NFL depth chart editor: offense and defense on a football field. Talks to /api/nfl/*.
import { $, esc, clone, store, toast, initTeamPicker, initAddModal } from "/shared/ui.js";
import { initDnd } from "/shared/dnd.js";

const UNITS = ["off", "def", "st"];
const state = {
  teams: [], abbrev: null, payload: null,
  players: new Map(), def: null, cur: null, added: [], labels: null,
  copy: false,
};

// ---------- formation layout: label -> [column 1-9, row] ----------
const OFF_MAP = { LWR: [1, 1], LT: [2, 1], LG: [3, 1], C: [4, 1], RG: [5, 1], RT: [6, 1], TE: [7, 1], SWR: [8, 1], RWR: [9, 1], QB: [4, 2], FB: [3, 2], RB: [5, 2] };
// defense sits above the line of scrimmage: secondary at the top, linemen right at the line
const DB_MAP = { LCB: [1, 1], SS: [3, 1], NB: [5, 1], FS: [7, 1], RCB: [9, 1] };
function defMap(labels) {
  const four = labels.includes("LDE");
  const dl = four
    ? { LDE: [2, 3], LDT: [4, 3], NT: [4, 3], RDT: [6, 3], DT: [6, 3], RDE: [8, 3] }
    : { DE: [3, 3], NT: [5, 3], DT: [7, 3] };
  const lb = labels.includes("LOLB")
    ? { LOLB: [2, 2], WLB: [4, 2], MLB: [6, 2], ROLB: [8, 2] }
    : { WLB: [3, 2], MLB: [5, 2], SLB: [7, 2] };
  return { ...dl, ...lb, ...DB_MAP };
}
function layout(unit, labels) {
  const map = unit === "off" ? OFF_MAP : unit === "def" ? defMap(labels) : null;
  let extraCol = 1;
  return labels.map((label, i) => {
    if (unit === "st") return { label, c: i + 1, r: 1 };
    const p = map[label];
    if (p) return { label, c: p[0], r: p[1] };
    return { label, c: extraCol++, r: unit === "def" ? 0 : 4 }; // unknown slot: park at the far edge of the formation
  });
}

// ---------- helpers ----------
const shortName = (n) => {
  const parts = n.split(" ");
  if (parts.length < 2) return n;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
};
const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
const injOut = (p) => p.injury && !/questionable|doubtful|probable|day|dtd|^q$|^d$/i.test(p.injury.status);
const tagChip = (p) => p.tag ? `<span class="chip tag ${p.tag}" title="${{ rookie: "2026 draft pick", fa: "2026 free agent / trade", udfa: "2026 undrafted free agent" }[p.tag]}">${{ rookie: "R", fa: "FA", udfa: "UDFA" }[p.tag]}</span>` : "";
const injAbbr = (s) => /injured reserve|^ir$/i.test(s) ? "IR" : /questionable/i.test(s) ? "Q" : /doubtful/i.test(s) ? "D" : /^out/i.test(s) ? "OUT" : /injured/i.test(s) ? "INJ" : s.toUpperCase().slice(0, 4);
const injChip = (p) => p.injury ? `<span class="chip ${injOut(p) ? "inj" : "gtd"}" title="${esc(p.injury.status + (p.injury.note ? " — " + p.injury.note : ""))}">${esc(injAbbr(p.injury.status))}</span>` : "";
const face = (p) => (p.headshot ? `<img src="${esc(p.headshot)}" alt="" draggable="false" loading="lazy">` : esc(initials(p.name)));

function tileHtml(p, slotId, kind) {
  const changed = slotId && isChanged(slotId, p.id);
  const cls = `tile${changed ? " changed" : ""}`;
  const attrs = `data-pid="${esc(p.id)}" data-slot="${slotId || ""}" title="${esc(p.name)}${p.key ? " · " + esc(p.key) : ""}"`;
  const num = p.number != null && p.number !== "" ? `<span class="num">${esc(p.number)}</span>` : "";
  if (kind === "backup") {
    return `<div class="${cls}" ${attrs}><div class="nmrow">${num}<span class="nm">${esc(shortName(p.name))}</span></div>${p.injury ? `<span class="dot${injOut(p) ? "" : " gtd"}"></span>` : ""}</div>`;
  }
  if (kind === "bench") {
    return `<div class="${cls}" ${attrs}><div class="face">${face(p)}</div><div class="body"><div class="nmrow">${num}<span class="nm">${esc(p.name)}</span></div>
      <div class="meta"><span class="chip">${esc(p.pos)}</span>${p.alt.map((a) => `<span class="chip alt">${esc(a)}</span>`).join("")}${tagChip(p)}${injChip(p)}${p.added ? `<span class="chip new">NEW</span>` : ""}</div></div>
      ${p.added ? `<button class="x" data-action="remove" title="Remove player">✕</button>` : ""}</div>`;
  }
  return `<div class="${cls}" ${attrs}><div class="face">${face(p)}</div><div class="nmrow">${num}<span class="nm">${esc(shortName(p.name))}</span></div>
    <div class="meta"><span class="chip">${esc(p.pos)}</span>${tagChip(p)}${injChip(p)}${p.added ? `<span class="chip new">NEW</span>` : ""}</div></div>`;
}

function isChanged(slotId, pid) {
  const [u, label, i] = slotId.split(".");
  return state.def[u]?.[label]?.[+i] !== pid;
}

function spotHtml(unit, { label, c, r }) {
  const list = state.cur[unit][label] ?? [];
  const slot = (i) => {
    const p = state.players.get(list[i]);
    return p ? tileHtml(p, `${unit}.${label}.${i}`, i === 0 ? "starter" : "backup") : "";
  };
  const starter = list.length
    ? `<div class="slot starter" data-slot="${unit}.${label}.0">${slot(0)}</div>`
    : `<div class="slot starter empty" data-slot="${unit}.${label}.0"><span class="ph">OPEN</span></div>`;
  const backups = list.slice(1).map((_, i) => `<div class="slot backup" data-slot="${unit}.${label}.${i + 1}">${slot(i + 1)}</div>`).join("");
  const add = list.length ? `<div class="slot add empty" data-slot="${unit}.${label}.${list.length}"><span class="ph">+</span></div>` : "";
  return `<div class="spot" style="--c:${c};--r:${r}"><div class="spot-head">${esc(label)}</div>${starter}${backups}${add}</div>`;
}

// ---------- render ----------
function render() {
  const src = state.payload.source, m = state.payload.meta;
  const grid = (unit, cls) => `<div class="${cls}">${layout(unit, state.labels[unit]).map((s) => spotHtml(unit, s)).join("")}</div>`;
  const half = (title, note) => `<div class="half-label"><b>${title}</b><span>${esc(note || "")}</span></div>`;
  $("#board").innerHTML = `<div class="source">Default depth chart: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a> · headshots &amp; injuries from ESPN · drag tiles to reorder, move, or bench players.</div>
    <div class="field main">
      ${half("DEFENSE", m.defense)}${grid("def", "grid9 def")}
      <div class="los"><span>LINE OF SCRIMMAGE</span></div>
      ${half("OFFENSE", m.offense)}${grid("off", "grid9 off")}
    </div>
    <div class="field st" data-title="SPECIAL TEAMS">${grid("st", "grid7")}</div>`;
  renderBench();
  const n = countChanges();
  $("#changes").textContent = n ? `${n} slot${n > 1 ? "s" : ""} changed` : "";
  $("#resetBtn").disabled = !n && !state.added.length;
}

const OFFPOS = new Set(["QB", "RB", "FB", "WR", "TE", "OT", "OG", "OC", "C", "G", "T", "OL"]);
const DEFPOS = new Set(["DE", "DT", "NT", "DL", "LB", "OLB", "ILB", "MLB", "CB", "S", "FS", "SS", "DB", "EDGE"]);
function renderBench() {
  const used = new Set(UNITS.flatMap((u) => Object.values(state.cur[u]).flat()));
  const bench = [...state.players.values()].filter((p) => !used.has(p.id));
  const byNum = (a, b) => (+a.number || 999) - (+b.number || 999);
  const out = bench.filter((p) => injOut(p)).sort(byNum);
  const rest = bench.filter((p) => !injOut(p));
  const ps = rest.filter((p) => p.squad === "PS").sort(byNum);
  const act = rest.filter((p) => p.squad !== "PS");
  const group = (t, arr) => arr.length ? `<h5>${t} (${arr.length})</h5>${arr.map((p) => tileHtml(p, "", "bench")).join("")}` : "";
  $("#bench").innerHTML = `<h3>Bench &amp; unassigned</h3>
    ${group("Offense", act.filter((p) => OFFPOS.has(p.pos)).sort(byNum))}
    ${group("Defense", act.filter((p) => DEFPOS.has(p.pos)).sort(byNum))}
    ${group("Special teams / other", act.filter((p) => !OFFPOS.has(p.pos) && !DEFPOS.has(p.pos)).sort(byNum))}
    ${group("Injured / reserve", out)}
    ${group("Practice squad", ps)}
    ${bench.length ? "" : `<div class="empty">Everyone is on the field.</div>`}`;
}

function countChanges() {
  let n = 0;
  for (const u of UNITS) {
    const keys = new Set([...Object.keys(state.cur[u]), ...Object.keys(state.def[u])]);
    for (const k of keys) if (JSON.stringify(state.cur[u][k] ?? []) !== JSON.stringify(state.def[u][k] ?? [])) n++;
  }
  return n;
}

// ---------- moves ----------
function applyMove(from, to, pid, copy) {
  const C = state.cur;
  const listOf = (id) => { const [u, l, i] = id.split("."); return { list: C[u][l], i: +i }; };
  if (to === "bench") {
    if (from && !copy) { const { list, i } = listOf(from); list.splice(i, 1); }
    return;
  }
  const t = listOf(to);
  let at = t.i;
  if (from) {
    const f = listOf(from);
    if (f.list !== t.list && !copy) f.list.splice(f.i, 1);
  }
  const existing = t.list.indexOf(pid);
  if (existing >= 0) { t.list.splice(existing, 1); if (existing < at) at--; }
  t.list.splice(Math.min(at, t.list.length), 0, pid);
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
  for (const u of UNITS) for (const k of Object.keys(state.cur[u])) state.cur[u][k] = state.cur[u][k].filter((id) => id !== pid);
  persist();
  render();
});

$("#copyBtn").addEventListener("click", () => {
  state.copy = !state.copy;
  $("#copyBtn").setAttribute("aria-pressed", state.copy);
  $("#copyBtn").textContent = `Copy mode: ${state.copy ? "on" : "off"}`;
  if (state.copy) toast("Copy mode: dragging a slotted player to another slot adds them there too.");
});

// ---------- tile style ----------
function setTiles(t) {
  if (!["light", "medium", "dark"].includes(t)) t = "light";
  document.body.dataset.tiles = t;
  document.querySelectorAll("#tileSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tiles === t));
}
document.querySelectorAll("#tileSeg button").forEach((b) => b.addEventListener("click", () => { setTiles(b.dataset.tiles); store.set("lineups:nfl:tile-style", b.dataset.tiles); }));
setTiles(new URLSearchParams(location.search).get("tiles") || store.get("lineups:nfl:tile-style") || "light");

// ---------- persistence ----------
const key = () => `lineups:nfl:${state.abbrev}`;
function persist() {
  if (countChanges() > 0 || state.added.length) store.set(key(), { depth: state.cur, added: state.added });
  else store.del(key());
}

// ---------- loading ----------
async function loadTeam(abbrev) {
  state.abbrev = abbrev;
  store.set("lineups:nfl:last", abbrev);
  const q = new URLSearchParams(location.search); q.set("team", abbrev);
  history.replaceState(null, "", `?${q}`);
  $("#board").innerHTML = `<div class="loading">Loading ${esc(abbrev)}…</div>`;
  $("#bench").innerHTML = "";
  let payload;
  try {
    const res = await fetch(`/api/nfl/teams/${abbrev}`);
    payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.status);
  } catch (e) {
    $("#board").innerHTML = `<div class="loading">Couldn't load this team (${esc(e.message)}). <button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  state.payload = payload;
  state.labels = payload.labels;
  state.players = new Map(payload.players.map((p) => [p.id, p]));
  state.def = payload.depth;
  state.cur = clone(payload.depth);
  state.added = [];
  const saved = store.get(key());
  if (saved) {
    for (const p of saved.added || []) { state.players.set(p.id, p); state.added.push(p); }
    for (const u of UNITS) for (const k of Object.keys(state.cur[u])) {
      const l = saved.depth?.[u]?.[k];
      if (Array.isArray(l)) state.cur[u][k] = l.filter((id) => state.players.has(id));
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
  searchUrl: "/api/nfl/search",
  playerUrl: "/api/nfl/player",
  onAdd: (p) => addPlayer(p),
  onCustom(f) {
    addPlayer({
      id: `c-${Date.now()}`, name: f.name.trim(), number: f.number === "" ? null : String(f.number),
      pos: f.pos.trim().toUpperCase(), alt: (f.alt || "").toUpperCase().split(/[\s,\/|]+/).filter(Boolean),
    });
  },
});
function addPlayer(p) {
  if (state.players.has(p.id)) { toast(`${p.name} is already on this roster.`); return; }
  p.added = true;
  p.alt = p.alt || [];
  state.players.set(p.id, p);
  state.added.push(p);
  persist();
  render();
  addModal.close();
  toast(`${p.name} added to the bench — drag them onto the field.`);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { addModal.close(); $("#teamPop").hidden = true; } });

// ---------- boot ----------
let picker;
(async function init() {
  try {
    state.teams = await (await fetch("/api/nfl/teams")).json();
  } catch {
    $("#board").innerHTML = `<div class="loading">Couldn't load teams.</div>`;
    return;
  }
  const want = new URLSearchParams(location.search).get("team")?.toUpperCase() || store.get("lineups:nfl:last") || "BUF";
  picker = initTeamPicker({
    teams: state.teams.map((t) => ({ ...t, group: `${t.conference} ${t.division}` })),
    getCurrent: () => state.abbrev,
    onPick: (ab) => loadTeam(ab),
  });
  loadTeam(state.teams.some((t) => t.abbrev === want) ? want : "BUF");
})();
