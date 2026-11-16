import { NHL_TEAMS } from "./nhl-teams";
import type { GoalieStats, Lineup, Player, Pos, SkaterStats, TeamPayload } from "./types";

const NHL = "https://api-web.nhle.com/v1";
const DF = "https://www.dailyfaceoff.com/teams";

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" },
    redirect: "follow",
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json() as Promise<T>;
}

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

const logoFor = (abbrev: string) => `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`;

// ---------- NHL API ----------

interface RosterPlayer {
  id: number;
  headshot: string;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber?: number;
  positionCode: string;
  shootsCatches: "L" | "R";
}

function nhlPos(code: string, shoots: "L" | "R"): Pos {
  if (code === "C") return "C";
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  if (code === "G") return "G";
  return shoots === "R" ? "RD" : "LD";
}

const altFor = (pos: Pos): Pos[] => (pos === "C" ? ["LW", "RW"] : []);

async function loadNhlPlayers(abbrev: string): Promise<Player[]> {
  const [roster, stats] = await Promise.all([
    getJson<{ forwards: RosterPlayer[]; defensemen: RosterPlayer[]; goalies: RosterPlayer[] }>(
      `${NHL}/roster/${abbrev}/current`, 900),
    getJson<{ skaters: any[]; goalies: any[] }>(`${NHL}/club-stats/${abbrev}/now`, 900).catch(
      () => ({ skaters: [], goalies: [] }),
    ),
  ]);
  const sk = new Map(stats.skaters.map((s) => [s.playerId, s]));
  const gl = new Map(stats.goalies.map((s) => [s.playerId, s]));
  const all = [...roster.forwards, ...roster.defensemen, ...roster.goalies];
  return all.map((p): Player => {
    const pos = nhlPos(p.positionCode, p.shootsCatches);
    const player: Player = {
      id: String(p.id),
      name: `${p.firstName.default} ${p.lastName.default}`,
      number: p.sweaterNumber ?? null,
      pos,
      alt: altFor(pos),
      shoots: p.shootsCatches,
      headshot: p.headshot,
    };
    const s = sk.get(p.id);
    if (s && pos !== "G") {
      player.skater = {
        gp: s.gamesPlayed, toi: s.avgTimeOnIcePerGame ?? null,
        g: s.goals, a: s.assists, pm: s.plusMinus ?? null,
      };
    }
    const g = gl.get(p.id);
    if (g && pos === "G") {
      player.goalie = {
        gp: g.gamesPlayed, w: g.wins, gaa: g.goalsAgainstAverage ?? null, svp: g.savePercentage ?? null,
      };
    }
    return player;
  });
}

// ---------- DailyFaceoff ----------

interface DfPlayer {
  playerId: number;
  name: string;
  jerseyNumber: number | null;
  positionIdentifier: string;
  groupIdentifier: string;
  injuryStatus: string | null;
  gameTimeDecision: boolean;
  latestNews?: { details?: string } | null;
  season?: { gamesPlayed: number; goals: number; assists: number; toiMinutes: number; toiSeconds: number };
}
interface DfData {
  teamPrimaryColor?: string;
  teamSecondaryColor?: string;
  updatedAt?: string;
  players: DfPlayer[];
}

