// Soccer adapter: FotMob team/league/match/player pages (server-rendered __NEXT_DATA__).

export interface League { id: number; slug: string; name: string; country: string }
export const LEAGUES: League[] = [
  { id: 47, slug: "premier-league", name: "Premier League", country: "England" },
  { id: 87, slug: "laliga", name: "LaLiga", country: "Spain" },
  { id: 55, slug: "serie-a", name: "Serie A", country: "Italy" },
  { id: 54, slug: "bundesliga", name: "Bundesliga", country: "Germany" },
  { id: 53, slug: "ligue-1", name: "Ligue 1", country: "France" },
  { id: 57, slug: "eredivisie", name: "Eredivisie", country: "Netherlands" },
  { id: 61, slug: "liga-portugal", name: "Liga Portugal", country: "Portugal" },
  { id: 64, slug: "premiership", name: "Scottish Premiership", country: "Scotland" },
  { id: 71, slug: "super-lig", name: "Süper Lig", country: "Türkiye" },
  { id: 40, slug: "first-division-a", name: "Belgian Pro League", country: "Belgium" },
  { id: 135, slug: "super-league-1", name: "Super League Greece", country: "Greece" },
  { id: 38, slug: "bundesliga", name: "Austrian Bundesliga", country: "Austria" },
  { id: 69, slug: "super-league", name: "Swiss Super League", country: "Switzerland" },
  { id: 46, slug: "superligaen", name: "Danish Superliga", country: "Denmark" },
  { id: 48, slug: "championship", name: "Championship", country: "England" },
];

export interface SoccerPlayer {
  id: string;
  name: string;
  number: string | null;
  pos: string[]; // primary first: GK CB LB RB CDM CM CAM LM RM LW RW ST ...
  foot?: "L" | "R" | "B";
  rating: number | null; // FotMob season rating
  headshot: string;
  nat?: string;
  injury?: { status: string; note?: string };
  group?: "GK" | "DEF" | "MID" | "ATT";
}

export interface SoccerTeamPayload {
  team: { id: number; name: string; logo: string; league?: string; coach?: string };
  players: SoccerPlayer[];
  formation: string;
  xi: (string | null)[]; // GK, then each line back-to-front, each line left-to-right
  basedOn?: string; // e.g. "Last match: 1-0 vs Hull"
  source: { name: string; url: string };
  warnings: string[];
}

const UA = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};
const FM = "https://www.fotmob.com";
const photo = (id: number | string) => `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
const logo = (id: number | string) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

async function getText(url: string, ttl: number): Promise<string> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from fotmob.com`);
  return res.text();
}
async function getNextData(url: string, ttl: number): Promise<any> {
  const html = await getText(url, ttl);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("FotMob page data not found");
  return JSON.parse(m[1]).props.pageProps;
}

