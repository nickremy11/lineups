// Soccer lineup editor: pitch + formation + backups under each slot. Talks to /api/soccer/*.
import { $, esc, clone, store, toast, initAddModal } from "/shared/ui.js";
import { initDnd } from "/shared/dnd.js";

const FORMATIONS = ["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "4-3-2-1", "4-4-1-1", "4-1-2-1-2", "3-5-2", "3-4-3", "3-4-2-1", "5-3-2", "5-4-1"];
const state = {
  leagues: [], leagueId: 47, teamsByLeague: {}, team: null, payload: null,
  players: new Map(), formation: "4-3-3", slots: [], def: null, added: [], copy: false,
  foot: store.get("lineups:soccer:foot") || {},
};

// ---------- formations -> roles ----------
function lineRoles(formation) {
  const d = formation.split("-").map(Number);
  const def = d[0], fwd = d[d.length - 1], mids = d.slice(1, -1);
  const defRoles = def === 4 ? ["LB", "CB", "CB", "RB"] : def === 5 ? ["LWB", "CB", "CB", "CB", "RWB"] : def === 3 ? ["CB", "CB", "CB"] : Array(def).fill("CB");
  const fwdRoles = fwd === 1 ? ["ST"] : fwd === 2 ? ["ST", "ST"] : fwd === 3 ? ["LW", "ST", "RW"] : Array(fwd).fill("ST");
  const midLine = (n, i, total) => {
    const first = i === 0, last = i === total - 1;
    if (total === 1) return n === 5 ? ["LWB", "CM", "CM", "CM", "RWB"] : n === 4 ? ["LM", "CM", "CM", "RM"] : n === 3 ? ["CM", "CM", "CM"] : n === 2 ? ["CM", "CM"] : n === 1 ? ["CM"] : Array(n).fill("CM");
    if (first && !last) return n === 1 ? ["DM"] : n === 2 ? ["DM", "DM"] : n === 3 ? ["CM", "DM", "CM"] : Array(n).fill("CM");
    if (last) return n === 1 ? ["AM"] : n === 2 ? ["AM", "AM"] : n === 3 ? ["LW", "AM", "RW"] : n === 4 ? ["LM", "AM", "AM", "RM"] : Array(n).fill("AM");
    return n === 4 ? ["LM", "CM", "CM", "RM"] : n === 3 ? ["CM", "CM", "CM"] : n === 2 ? ["CM", "CM"] : Array(n).fill("CM");
  };
  return [defRoles, ...mids.map((n, i) => midLine(n, i, mids.length)), fwdRoles];
}
const flatRoles = (f) => ["GK", ...lineRoles(f).flat()];

// which player positions satisfy a slot role (first entry = the "ideal" one)
const ACCEPT = {
  GK: ["GK"], CB: ["CB"], LB: ["LB", "LWB"], RB: ["RB", "RWB"], LWB: ["LWB", "LB", "LM"], RWB: ["RWB", "RB", "RM"],
  DM: ["CDM", "CM"], CM: ["CM", "CDM", "CAM"], AM: ["CAM", "CM", "LW", "RW"], LM: ["LM", "LW"], RM: ["RM", "RW"],
  LW: ["LW", "LM", "CAM"], RW: ["RW", "RM", "CAM"], ST: ["ST", "CF"],
};
function fit(p, role) {
  const acc = ACCEPT[role] || [];
  if (p.pos[0] === acc[0]) return 3;
  if (acc.includes(p.pos[0])) return 2;
  if (p.pos.some((x) => acc.includes(x))) return 1;
  return 0;
}

// ---------- slots ----------
const ratingOf = (p) => p.rating ?? -1;
function buildSlots(xi, formation, players) {
  const roles = flatRoles(formation);
  const starters = new Set(xi.filter(Boolean));
  const pool = [...players.values()].filter((p) => !starters.has(p.id));
  return roles.map((role, i) => {
    const backups = pool
      .map((p) => ({ p, f: fit(p, role) })).filter((x) => x.f >= 1)
      .sort((a, b) => b.f - a.f || ratingOf(b.p) - ratingOf(a.p))
      .slice(0, role === "GK" ? 2 : 3).map((x) => x.p.id);
    return xi[i] ? [xi[i], ...backups] : backups;
  });
}
function autoXi(formation, players) {
  const roles = flatRoles(formation);
  const taken = new Set();
  const order = roles.map((r, i) => i).sort((a, b) => (roles[a] === "GK" ? -1 : roles[b] === "GK" ? 1 : 0));
  const xi = Array(roles.length).fill(null);
  for (const i of order) {
    const best = [...players.values()].filter((p) => !taken.has(p.id) && !p.injury)
      .map((p) => ({ p, f: fit(p, roles[i]) })).filter((x) => x.f >= 1)
      .sort((a, b) => b.f - a.f || ratingOf(b.p) - ratingOf(a.p))[0];
    if (best) { xi[i] = best.p.id; taken.add(best.p.id); }
  }
  return xi;
}
// Re-seat the current starters into a new formation by best positional fit (keeps each player in his own line where possible).
const roleLine = (r) => (r === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(r) ? "DEF" : ["LW", "RW", "ST"].includes(r) ? "ATT" : "MID");
const playerLine = (p) => p.group || roleLine(p.pos[0] === "CDM" || p.pos[0] === "CM" || p.pos[0] === "CAM" || p.pos[0] === "LM" || p.pos[0] === "RM" ? "CM" : p.pos[0]);
function reseat(ids, formation, players) {
  const roles = flatRoles(formation);
  const pairs = [];
  ids.forEach((id, prev) => {
    const p = players.get(id);
    if (!p) return;
    roles.forEach((role, s) => pairs.push({ id, s, score: fit(p, role) * 10 + (playerLine(p) === roleLine(role) ? 6 : 0) - Math.abs(prev - s) * 0.2 }));
  });
  pairs.sort((a, b) => b.score - a.score);
  const out = Array(roles.length).fill(null), used = new Set();
  for (const x of pairs) if (out[x.s] === null && !used.has(x.id)) { out[x.s] = x.id; used.add(x.id); }
  return out;
}
const starters = () => state.slots.map((l) => l[0]).filter(Boolean);

// ---------- formatting ----------
const shortName = (n) => { const p = n.split(" "); return p.length < 2 ? n : `${p[0][0]}. ${p.slice(1).join(" ")}`; };
const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
const scoreCls = (r) => (r == null ? "" : r >= 7.4 ? "s4" : r >= 7 ? "s3" : r >= 6.6 ? "s2" : r >= 6.2 ? "s1" : "s0");
const scoreChip = (p) => `<span class="score ${scoreCls(p.rating)}" title="FotMob season rating">${p.rating == null ? "–" : p.rating.toFixed(1)}</span>`;
const footOf = (p) => p.foot || state.foot[p.id];
const footChip = (p) => { const f = footOf(p); return f ? `<span class="chip foot" data-foot title="${{ L: "Left-footed", R: "Right-footed", B: "Two-footed" }[f]}">${f}</span>` : ""; };
const posChips = (p, n = 3) => p.pos.slice(0, n).map((x, i) => `<span class="chip${i ? " alt" : ""}">${esc(x)}</span>`).join("");
const injChip = (p) => (p.injury ? `<span class="chip inj" title="${esc(p.injury.note || "Injured")}">INJ</span>` : "");
const face = (p) => (p.headshot ? `<img src="${esc(p.headshot)}" alt="" draggable="false" loading="lazy" onerror="this.remove()">` : esc(initials(p.name)));

function tileHtml(p, slotId, kind) {
  let off = false, changed = false, title = esc(p.name);
  if (slotId) {
    const [s, i] = slotId.split(".").map(Number);
    if (i === 0) off = fit(p, flatRoles(state.formation)[s]) === 0;
    changed = state.def.formation === state.formation ? state.def.slots[s]?.[i] !== p.id : state.def.slots.flat().indexOf(p.id) < 0 && i === 0;
    if (off) title += " — playing out of position";
  }
  const cls = `tile${off ? " off" : ""}${changed ? " changed" : ""}`;
  const attrs = `data-pid="${esc(p.id)}" data-slot="${slotId || ""}" title="${title}"`;
  const num = p.number ? `<span class="num">${esc(p.number)}</span>` : "";
  if (kind === "backup") {
    return `<div class="${cls}" ${attrs}><div class="nmrow">${num}<span class="nm">${esc(shortName(p.name))}</span></div><div class="meta">${posChips(p, 1)}${footChip(p)}${injChip(p)}${scoreChip(p)}</div></div>`;
  }
  if (kind === "bench") {
    return `<div class="${cls}" ${attrs}><div class="face">${face(p)}</div><div class="body"><div class="nmrow">${num}<span class="nm">${esc(p.name)}</span></div>
      <div class="meta">${posChips(p)}${footChip(p)}${injChip(p)}${scoreChip(p)}${p.added ? `<span class="chip new">NEW</span>` : ""}</div></div>
      ${p.added ? `<button class="x" data-action="remove" title="Remove player">✕</button>` : ""}</div>`;
  }
  return `<div class="${cls}" ${attrs}><div class="face">${face(p)}</div><div class="nmrow">${num}<span class="nm">${esc(p.name)}</span></div>
    <div class="meta">${posChips(p)}${footChip(p)}${injChip(p)}${scoreChip(p)}${p.added ? `<span class="chip new">NEW</span>` : ""}</div></div>`;
}

function spotHtml(s, role) {
  const list = state.slots[s];
  const t = (i) => { const p = state.players.get(list[i]); return p ? tileHtml(p, `${s}.${i}`, i === 0 ? "starter" : "backup") : ""; };
  const starter = list.length
    ? `<div class="slot starter" data-slot="${s}.0">${t(0)}</div>`
    : `<div class="slot starter empty" data-slot="${s}.0"><span class="ph">OPEN</span></div>`;
  const backups = list.slice(1).map((_, i) => `<div class="slot backup" data-slot="${s}.${i + 1}">${t(i + 1)}</div>`).join("");
  const add = list.length ? `<div class="slot add empty" data-slot="${s}.${list.length}"><span class="ph">+</span></div>` : "";
  return `<div class="spot"><div class="spot-head">${role}</div>${starter}${backups}${add}</div>`;
}

// ---------- render ----------
const WIDTH = [0, 0.3, 0.52, 0.74, 0.94, 1];
function render() {
  const lr = lineRoles(state.formation);
  const rows = [];
  let idx = 1;
  const lineSlots = lr.map((roles) => roles.map((r) => ({ s: idx++, role: r })));
  const lineHtml = (items) => `<div class="line" style="grid-template-columns:repeat(${items.length},minmax(0,1fr));width:${(WIDTH[items.length] ?? 1) * 100}%">${items.map((x) => spotHtml(x.s, x.role)).join("")}</div>`;
  for (const items of [...lineSlots].reverse()) rows.push(lineHtml(items)); // attack at the top
  rows.push(lineHtml([{ s: 0, role: "GK" }]));
  const src = state.payload.source;
  $("#board").innerHTML = `<div class="source">${esc(state.payload.team.name)} · ${esc(state.payload.team.league || "")} · default: ${esc(state.payload.basedOn || "standard formation")} · positions, ratings &amp; injuries from <a href="${esc(src.url)}" target="_blank" rel="noopener">FotMob</a> · drag tiles to swap starters or reorder backups.</div>
    <div class="pitch-wrap"><div class="pitch" id="pitch"><svg class="pitch-art" id="pitchArt" aria-hidden="true"></svg>${rows.join("")}</div></div>`;
  drawPitch();
  renderBench();
  const n = countChanges();
  $("#changes").textContent = n ? `${n} change${n > 1 ? "s" : ""}` : "";
  $("#resetBtn").disabled = !n && !state.added.length;
  $("#formationSel").value = state.formation;
}

function drawPitch() {
  const el = $("#pitch");
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight, pad = 8, ln = "#ffffffcc";
  const cx = w / 2, u = (w - 2 * pad) / 68; // px per metre
  const bottom = h - pad, boxW = 40.32 * u, boxD = 16.5 * u, gW = 18.32 * u, gD = 5.5 * u, spot = 11 * u, r = 9.15 * u;
  const arcDy = Math.sqrt(r * r - (boxD - spot) ** 2), arcDx = arcDy;
  $("#pitchArt").setAttribute("viewBox", `0 0 ${w} ${h}`);
  $("#pitchArt").innerHTML = `<g fill="none" stroke="${ln}" stroke-width="2">
    <rect x="${pad}" y="${pad}" width="${w - 2 * pad}" height="${h - 2 * pad}"/>
    <line x1="${pad}" y1="${pad}" x2="${w - pad}" y2="${pad}" stroke-width="3"/>
    <path d="M ${cx - r} ${pad} A ${r} ${r} 0 0 0 ${cx + r} ${pad}"/>
    <rect x="${cx - boxW / 2}" y="${bottom - boxD}" width="${boxW}" height="${boxD}"/>
    <rect x="${cx - gW / 2}" y="${bottom - gD}" width="${gW}" height="${gD}"/>
    <path d="M ${cx - arcDx} ${bottom - boxD} A ${r} ${r} 0 0 1 ${cx + arcDx} ${bottom - boxD}"/>
  </g><circle cx="${cx}" cy="${bottom - spot}" r="2.5" fill="${ln}"/>`;
}
new ResizeObserver(() => drawPitch()).observe($("#board"));

function renderBench() {
  const start = new Set(starters());
  const bench = [...state.players.values()].filter((p) => !start.has(p.id));
  const grpOf = (p) => p.group || (p.pos[0] === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(p.pos[0]) ? "DEF" : ["ST", "CF", "LW", "RW"].includes(p.pos[0]) ? "ATT" : "MID");
  const sort = (a) => a.sort((x, y) => ratingOf(y) - ratingOf(x) || (+x.number || 99) - (+y.number || 99));
  const grp = (t, key) => { const a = sort(bench.filter((p) => grpOf(p) === key)); return a.length ? `<h5>${t} (${a.length})</h5>${a.map((p) => tileHtml(p, "", "bench")).join("")}` : ""; };
  $("#bench").innerHTML = `<h3>Squad &amp; substitutes</h3>${grp("Goalkeepers", "GK")}${grp("Defenders", "DEF")}${grp("Midfielders", "MID")}${grp("Attackers", "ATT")}${bench.length ? "" : `<div class="empty">Everyone is in the XI.</div>`}`;
}

function countChanges() {
  if (!state.def) return 0;
  if (state.def.formation !== state.formation) return Math.max(1, state.slots.filter((l, i) => l[0] !== state.def.slots[i]?.[0]).length);
  return state.slots.filter((l, i) => JSON.stringify(l) !== JSON.stringify(state.def.slots[i])).length;
}

// ---------- moves ----------
function applyMove(from, to, pid, copy) {
  const S = state.slots;
  const [fs, fi] = from ? from.split(".").map(Number) : [-1, -1];
  if (to === "bench") {
    if (from && !copy) S[fs].splice(fi, 1); // a removed starter is replaced by the first backup
    return;
  }
  const [ts, ti0] = to.split(".").map(Number);
  const T = S[ts];
  let ti = ti0;
  if (ti === 0) {
    if (from && fi === 0) { // starter onto starter: swap
      if (fs === ts) return;
      const A = S[fs], tmp = T[0];
      T[0] = A[0];
      if (tmp === undefined) A.shift(); else A[0] = tmp;
      return;
    }
    const elsewhere = S.findIndex((L, k) => k !== ts && L[0] === pid);
    const old = T[0];
    const dup = T.indexOf(pid); if (dup > 0) T.splice(dup, 1);
    if (from && fi > 0 && !copy && fs !== ts) S[fs].splice(fi, 1);
    if (elsewhere >= 0) { if (old !== undefined) S[elsewhere][0] = old; else S[elsewhere].shift(); T[0] = pid; }
    else T.splice(0, old !== undefined && old !== pid ? 1 : 0, pid, ...(old !== undefined && old !== pid ? [old] : []));
    return;
  }
  if (from && fi === 0 && !copy) { // starter onto a backup spot: swap with that backup
    const occ = T[ti];
    if (occ === undefined) { toast("Drop a starter onto another starter to swap, or onto the bench."); return; }
    S[fs][0] = occ; T[ti] = pid;
    return;
  }
  if (T[0] === pid) return;
  if (from && fi > 0 && !copy) { S[fs].splice(fi, 1); if (fs === ts && fi < ti) ti--; }
  const dup = T.indexOf(pid);
  if (dup > 0) { T.splice(dup, 1); if (dup < ti) ti--; }
  T.splice(Math.min(Math.max(ti, T.length ? 1 : 0), T.length), 0, pid);
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
  state.slots = state.slots.map((l) => l.filter((id) => id !== pid));
  persist();
  render();
});
$("#copyBtn").addEventListener("click", () => {
  state.copy = !state.copy;
  $("#copyBtn").setAttribute("aria-pressed", state.copy);
  $("#copyBtn").textContent = `Copy mode: ${state.copy ? "on" : "off"}`;
  if (state.copy) toast("Copy mode: dragging a player to another slot adds them there too.");
});