async function loadDailyFaceoff(slug: string): Promise<DfData> {
  const res = await fetch(`${DF}/${slug}/line-combinations`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`DailyFaceoff ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("DailyFaceoff: __NEXT_DATA__ not found");
  const data = JSON.parse(m[1]).props.pageProps.combinations as DfData;
  if (!data?.players?.length) throw new Error("DailyFaceoff: no players");
  return data;
}

const dfPosToPos = (id: string): Pos | null => {
  switch (id) {
    case "c": return "C";
    case "lw": return "LW";
    case "rw": return "RW";
    case "ld": return "LD";
    case "rd": return "RD";
    case "g": return "G";
    default: return null;
  }
};

interface Placed { p: Player; at: Pos | null }

const fam = (x: Pos) => (x === "LD" || x === "RD" ? "D" : x === "G" ? "G" : "F");

/** Place players into fixed slots, preferring the slot matching DailyFaceoff's label. */
function fill(slotPos: Pos[], group: Placed[]): (string | null)[] {
  const out: (string | null)[] = slotPos.map(() => null);
  const rest: Placed[] = [];
  for (const g of group) {
    const i = slotPos.findIndex((sp, idx) => out[idx] === null && sp === g.at);
    if (i >= 0) out[i] = g.p.id; else rest.push(g);
  }
  for (const g of rest) {
    let i = slotPos.findIndex((sp, idx) => out[idx] === null && fam(sp) === fam(g.p.pos));
    if (i < 0) i = out.findIndex((v) => v === null);
    if (i >= 0) out[i] = g.p.id;
  }
  return out;
}

function buildFromDf(df: DfData, nhl: Player[], warnings: string[]): { players: Player[]; lineup: Lineup } {
  const byName = new Map(nhl.map((p) => [norm(p.name), p]));
  const players = [...nhl];
  const resolve = (d: DfPlayer, setPrimary: boolean): Placed => {
    let p = byName.get(norm(d.name));
    if (!p) {
      const last = norm(d.name.split(" ").slice(-1)[0]);
      p = nhl.find((x) => x.number === d.jerseyNumber && norm(x.name).endsWith(last));
    }
    const at = dfPosToPos(d.positionIdentifier);
    if (!p) {
      // not on NHL roster feed (recent trade / call-up) — build from DF data
      const pos = at ?? "C";
      const s = d.season;
      p = {
        id: `df-${d.playerId}`, name: d.name, number: d.jerseyNumber, pos,
        alt: altFor(pos), shoots: null,
        ...(pos === "G" || !s ? {} : {
          skater: { gp: s.gamesPlayed, g: s.goals, a: s.assists, pm: null,
            toi: s.gamesPlayed ? Math.round((s.toiMinutes * 60 + s.toiSeconds) / s.gamesPlayed) : null } as SkaterStats,
        }),
      };
      players.push(p);
      warnings.push(`${d.name} isn't on the NHL roster feed; stats limited.`);
    } else if (at && at !== p.pos) {
      // DailyFaceoff's slot label is more reliable than NHL's coarse C/L/R/D code
      const prev = p.pos;
      const addAlt = (x: Pos) => { if (x !== (setPrimary ? at : p!.pos) && !p!.alt.includes(x)) p!.alt.push(x); };
      if (setPrimary && fam(at) === fam(prev)) { p.pos = at; addAlt(prev); }
      else addAlt(at);
      if (p.pos === "C") for (const x of altFor("C")) addAlt(x);
    }
    if (d.injuryStatus) {
      p.injury = { status: d.injuryStatus, note: d.latestNews?.details?.trim() };
    } else if (d.gameTimeDecision) {
      p.injury = { status: "GTD", note: d.latestNews?.details?.trim() };
    }
    return { p, at };
  };

  const group = (id: string, setPrimary = false) =>
    df.players.filter((d) => d.groupIdentifier === id).map((d) => resolve(d, setPrimary));

  const lineup: Lineup = { f: [], d: [], g: [], pp: [], pk: [] };
  for (let i = 1; i <= 4; i++) lineup.f.push(fill(["LW", "C", "RW"], group(`f${i}`, true)));
  for (let i = 1; i <= 3; i++) lineup.d.push(fill(["LD", "RD"], group(`d${i}`, true)));
  lineup.g = fill(["G", "G"], group("g", true)).slice(0, 2);
  group("ir"); // resolve so injuries are flagged on bench players
  // special teams: DailyFaceoff labels these sk1..skN with no fixed position mix
  const unit = (id: string, n: number) => {
    const ids = group(id).map((x) => x.p.id).slice(0, n);
    return [...ids, ...Array(n - ids.length).fill(null)] as (string | null)[];
  };
  lineup.pp = [unit("pp1", 5), unit("pp2", 5)];
  lineup.pk = [unit("pk1", 4), unit("pk2", 4)];
  for (const p of players) p.alt = [...new Set(p.alt)].filter((x) => x !== p.pos);
  return { players, lineup };
}

