import { NBA_TEAMS } from "./nba-teams";

export type NbaPos = "PG" | "SG" | "SF" | "PF" | "C";
const POSITIONS: NbaPos[] = ["PG", "SG", "SF", "PF", "C"];
const MAX_DEPTH = 4;

export interface NbaStats {
  gp: number | null; mpg: number | null; ppg: number | null; rpg: number | null;
  apg: number | null; fg: number | null; tp: number | null; // fg/tp are percentages, e.g. 41.3
}
export interface NbaPlayer {
  id: string;
  name: string;
  number: string | null;
  pos: string[]; // primary first, then secondary positions
  headshot?: string;
  injury?: { status: string; note?: string };
  stats?: NbaStats;
}
export type NbaDepth = Record<NbaPos, string[]>; // starter first, then backups

export interface NbaTeamPayload {
  team: { abbrev: string; name: string; logo: string };
  players: NbaPlayer[];
  depth: NbaDepth;
  source: { name: string; url: string };
  warnings: string[];
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" };
const logoFor = (espn: string) => `https://a.espncdn.com/i/teamlogos/nba/500/${espn}.png`;

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json() as Promise<T>;
}

/** ESPN pages embed their state as window['__espnfitt__'] = {...}; */
async function getEspnPage(url: string, ttl: number): Promise<any> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from espn.com`);
  const m = (await res.text()).match(/window\['__espnfitt__'\]\s*=\s*(\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error("ESPN page data not found");
  return JSON.parse(m[1]).page.content;
}

const idFromUid = (uid?: string) => uid?.match(/a:(\d+)/)?.[1];
const num = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };

function parseStats(content: any): Map<string, NbaStats> {
  const out = new Map<string, NbaStats>();
  const [general = [], shooting = []] = content.stats?.playerStats ?? [];
  const pick = (row: any) => {
    const m: Record<string, string> = {};
    for (const s of row.statGroups?.stats ?? []) m[s.abbreviation] = s.displayValue;
    return m;
  };
  for (const row of general) {
    const id = idFromUid(row.athlete?.uid);
    if (!id) continue;
    const g = pick(row);
    out.set(id, { gp: num(g.GP), mpg: num(g.MIN), ppg: num(g.PTS), rpg: num(g.REB), apg: num(g.AST), fg: null, tp: null });
  }
  for (const row of shooting) {
    const id = idFromUid(row.athlete?.uid);
    const s = id && out.get(id);
    if (!s) continue;
    const m = pick(row);
    s.fg = num(m["FG%"]); s.tp = num(m["3P%"]);
  }
  return out;
}

const roster2pos = (abbr?: string): string[] => (abbr === "G" ? ["SG"] : abbr === "C" ? ["C"] : abbr === "F" ? ["SF"] : ["SF"]);

export async function getNbaTeam(abbrevRaw: string): Promise<NbaTeamPayload | null> {
  const team = NBA_TEAMS.find((t) => t.abbrev === abbrevRaw.toUpperCase());
  if (!team) return null;
  const warnings: string[] = [];
  const e = team.espn;

  const [roster, depthPage, statsPage] = await Promise.all([
    getJson<any>(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${e}/roster`, 600),
    getEspnPage(`https://www.espn.com/nba/team/depth/_/name/${e}`, 600),
    getEspnPage(`https://www.espn.com/nba/team/stats/_/name/${e}`, 900).catch((err) => {
      warnings.push(`Season stats unavailable (${err.message}).`);
      return {};
    }),
  ]);
  const stats = parseStats(statsPage);

  const players = new Map<string, NbaPlayer>();
  for (const a of roster.athletes ?? []) {
    const inj = a.injuries?.[0];
    players.set(String(a.id), {
      id: String(a.id), name: a.displayName, number: a.jersey ?? null,
      pos: roster2pos(a.position?.abbreviation), headshot: a.headshot?.href,
      injury: inj ? { status: inj.status ?? a.status?.name ?? "Out", note: inj.details?.type ?? inj.shortComment } : undefined,
      stats: stats.get(String(a.id)),
    });
  }

  // depth chart rows: [label, ...athletes]; starter first
  const depth: NbaDepth = { PG: [], SG: [], SF: [], PF: [], C: [] };
  const rows: any[][] = depthPage.depth?.dethTeamGroups?.[0]?.rows ?? [];
  const appearances = new Map<string, { pos: NbaPos; idx: number }[]>();
  for (const row of rows) {
    const pos = String(row[0]).toUpperCase() as NbaPos;
    if (!POSITIONS.includes(pos)) continue;
    row.slice(1).forEach((a: any, idx: number) => {
      const id = idFromUid(a?.uid);
      if (!id) return;
      if (!players.has(id)) {
        players.set(id, { id, name: a.displayName ?? a.name, number: null, pos: [pos], stats: stats.get(id) });
        warnings.push(`${a.displayName} isn't on the roster feed; details limited.`);
      }
      const p = players.get(id)!;
      if (!p.injury && a.injuries?.length) p.injury = { status: a.injuries[0].status ?? "Out" };
      if (!depth[pos].includes(id)) depth[pos].push(id);
      (appearances.get(id) ?? appearances.set(id, []).get(id)!).push({ pos, idx });
    });
  }
  if (!rows.length) warnings.push("ESPN depth chart was empty.");
  // ESPN lists everyone at every position they could play; keep starter + 3 backups per position
  for (const pos of POSITIONS) depth[pos] = depth[pos].slice(0, MAX_DEPTH);

  // primary position = where the player ranks highest on the depth chart; others become secondary
  for (const [id, apps] of appearances) {
    apps.sort((a, b) => a.idx - b.idx || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
    players.get(id)!.pos = apps.map((x) => x.pos);
  }

  return {
    team: { abbrev: team.abbrev, name: team.name, logo: logoFor(team.espn) },
    players: [...players.values()], depth,
    source: { name: "ESPN", url: `https://www.espn.com/nba/team/depth/_/name/${e}` },
    warnings: [...new Set(warnings)],
  };
}

