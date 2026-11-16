// NCAAB adapter: ESPN (teams, rosters, season averages) + RotoWire depth charts where available.
import type { NbaDepth, NbaPos, NbaStats } from "./nba";

export interface NcaabPlayer {
  id: string;
  name: string;
  number: string | null;
  pos: string[]; // primary first
  cls?: string; // FR / SO / JR / SR / GR
  height?: string;
  injury?: { status: string; note?: string };
  stats?: NbaStats;
}

export interface NcaabTeamPayload {
  team: { id: string; name: string; logo: string; conference?: string };
  players: NcaabPlayer[];
  depth: NbaDepth;
  estimated: boolean;
  source: { name: string; url: string };
  warnings: string[];
}

const POSITIONS: NbaPos[] = ["PG", "SG", "SF", "PF", "C"];
const MAX_DEPTH = 4;
const UA = { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" };
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const RW = "https://www.rotowire.com";
const logoFor = (id: string) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json() as Promise<T>;
}
async function getText(url: string, ttl: number): Promise<string> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}
const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const num = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };

// ---------- teams ----------

export interface NcaabTeamRow { id: string; name: string; short: string; conference: string; logo: string }

export async function listNcaabTeams(): Promise<NcaabTeamRow[]> {
  const [groups, all] = await Promise.all([
    getJson<any>(`${ESPN}/groups?group=50`, 12 * 3600),
    getJson<any>(`${ESPN}/teams?limit=500`, 12 * 3600),
  ]);
  const out = new Map<string, NcaabTeamRow>();
  for (const c of groups.groups?.[0]?.children ?? []) {
    const conf = String(c.name).replace(/ Conference$/, "");
    for (const t of c.teams ?? []) out.set(String(t.id), { id: String(t.id), name: t.displayName, short: t.shortDisplayName ?? t.displayName, conference: conf, logo: logoFor(String(t.id)) });
  }
  for (const w of all.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    const t = w.team;
    if (!out.has(String(t.id))) out.set(String(t.id), { id: String(t.id), name: t.displayName, short: t.shortDisplayName ?? t.displayName, conference: "Other Division I", logo: logoFor(String(t.id)) });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- RotoWire depth charts ----------

// RotoWire name (normalized) -> the shorter name ESPN uses; both sides go through teamKey()
const ALIASES: Record<string, string> = {
  centralflorida: "ucf", connecticut: "uconn", texassanantonio: "utsa", pittsburgh: "pitt", louisianastate: "lsu",
  northcarolinastate: "ncstate", mississippi: "olemiss", southerncalifornia: "usc", stjohnsny: "stjohns",
};
const teamKey = (s: string) => { const k = norm(s); return ALIASES[k] ?? k; };

async function rotowireIndex(): Promise<Map<string, string>> {
  const html = await getText(`${RW}/cbasketball/college-basketball-depth-charts/`, 12 * 3600);
  const map = new Map<string, string>();
  for (const m of html.matchAll(/<a class="depth-charts__team" href="([^"]+)">\s*<img[^>]*alt="([^"]*)"/g)) map.set(teamKey(m[2]), m[1]);
  return map;
}

/** [PG..C] -> ordered player names, as RotoWire lists them (starter first). */
async function rotowireDepth(path: string): Promise<Record<NbaPos, string[]> | null> {
  const html = await getText(`${RW}${path}`, 3600);
  const out = { PG: [], SG: [], SF: [], PF: [], C: [] } as Record<NbaPos, string[]>;
  let found = 0;
  for (const blk of html.split('class="depth-charts__pos col"').slice(1)) {
    const pos = blk.match(/<span class="normal text-90">(\w+)<\/span>/)?.[1] as NbaPos | undefined;
    if (!pos || !POSITIONS.includes(pos)) continue;
    for (const m of blk.split("</ul>")[0].matchAll(/<a href="\/cbasketball\/player\/[^"]*">\s*([^<]+?)\s*<\/a>/g)) out[pos].push(m[1].replace(/\s+/g, " "));
    found++;
  }
  return found >= 5 ? out : null;
}

// ---------- ESPN stats ----------

async function espnStats(id: string): Promise<Map<string, NbaStats>> {
  const html = await getText(`https://www.espn.com/mens-college-basketball/team/stats/_/id/${id}`, 1800);
  const m = html.match(/window\['__espnfitt__'\]\s*=\s*(\{[\s\S]*?\});<\/script>/);
  const out = new Map<string, NbaStats>();
  if (!m) return out;
  const ps: any[][] = JSON.parse(m[1]).page?.content?.stats?.playerStats ?? [];
  const idOf = (row: any) => row.athlete?.uid?.match(/a:(\d+)/)?.[1];
  const pick = (row: any) => { const o: Record<string, string> = {}; for (const s of row.statGroups?.stats ?? []) o[s.abbreviation] = s.displayValue; return o; };
  for (const row of ps[0] ?? []) {
    const pid = idOf(row); if (!pid) continue;
    const g = pick(row);
    out.set(pid, { gp: num(g.GP), mpg: num(g.MIN), ppg: num(g.PTS), rpg: num(g.REB), apg: num(g.AST), fg: null, tp: null });
  }
  for (const row of ps[1] ?? []) {
    const s = out.get(idOf(row) ?? ""); if (!s) continue;
    const g = pick(row); s.fg = num(g["FG%"]); s.tp = num(g["3P%"]);
  }
  return out;
}

// ---------- team payload ----------

const rosterPos = (abbr?: string): string[] => (abbr === "G" ? ["PG", "SG"] : abbr === "C" ? ["C"] : ["SF", "PF"]);

export async function getNcaabTeam(id: string): Promise<NcaabTeamPayload | null> {
  if (!/^\d+$/.test(id)) return null;
  const warnings: string[] = [];
  const [roster, stats, teams, rwIndex] = await Promise.all([
    getJson<any>(`${ESPN}/teams/${id}/roster`, 900),
    espnStats(id).catch((e) => { warnings.push(`Season stats unavailable (${e.message}).`); return new Map<string, NbaStats>(); }),
    listNcaabTeams().catch(() => [] as NcaabTeamRow[]),
    rotowireIndex().catch(() => new Map<string, string>()),
  ]);
  const team = teams.find((t) => t.id === id);
  const teamName = roster.team?.displayName ?? team?.name ?? "Team";
  const short = roster.team?.shortDisplayName ?? team?.short ?? teamName;

  const players = new Map<string, NcaabPlayer>();
  for (const a of roster.athletes ?? []) {
    const inj = a.injuries?.[0];
    players.set(String(a.id), {
      id: String(a.id), name: a.displayName, number: a.jersey ?? null, pos: rosterPos(a.position?.abbreviation),
      cls: a.experience?.abbreviation, height: a.displayHeight,
      injury: inj ? { status: inj.status ?? "Out", note: inj.details?.type ?? inj.shortComment } : undefined,
      stats: stats.get(String(a.id)),
    });
  }
  const byName = new Map([...players.values()].map((p) => [norm(p.name), p]));
  const findPlayer = (name: string): NcaabPlayer | undefined => {
    const n = norm(name);
    const exact = byName.get(n);
    if (exact) return exact;
    const [first, ...rest] = name.split(" ");
    const last = norm(rest.join(" "));
    const cands = [...players.values()].filter((p) => norm(p.name.split(" ").slice(1).join(" ")) === last && last);
    return cands.find((p) => norm(p.name)[0] === norm(first)[0]) ?? (cands.length === 1 ? cands[0] : undefined);
  };

  const depth: NbaDepth = { PG: [], SG: [], SF: [], PF: [], C: [] };
  let estimated = false;
  let sourceName = "RotoWire";
  let sourceUrl = `${RW}/cbasketball/college-basketball-depth-charts/`;
  const location = roster.team?.location as string | undefined;
  const candidates = [location, short, team?.short, teamName.replace(new RegExp(`\\s+${(roster.team?.name ?? "$^").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "")].filter(Boolean) as string[];
  const rwPath = candidates.map((c) => rwIndex.get(teamKey(c))).find(Boolean);
  let rw: Record<NbaPos, string[]> | null = null;
  if (rwPath) {
    try { rw = await rotowireDepth(rwPath); sourceUrl = `${RW}${rwPath}`; } catch (e) { warnings.push(`RotoWire depth chart unavailable (${(e as Error).message}).`); }
  }

  if (rw) {
    const appear = new Map<string, { pos: NbaPos; idx: number }[]>();
    for (const pos of POSITIONS) {
      rw[pos].forEach((name, idx) => {
        let p = findPlayer(name);
        if (!p) {
          p = { id: `rw-${norm(name)}`, name, number: null, pos: [pos] };
          players.set(p.id, p);
          warnings.push(`${name} isn't on the ESPN roster; stats unavailable.`);
        }
        if (!depth[pos].includes(p.id)) depth[pos].push(p.id);
        (appear.get(p.id) ?? appear.set(p.id, []).get(p.id)!).push({ pos, idx });
      });
    }
    for (const [pid, apps] of appear) {
      apps.sort((a, b) => a.idx - b.idx || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
      players.get(pid)!.pos = apps.map((x) => x.pos);
    }
  } else {
    // no depth chart source for this team: estimate from ESPN position + minutes
    estimated = true;
    sourceName = "Estimated from ESPN roster & minutes";
    sourceUrl = `https://www.espn.com/mens-college-basketball/team/roster/_/id/${id}`;
    const cls = new Map<string, string>(); // ESPN class: G / F / C
    for (const a of roster.athletes ?? []) cls.set(String(a.id), a.position?.abbreviation ?? "F");
    const list = [...players.values()].filter((p) => !p.injury);
    const mpg = (p: NcaabPlayer) => p.stats?.mpg ?? -1;
    const BASE: Record<string, Record<NbaPos, number>> = {
      G: { PG: 3, SG: 3, SF: 1, PF: 0, C: 0 },
      F: { PG: 0, SG: 1, SF: 3, PF: 3, C: 1 },
      C: { PG: 0, SG: 0, SF: 1, PF: 2, C: 3 },
    };
    const score = (p: NcaabPlayer, pos: NbaPos) => {
      const b = (BASE[cls.get(p.id) ?? "F"] ?? BASE.F)[pos];
      return b + (pos === "PG" ? (p.stats?.apg ?? 0) / 8 : 0) + (pos === "C" ? (p.stats?.rpg ?? 0) / 30 : 0);
    };
    // five distinct starters: the top five by minutes, seated by the best-fit permutation
    const top = [...list].sort((x, y) => mpg(y) - mpg(x)).slice(0, 5);
    const perms = (arr: number[]): number[][] => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r])));
    let best: number[] = [], bestScore = -1;
    for (const perm of perms([0, 1, 2, 3, 4].slice(0, top.length))) {
      const sc = perm.reduce((sum, pi, k) => sum + score(top[pi], POSITIONS[k]), 0);
      if (sc > bestScore) { bestScore = sc; best = perm; }
    }
    const starters = new Set<string>();
    best.forEach((pi, k) => { depth[POSITIONS[k]].push(top[pi].id); starters.add(top[pi].id); });
    const rest = list.filter((p) => !starters.has(p.id)).sort((x, y) => mpg(y) - mpg(x));
    for (const pos of POSITIONS) {
      depth[pos].push(...rest.filter((p) => score(p, pos) >= 1).slice(0, MAX_DEPTH - 1).map((p) => p.id));
    }
    const appear = new Map<string, NbaPos[]>();
    for (const pos of POSITIONS) for (const pid of depth[pos]) (appear.get(pid) ?? appear.set(pid, []).get(pid)!).push(pos);
    for (const [pid, ps] of appear) players.get(pid)!.pos = ps;
    warnings.push("No depth chart source covers this team — lineup is estimated from ESPN positions and minutes.");
  }
  for (const pos of POSITIONS) depth[pos] = depth[pos].slice(0, MAX_DEPTH);

  return {
    team: { id, name: teamName, logo: logoFor(id), conference: team?.conference },
    players: [...players.values()], depth, estimated,
    source: { name: sourceName, url: sourceUrl }, warnings: [...new Set(warnings)],
  };
}