/** Fallback: derive lines from NHL TOI when DailyFaceoff is unavailable. */
function buildFromTois(nhl: Player[]): Lineup {
  const toi = (p: Player) => p.skater?.toi ?? 0;
  const top = (pos: Pos, n: number) => nhl.filter((p) => p.pos === pos).sort((a, b) => toi(b) - toi(a)).slice(0, n);
  const C = top("C", 4), LW = top("LW", 4), RW = top("RW", 4), LD = top("LD", 3), RD = top("RD", 3);
  const G = nhl.filter((p) => p.pos === "G").sort((a, b) => (b.goalie?.gp ?? 0) - (a.goalie?.gp ?? 0)).slice(0, 2);
  const id = (p?: Player) => p?.id ?? null;
  return {
    f: [0, 1, 2, 3].map((i) => [id(LW[i]), id(C[i]), id(RW[i])]),
    d: [0, 1, 2].map((i) => [id(LD[i]), id(RD[i])]),
    g: [id(G[0]), id(G[1])],
    pp: [0, 1].map((i) => [id(LW[i]), id(C[i]), id(RW[i]), id(LD[i]), id(RD[i])]),
    pk: [[id(C[0]), id(RW[2]), id(LD[0]), id(RD[0])], [id(C[1]), id(LW[2]), id(LD[1]), id(RD[1])]],
  };
}

// ---------- PuckPedia (positions + secondary positions) ----------

const PP_EMBED = "https://depth-charts.puckpedia.com/light";
const VALID_POS = new Set<string>(["C", "LW", "RW", "LD", "RD", "G"]);

interface PpRow { jersey: number | null; first: string; last: string; pos: Pos[]; shoots: "L" | "R" | null }

/**
 * PuckPedia's depth chart embed has no JSON API, but its table view (/chart) server-renders
 * every roster row — jersey, name, position detail like "C|RW" (primary | secondaries) and
 * handedness — into the RSC payload. Best-effort: returns [] if the layout changes.
 */