export async function getLeagueTeams(leagueId: number) {
  const lg = LEAGUES.find((l) => l.id === leagueId);
  if (!lg) return null;
  const pp = await getNextData(`${FM}/leagues/${lg.id}/overview/${lg.slug}`, 6 * 3600);
  const all: any[] = pp.table?.[0]?.data?.table?.all ?? pp.table?.[0]?.data?.tables?.[0]?.table?.all ?? [];
  if (!all.length) throw new Error("No teams found for league");
  return all
    .map((t) => ({ id: t.id as number, name: t.name as string, logo: logo(t.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const GROUP: Record<string, SoccerPlayer["group"]> = { keepers: "GK", defenders: "DEF", midfielders: "MID", attackers: "ATT" };
const USUAL = ["GK", "DEF", "MID", "ATT"] as const;
const FALLBACK_POS: Record<string, string> = { GK: "GK", DEF: "CB", MID: "CM", ATT: "ST" };

export async function getSoccerTeam(teamId: number): Promise<SoccerTeamPayload> {
  const warnings: string[] = [];
  const pp = await getNextData(`${FM}/teams/${teamId}/squad/team`, 900);
  const t = pp.fallback?.[`team-${teamId}`];
  if (!t) throw new Error("Team not found");

  const players = new Map<string, SoccerPlayer>();
  let coach: string | undefined;
  for (const g of t.squad?.squad ?? []) {
    if (g.title === "coach") { coach = g.members?.[0]?.name; continue; }
    for (const m of g.members ?? []) {
      const pos = String(m.positionIdsDesc ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      players.set(String(m.id), {
        id: String(m.id), name: m.name, number: m.shirtNumber != null ? String(m.shirtNumber) : null,
        pos: pos.length ? pos : [FALLBACK_POS[GROUP[g.title] ?? "MID"]],
        rating: typeof m.rating === "number" ? m.rating : null,
        headshot: photo(m.id), nat: m.ccode, group: GROUP[g.title],
        injury: m.injury ? { status: "Injured", note: m.injury.expectedReturn ? `Expected back: ${m.injury.expectedReturn}` : undefined } : undefined,
      });
    }
  }

  // last match: formation + who started, in slot order
  let formation = "4-3-3";
  let xi: (string | null)[] = [];
  let basedOn: string | undefined;
  const last = t.overview?.lastMatch;
  if (last?.pageUrl) {
    try {
      const mp = await getNextData(`${FM}${String(last.pageUrl).split("#")[0]}`, 1800);
      const lu = mp.content?.lineup;
      const side = [lu?.homeTeam, lu?.awayTeam].find((s: any) => s?.id === teamId);
      if (side?.starters?.length === 11) {
        formation = side.formation || formation;
        const opp = last.home?.id === teamId ? last.away : last.home;
        const gk = side.starters.find((s: any) => s.positionId === 11 || s.usualPlayingPositionId === 0) ?? side.starters[0];
        const field = side.starters.filter((s: any) => s !== gk);
        // cluster outfield starters into lines by pitch depth, then order each line left-to-right
        // (FotMob's vertical layout is mirrored for a GK-at-bottom view, hence x descending)
        const sorted = [...field].sort((a: any, b: any) => a.verticalLayout.y - b.verticalLayout.y);
        const lines: any[][] = [];
        for (const p of sorted) {
          const cur = lines[lines.length - 1];
          if (cur && Math.abs(p.verticalLayout.y - cur[cur.length - 1].verticalLayout.y) < 0.08) cur.push(p);
          else lines.push([p]);
        }
        const digits = formation.split("-").map(Number);
        const ok = lines.length === digits.length && lines.every((l, i) => l.length === digits[i]);
        let ordered: any[];
        if (ok) ordered = lines.flatMap((l) => l.sort((a, b) => b.verticalLayout.x - a.verticalLayout.x));
        else {
          // layout didn't match the formation digits: slice by depth, still left-to-right per line
          ordered = []; let i = 0;
          for (const n of digits) ordered.push(...sorted.slice(i, i + n).sort((a, b) => b.verticalLayout.x - a.verticalLayout.x)), i += n;
        }
        for (const s of [gk, ...ordered]) {
          const id = String(s.id);
          if (!players.has(id)) {
            const g = USUAL[s.usualPlayingPositionId] ?? "MID";
            players.set(id, { id, name: s.name, number: s.shirtNumber ?? null, pos: [FALLBACK_POS[g]], rating: null, headshot: photo(id), nat: s.countryCode, group: g });
            warnings.push(`${s.name} wasn't in the squad list; positions estimated.`);
          }
          xi.push(id);
        }
        basedOn = `Last match: ${last.status?.scoreStr ?? ""} ${last.home?.id === teamId ? "vs" : "at"} ${opp?.name ?? ""}`.replace(/\s+/g, " ").trim();
      }
    } catch (e) {
      warnings.push(`Couldn't load last match lineup (${(e as Error).message}); using a standard 4-3-3.`);
    }
  } else warnings.push("No recent match found; using a standard 4-3-3.");

  return {
    team: { id: teamId, name: t.details?.name ?? "", logo: logo(teamId), league: t.details?.primaryLeagueName, coach },
    players: [...players.values()], formation, xi, basedOn,
    source: { name: "FotMob", url: `${FM}/teams/${teamId}/squad/${t.details?.seopath ?? ""}` },
    warnings: [...new Set(warnings)],
  };
}

// ---------- players ----------

const footFrom = (text: string): "L" | "R" | "B" | undefined => {
  const m = text.match(/"fallback":"(Left|Right|Both)"\},"title":"Preferred foot"/);
  return m ? (m[1] === "Left" ? "L" : m[1] === "Right" ? "R" : "B") : undefined;
};

/** Preferred foot lives only on the (large) player page; callers cache it. */
export async function getSoccerFoot(id: string): Promise<{ id: string; foot: "L" | "R" | "B" | null } | null> {
  if (!/^\d+$/.test(id)) return null;
  const text = await getText(`${FM}/players/${id}/p`, 30 * 86400);
  return { id, foot: footFrom(text) ?? null };
}

export async function searchSoccerPlayers(q: string) {
  const res = await fetch(`${FM}/api/data/search/suggest?term=${encodeURIComponent(q)}&lang=en`, { headers: UA, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from fotmob.com`);
  const data: any[] = await res.json();
  const all = data.find((g) => g.title?.key === "all")?.suggestions ?? data.flatMap((g) => g.suggestions ?? []);
  return all.filter((s: any) => s.type === "player" && !s.isCoach).slice(0, 12)
    .map((s: any) => ({ id: String(s.id), name: s.name, pos: "", number: null, team: s.teamName ?? null }));
}

export async function getSoccerPlayer(id: string): Promise<SoccerPlayer | null> {
  if (!/^\d+$/.test(id)) return null;
  const pp = await getNextData(`${FM}/players/${id}/p`, 3600).catch(() => null);
  const d = pp?.data;
  if (!d || d.isCoach) return null;
  const info: Record<string, any> = {};
  for (const i of d.playerInformation ?? []) info[i.title] = i.value;
  const positions: string[] = (d.positionDescription?.positions ?? [])
    .sort((a: any, b: any) => Number(b.isMainPosition) - Number(a.isMainPosition) || b.occurences - a.occurences)
    .map((p: any) => ({ AM: "CAM", DM: "CDM" } as Record<string, string>)[p.strPosShort?.label] ?? p.strPosShort?.label).filter(Boolean);
  const rating = (d.mainLeague?.stats ?? []).find((s: any) => s.localizedTitleId === "rating")?.value;
  const foot = info["Preferred foot"]?.fallback;
  return {
    id: String(d.id), name: d.name, number: info["Shirt"]?.numberValue != null ? String(info["Shirt"].numberValue) : null,
    pos: positions.length ? positions : ["CM"], rating: typeof rating === "number" ? rating : null,
    foot: foot === "Left" ? "L" : foot === "Right" ? "R" : foot === "Both" ? "B" : undefined,
    headshot: photo(d.id), nat: info["Country"]?.countryCode,
    injury: d.injuryInformation ? { status: "Injured", note: typeof d.injuryInformation.expectedReturn === "string" ? `Expected back: ${d.injuryInformation.expectedReturn}` : undefined } : undefined,
  };
}