// ---------- formation ----------
function setFormationOptions() {
  const opts = [...new Set([state.def?.formation, ...FORMATIONS].filter(Boolean))];
  $("#formationSel").innerHTML = opts.map((f) => `<option>${f}</option>`).join("");
}
$("#formationSel").addEventListener("change", (e) => {
  if (!state.payload) return;
  const f = e.target.value;
  const xi = reseat(state.slots.map((l) => l[0]).filter(Boolean), f, state.players);
  state.formation = f;
  state.slots = buildSlots(xi, f, state.players); // starters keep their order; backups refresh for the new roles
  persist();
  render();
});

// ---------- tile style ----------
function setTiles(t) {
  if (!["light", "medium", "dark"].includes(t)) t = "light";
  document.body.dataset.tiles = t;
  document.querySelectorAll("#tileSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tiles === t));
}
document.querySelectorAll("#tileSeg button").forEach((b) => b.addEventListener("click", () => { setTiles(b.dataset.tiles); store.set("lineups:soccer:tile-style", b.dataset.tiles); }));
setTiles(store.get("lineups:soccer:tile-style") || "light");

// ---------- persistence ----------
const key = () => `lineups:soccer:team:${state.team}`;
function persist() {
  if (countChanges() > 0 || state.added.length) store.set(key(), { formation: state.formation, slots: state.slots, added: state.added });
  else store.del(key());
}

// ---------- preferred foot (lazy, cached) ----------
let footQueue = [], footBusy = 0;
function queueFoot(ids) {
  for (const id of ids) if (!footOf({ id }) && !footQueue.includes(id) && !String(id).startsWith("c-")) footQueue.push(id);
  pump();
}
function pump() {
  while (footBusy < 3 && footQueue.length) {
    const id = footQueue.shift();
    footBusy++;
    fetch(`/api/soccer/foot/${id}`).then((r) => r.json()).then((d) => {
      if (d.foot) { state.foot[id] = d.foot; store.set("lineups:soccer:foot", state.foot); patchFoot(id); }
    }).catch(() => {}).finally(() => { footBusy--; pump(); });
  }
}
function patchFoot(id) {
  const f = state.foot[id];
  document.querySelectorAll(`.tile[data-pid="${CSS.escape(String(id))}"] .meta`).forEach((m) => {
    if (m.querySelector("[data-foot]")) return;
    const c = document.createElement("span");
    c.className = "chip foot"; c.dataset.foot = "1"; c.textContent = f; c.title = { L: "Left-footed", R: "Right-footed", B: "Two-footed" }[f];
    const score = m.querySelector(".score");
    m.insertBefore(c, m.querySelector(".chip.inj") || score);
  });
}

// ---------- loading ----------
async function loadTeam(teamId, leagueId) {
  state.team = teamId;
  if (leagueId) state.leagueId = leagueId;
  store.set("lineups:soccer:last", { team: teamId, league: state.leagueId });
  history.replaceState(null, "", `?team=${teamId}&league=${state.leagueId}${new URLSearchParams(location.search).get("tiles") ? "&tiles=" + new URLSearchParams(location.search).get("tiles") : ""}`);
  $("#board").innerHTML = `<div class="loading">Loading team…</div>`;
  $("#bench").innerHTML = "";
  let payload;
  try {
    const res = await fetch(`/api/soccer/teams/${teamId}`);
    payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.status);
  } catch (e) {
    $("#board").innerHTML = `<div class="loading">Couldn't load this team (${esc(e.message)}). <button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  state.payload = payload;
  state.players = new Map(payload.players.map((p) => [p.id, p]));
  state.formation = payload.formation;
  const xi = payload.xi.length === 11 ? payload.xi : autoXi(state.formation, state.players);
  state.slots = buildSlots(xi, state.formation, state.players);
  state.def = { formation: state.formation, slots: clone(state.slots) };
  state.added = [];
  const saved = store.get(key());
  if (saved) {
    for (const p of saved.added || []) { state.players.set(p.id, p); state.added.push(p); }
    if (saved.formation && Array.isArray(saved.slots) && saved.slots.length === flatRoles(saved.formation).length) {
      state.formation = saved.formation;
      state.slots = saved.slots.map((l) => l.filter((id) => state.players.has(id)));
    }
  }
  $("#teamBtn").innerHTML = `<img src="${esc(payload.team.logo)}" alt=""> ${esc(payload.team.name)} ▾`;
  document.title = `${payload.team.name} lineup · Lineups`;
  const warn = payload.warnings.slice(0, 3).join(" ");
  $("#banner").hidden = !warn; $("#banner").textContent = warn;
  setFormationOptions();
  render();
  queueFoot([...starters(), ...state.players.keys()]);
}

$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Reset to the default lineup? Added players will be removed.")) return;
  store.del(key());
  loadTeam(state.team);
});

// ---------- league / team picker ----------
async function showLeague(id) {
  state.leagueId = id;
  $("#leagueChips").innerHTML = state.leagues.map((l) => `<button data-league="${l.id}" aria-pressed="${l.id === id}">${esc(l.name)}</button>`).join("");
  $("#teamList").innerHTML = `<div class="note">Loading teams…</div>`;
  try {
    state.teamsByLeague[id] ??= await (await fetch(`/api/soccer/leagues/${id}/teams`)).json();
  } catch { $("#teamList").innerHTML = `<div class="note">Couldn't load this league.</div>`; return; }
  renderTeams();
}
function renderTeams() {
  const f = $("#teamSearch").value.trim().toLowerCase();
  const teams = (state.teamsByLeague[state.leagueId] || []).filter((t) => !f || t.name.toLowerCase().includes(f));
  $("#teamList").innerHTML = `<div class="team-grid">${teams.map((t) => `<button data-team="${t.id}" class="${t.id === state.team ? "on" : ""}"><img src="${esc(t.logo)}" alt="" loading="lazy">${esc(t.name)}</button>`).join("")}</div>`;
}
$("#teamBtn").addEventListener("click", () => {
  const pop = $("#teamPop");
  pop.hidden = !pop.hidden;
  if (!pop.hidden) { showLeague(state.leagueId); $("#teamSearch").focus(); }
});
$("#leagueChips").addEventListener("click", (e) => { const b = e.target.closest("[data-league]"); if (b) { $("#teamSearch").value = ""; showLeague(+b.dataset.league); } });
$("#teamSearch").addEventListener("input", renderTeams);
$("#teamList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-team]");
  if (!b) return;
  $("#teamPop").hidden = true;
  loadTeam(+b.dataset.team, state.leagueId);
});
document.addEventListener("click", (e) => { if (!e.target.closest("#teamPop, #teamBtn")) $("#teamPop").hidden = true; });