async function loadPuckPediaRows(abbrev: string): Promise<PpRow[]> {
  const res = await fetch(`${PP_EMBED}/${abbrev}/chart`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`PuckPedia ${res.status}`);
  const html = await res.text();
  let flight = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { flight += JSON.parse(m[1]); } catch { /* skip malformed chunk */ }
  }
  const rows: PpRow[] = [];
  const seen = new Set<string>();
  for (const row of flight.split('["$","tr",').slice(1)) {
    const detail = row.match(/_position_detail"[\s\S]*?"children":"([A-Z|]+)"/)?.[1];
    const name = row.match(/player\/i\/(\d+)"[\s\S]*?"children":\["([^"]+)",","," ",\["\$","span",null,\{"className":"max-sm:hidden","children":"([^"]+)"/);
    if (!detail || !name || seen.has(name[1])) continue;
    const pos = detail.split("|").filter((x) => VALID_POS.has(x)) as Pos[];
    if (!pos.length) continue;
    seen.add(name[1]);
    const hand = row.match(/_handedness"[\s\S]*?"children":"([LR])"/)?.[1] as "L" | "R" | undefined;
    const jersey = Number(row.match(/_jersey_number"[\s\S]*?"children":"(\d+)"/)?.[1]);
    rows.push({
      jersey: Number.isFinite(jersey) && jersey > 0 ? jersey : null,
      first: norm(name[3]), last: norm(name[2]), pos, shoots: hand ?? null,
    });
  }
  return rows;
}

function applyPuckPedia(players: Player[], rows: PpRow[]): number {
  let n = 0;
  for (const r of rows) {
    const p =
      players.find((x) => norm(x.name) === r.first + r.last) ??
      players.find((x) => x.number === r.jersey && norm(x.name).endsWith(r.last));
    if (!p) continue;
    p.pos = r.pos[0];
    p.alt = r.pos.slice(1);
    if (!p.shoots && r.shoots) p.shoots = r.shoots;
    n++;
  }
  return n;
}

// ---------- Public API ----------

export async function getTeam(abbrevRaw: string): Promise<TeamPayload | null> {
  const abbrev = abbrevRaw.toUpperCase();
  const team = NHL_TEAMS.find((t) => t.abbrev === abbrev);
  if (!team) return null;
  const warnings: string[] = [];
  const nhl = await loadNhlPlayers(abbrev);
  let players = nhl;
  let lineup: Lineup;
  let color: string | undefined, color2: string | undefined, updatedAt: string | null = null;
  let sourceName = "DailyFaceoff";
  try {
    const df = await loadDailyFaceoff(team.dfSlug);
    ({ players, lineup } = buildFromDf(df, nhl, warnings));
    color = df.teamPrimaryColor; color2 = df.teamSecondaryColor; updatedAt = df.updatedAt ?? null;
  } catch (e) {
    warnings.push(`DailyFaceoff unavailable (${(e as Error).message}); lines estimated from NHL ice time.`);
    lineup = buildFromTois(nhl);
    sourceName = "NHL.com (estimated from TOI)";
  }
  try {
    const matched = applyPuckPedia(players, await loadPuckPediaRows(abbrev));
    if (matched < 10) warnings.push("PuckPedia positions unavailable; using estimated positions.");
  } catch (e) {
    warnings.push(`PuckPedia positions unavailable (${(e as Error).message}); using estimated positions.`);
  }
  return {
    team: { abbrev, name: team.name, logo: logoFor(abbrev), color, color2 },
    players, lineup,
    source: { name: sourceName, url: `${DF}/${team.dfSlug}/line-combinations`, updatedAt },
    warnings: [...new Set(warnings)],
  };
}

export const listTeams = () =>
  NHL_TEAMS.map((t) => ({ ...t, logo: logoFor(t.abbrev) }));

export async function searchPlayers(q: string) {
  const res = await getJson<any[]>(
    `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=12&active=true&q=${encodeURIComponent(q)}`, 300);
  return res.map((r) => ({
    id: String(r.playerId), name: r.name, pos: r.positionCode as string,
    team: r.teamAbbrev as string | null, number: r.sweaterNumber as number | null,
  }));
}

export async function getPlayer(id: string): Promise<Player | null> {
  if (!/^\d+$/.test(id)) return null;
  const d = await getJson<any>(`${NHL}/player/${id}/landing`, 900).catch(() => null);
  if (!d) return null;
  const shoots = d.shootsCatches === "R" ? "R" : "L";
  const pos = nhlPos(d.position, shoots);
  const p: Player = {
    id: String(d.playerId),
    name: `${d.firstName.default} ${d.lastName.default}`,
    number: d.sweaterNumber ?? null,
    pos, alt: altFor(pos), shoots, headshot: d.headshot,
  };
  const season = d.featuredStats?.season;
  const sub = d.featuredStats?.regularSeason?.subSeason;
  if (sub) {
    if (pos === "G") {
      p.goalie = { gp: sub.gamesPlayed, w: sub.wins ?? 0, gaa: sub.goalsAgainstAvg ?? null, svp: sub.savePctg ?? null } as GoalieStats;
    } else {
      const row = (d.seasonTotals ?? []).filter((r: any) => r.season === season && r.leagueAbbrev === "NHL" && r.gameTypeId === 2).pop();
      let toi: number | null = null;
      if (row?.avgToi) { const [m, s] = String(row.avgToi).split(":").map(Number); toi = m * 60 + (s || 0); }
      p.skater = { gp: sub.gamesPlayed, toi, g: sub.goals, a: sub.assists, pm: sub.plusMinus ?? null } as SkaterStats;
    }
  }
  return p;
}
