import { NFL_TEAMS } from "./nfl-teams";

export type Unit = "off" | "def" | "st";

export interface NflPlayer {
  id: string;
  name: string;
  number: string | null;
  pos: string; // primary position (ESPN abbreviation, e.g. WR)
  alt: string[]; // other depth-chart slots they appear in
  headshot?: string;
  injury?: { status: string; note?: string };
  key?: string; // Ourlads acquisition key, e.g. "24/2" (2024 draft, round 2), "T/Chi", "SF26"
  tag?: "rookie" | "fa" | "udfa";
  squad?: "PS" | "IR";
}

export interface NflTeamPayload {
  team: { abbrev: string; name: string; logo: string };
  players: NflPlayer[];
  /** slot label -> ids, starter first */
  depth: Record<Unit, Record<string, string[]>>;
  /** slot labels in Ourlads order for each unit */
  labels: Record<Unit, string[]>;
  meta: { offense?: string; defense?: string };
  source: { name: string; url: string };
  warnings: string[];
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" };
const MAX_DEPTH = 4;
const logoFor = (abbrev: string) => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbrev.toLowerCase()}.png`;

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const res = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json() as Promise<T>;
}

// ---------- Ourlads ----------

interface OlCell { id: string; name: string; number: string | null; key: string; tag?: NflPlayer["tag"]; badge?: string }
interface OlRow { label: string; cells: OlCell[] }

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();

/** "Coleman, Keon" / "DAWKINS, DION" -> "Keon Coleman" / "Dion Dawkins" */
function tidyName(raw: string): string {
  const [last, first] = raw.includes(",") ? raw.split(/,(.+)/).map((x) => x.trim()) : ["", raw.trim()];
  const t = (w: string) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.toLowerCase().replace(/(^|[-' ])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : w);
  const fix = (s: string) => s.split(" ").map(t).join(" ").replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
  return [first, last].filter(Boolean).map(fix).join(" ");
}

function parseTables(html: string) {
  const tables: { heading: string; rows: OlRow[] }[] = [];
  const parts = html.split(/(?=<table)/).slice(1);
  let cursor = 0;
  for (const part of parts) {
    const at = html.indexOf(part, cursor);
    const before = html.slice(Math.max(0, at - 600), at);
    cursor = at + 1;
    const heading = decode((before.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>(?![\s\S]*<h[1-4])/)?.[1] ?? "").replace(/<[^>]+>/g, " "));
    const rows: OlRow[] = [];
    for (const tr of part.split("</table>")[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (tds.length < 3) continue;
      const label = decode(tds[0].replace(/<[^>]+>/g, ""));
      const cells: OlCell[] = [];
      for (let i = 1; i + 1 < tds.length; i += 2) {
        const a = tds[i + 1].match(/player\/(\d+)\/'?"?\s*(?:class=['"]([^'"]*)['"])?[^>]*>([^<]*)</);
        const name = a ? decode(a[3]) : "";
        if (!a || a[1] === "0" || !name) continue;
        const cls = a[2] ?? "";
        cells.push({
          id: a[1], name: tidyName(name), number: decode(tds[i].replace(/<[^>]+>/g, "")) || null,
          key: decode(tds[i + 1].match(/dc-key'?"?>([^<]*)</)?.[1] ?? ""),
          badge: tds[i + 1].match(/badge[^>]*>([^<]*)</)?.[1],
          tag: cls.includes("purple") ? "rookie" : cls.includes("gold") ? "fa" : cls.includes("aqua") ? "udfa" : undefined,
        });
      }
      if (label) rows.push({ label, cells });
    }
    tables.push({ heading, rows });
  }
  return tables;
}

// ---------- ESPN ----------

interface EspnAthlete {
  id: string; fullName: string; jersey?: string;
  position?: { abbreviation?: string };
  headshot?: { href?: string };
  injuries?: { status?: string; details?: { type?: string } ; shortComment?: string }[];
}

export async function getNflTeam(abbrevRaw: string): Promise<NflTeamPayload | null> {
  const team = NFL_TEAMS.find((t) => t.abbrev === abbrevRaw.toUpperCase());
  if (!team) return null;
  const warnings: string[] = [];
  const url = `https://www.ourlads.com/nfldepthcharts/depthchart/${team.ourlads}`;

  const [olRes, roster] = await Promise.all([
    fetch(url, { headers: UA, cf: { cacheTtl: 600, cacheEverything: true } }),
    getJson<any>(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.abbrev.toLowerCase()}/roster`, 900)
      .catch((e) => { warnings.push(`ESPN roster unavailable (${e.message}); no headshots or injury data.`); return { athletes: [] }; }),
  ]);
  if (!olRes.ok) throw new Error(`Ourlads ${olRes.status}`);
  const html = await olRes.text();
  const tables = parseTables(html);
  const find = (re: RegExp) => tables.find((t) => re.test(t.heading));
  const off = find(/offense/i), def = find(/defense/i), st = find(/special/i), ps = find(/practice/i), res = find(/reserve/i);
  if (!off || !def) throw new Error("Ourlads layout not recognised");

  // ESPN pool
  const players = new Map<string, NflPlayer>();
  const espnList: { p: NflPlayer; norm: string }[] = [];
  for (const g of roster.athletes ?? []) {
    for (const a of (g.items ?? []) as EspnAthlete[]) {
      const inj = a.injuries?.[0];
      const p: NflPlayer = {
        id: String(a.id), name: a.fullName, number: a.jersey ?? null, pos: a.position?.abbreviation ?? "",
        alt: [], headshot: a.headshot?.href,
        injury: inj ? { status: inj.status ?? "Out", note: inj.details?.type ?? inj.shortComment } : undefined,
        squad: g.position === "practiceSquad" ? "PS" : g.position === "injuredReserveOrOut" ? "IR" : undefined,
      };
      if (p.squad === "IR" && !p.injury) p.injury = { status: "IR" };
      players.set(p.id, p);
      espnList.push({ p, norm: norm(p.name) });
    }
  }

  const byOl = new Map<string, NflPlayer>(); // ourlads id -> player
  const resolve = (c: OlCell, slotLabel: string): NflPlayer => {
    let p = byOl.get(c.id);
    if (!p) {
      const n = norm(c.name);
      const last = n.slice(-4);
      p = espnList.find((e) => e.norm === n)?.p ??
        espnList.find((e) => c.number && e.p.number === c.number && e.norm.endsWith(last))?.p;
      if (!p) {
        p = { id: `o${c.id}`, name: c.name, number: c.number, pos: slotLabel, alt: [] };
        players.set(p.id, p);
      }
      byOl.set(c.id, p);
    }
    if (c.number && !p.number) p.number = c.number;
    if (c.key) p.key = c.key;
    if (c.tag) p.tag = c.tag;
    if (c.badge && !p.injury && /^(IR|PUP|NFI|SUS|OUT|Q|D)$/i.test(c.badge)) p.injury = { status: c.badge.toUpperCase() };
    return p;
  };

  const depth: NflTeamPayload["depth"] = { off: {}, def: {}, st: {} };
  const labels: NflTeamPayload["labels"] = { off: [], def: [], st: [] };
  const appear = new Map<string, string[]>();
  const load = (unit: Unit, table?: { rows: OlRow[] }) => {
    for (const r of table?.rows ?? []) {
      const ids: string[] = [];
      for (const c of r.cells) {
        const p = resolve(c, r.label);
        if (!ids.includes(p.id)) ids.push(p.id);
        const a = appear.get(p.id) ?? appear.set(p.id, []).get(p.id)!;
        if (!a.includes(r.label)) a.push(r.label);
      }
      labels[unit].push(r.label);
      depth[unit][r.label] = ids.slice(0, MAX_DEPTH);
    }
  };
  load("off", off); load("def", def); load("st", st);

  for (const [id, slots] of appear) {
    const p = players.get(id)!;
    if (!p.pos) p.pos = slots[0];
    p.alt = slots.filter((s) => s !== p.pos).slice(0, 3);
  }
  // practice squad / reserves from Ourlads that ESPN didn't flag
  for (const [tbl, squad] of [[ps, "PS"], [res, "IR"]] as const) {
    for (const r of tbl?.rows ?? []) for (const c of r.cells) {
      const p = resolve(c, r.label);
      if (!appear.has(p.id) && !p.squad) p.squad = squad;
      if (squad === "IR" && !p.injury) p.injury = { status: r.label };
    }
  }

  const meta = {
    offense: decode(html.match(/Offense\s*<small><b>([\s\S]*?)<\/b>/)?.[1] ?? "") || undefined,
    defense: decode(html.match(/Defense\s*<small><b>([\s\S]*?)<\/b>/)?.[1] ?? "") || undefined,
  };
  return {
    team: { abbrev: team.abbrev, name: team.name, logo: logoFor(team.abbrev) },
    players: [...players.values()], depth, labels, meta,
    source: { name: "Ourlads", url }, warnings: [...new Set(warnings)],
  };
}

export const listNflTeams = () =>
  NFL_TEAMS.map((t) => ({ abbrev: t.abbrev, name: t.name, conference: t.conference, division: t.division, logo: logoFor(t.abbrev) }));

export async function searchNflPlayers(q: string) {
  const r = await getJson<any>(
    `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=12&type=player&sport=football&league=nfl`, 300);
  return (r.items ?? []).map((i: any) => ({
    id: String(i.id), name: i.displayName, pos: i.position?.abbreviation ?? "", number: i.jersey ?? null, team: i.teamRelationships?.[0]?.core?.abbreviation ?? null,
  }));
}

export async function getNflPlayer(id: string): Promise<NflPlayer | null> {
  if (!/^\d+$/.test(id)) return null;
  const a = (await getJson<any>(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`, 900).catch(() => null))?.athlete;
  if (!a) return null;
  return { id: String(a.id), name: a.displayName, number: a.jersey ?? null, pos: a.position?.abbreviation ?? "", alt: [], headshot: a.headshot?.href };
}