// ---------- search / add player ----------

export async function searchNcaabPlayers(q: string) {
  const r = await getJson<any>(
    `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=12&type=player&sport=basketball&league=mens-college-basketball`, 300);
  return (r.items ?? []).map((i: any) => ({
    id: String(i.id), name: i.displayName, pos: i.position?.abbreviation ?? "", number: i.jersey ?? null, team: i.teamRelationships?.[0]?.core?.displayName ?? null,
  }));
}

export async function getNcaabPlayer(id: string): Promise<NcaabPlayer | null> {
  if (!/^\d+$/.test(id)) return null;
  const [a, o] = await Promise.all([
    getJson<any>(`https://site.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes/${id}`, 900).catch(() => null),
    getJson<any>(`https://site.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes/${id}/overview`, 900).catch(() => null),
  ]);
  const ath = a?.athlete;
  if (!ath) return null;
  const p: NcaabPlayer = { id: String(ath.id), name: ath.displayName, number: ath.jersey ?? null, pos: rosterPos(ath.position?.abbreviation), cls: ath.experience?.abbreviation, height: ath.displayHeight };
  const st = o?.statistics;
  const season = st?.splits?.find((s: any) => s.displayName === "Regular Season");
  if (st && season) {
    const m: Record<string, string> = {};
    st.labels.forEach((l: string, i: number) => (m[l] = season.stats[i]));
    p.stats = { gp: num(m.GP), mpg: num(m.MIN), ppg: num(m.PTS), rpg: num(m.REB), apg: num(m.AST), fg: num(m["FG%"]), tp: num(m["3P%"]) };
  }
  return p;
}