// ---------- add player ----------
const addModal = initAddModal({
  searchUrl: "/api/soccer/search",
  playerUrl: "/api/soccer/player",
  onAdd: (p) => addPlayer(p),
  onCustom(f) {
    addPlayer({
      id: `c-${Date.now()}`, name: f.name.trim(), number: f.number === "" ? null : String(f.number),
      pos: f.pos.toUpperCase().split(/[\s,\/|]+/).filter(Boolean), foot: f.foot,
      rating: f.rating === "" ? null : +f.rating, headshot: "",
    });
  },
});
function addPlayer(p) {
  if (state.players.has(p.id)) { toast(`${p.name} is already in this squad.`); return; }
  p.added = true;
  state.players.set(p.id, p);
  state.added.push(p);
  persist();
  render();
  addModal.close();
  toast(`${p.name} added to the squad — drag them onto the pitch.`);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { addModal.close(); $("#teamPop").hidden = true; } });

// ---------- boot ----------
(async function init() {
  try { state.leagues = await (await fetch("/api/soccer/leagues")).json(); }
  catch { $("#board").innerHTML = `<div class="loading">Couldn't load leagues.</div>`; return; }
  const q = new URLSearchParams(location.search);
  const last = store.get("lineups:soccer:last") || {};
  const team = +(q.get("team") || last.team || 9825);
  const league = +(q.get("league") || last.league || 47);
  state.leagueId = league;
  loadTeam(team, league);
})();