export const listNbaTeams = () =>
  NBA_TEAMS.map((t) => ({ abbrev: t.abbrev, name: t.name, conference: t.conference, division: t.division, logo: logoFor(t.espn) }));

export async function searchNbaPlayers(q: string) {
  const r = await getJson<any>(
    `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=12&type=player&sport=basketball&league=nba`, 300);
  return (r.items ?? []).map((i: any) => ({
    id: String(i.id), name: i.displayName, pos: i.position?.abbreviation ?? "", number: i.jersey ?? null, team: i.teamRelationships?.[0]?.core?.abbreviation ?? null,
  }));
}

export async function getNbaPlayer(id: string): Promise<NbaPlayer | null> {
  if (!/^\d+$/.test(id)) return null;
  const [a, o] = await Promise.all([
    getJson<any>(`https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}`, 900).catch(() => null),
    getJson<any>(`https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/overview`, 900).catch(() => null),
  ]);
  const ath = a?.athlete;
  if (!ath) return null;
  const p: NbaPlayer = {
    id: String(ath.id), name: ath.displayName, number: ath.jersey ?? null,
    pos: roster2pos(ath.position?.abbreviation), headshot: ath.headshot?.href,
  };
  const st = o?.statistics;
  const season = st?.splits?.find((s: any) => s.displayName === "Regular Season");
  if (st && season) {
    const m: Record<string, string> = {};
    st.labels.forEach((l: string, i: number) => (m[l] = season.stats[i]));
    p.stats = { gp: num(m.GP), mpg: num(m.MIN), ppg: num(m.PTS), rpg: num(m.REB), apg: num(m.AST), fg: num(m["FG%"]), tp: num(m["3P%"]) };
  }
  return p;
}
