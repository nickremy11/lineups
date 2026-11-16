import { getNcaabPlayer, getNcaabTeam, listNcaabTeams, searchNcaabPlayers } from "./sports/ncaab";
import { LEAGUES, getLeagueTeams, getSoccerFoot, getSoccerPlayer, getSoccerTeam, searchSoccerPlayers } from "./sports/soccer";
import { getNflPlayer, getNflTeam, listNflTeams, searchNflPlayers } from "./sports/nfl";
import { getNbaPlayer, getNbaTeam, listNbaTeams, searchNbaPlayers } from "./sports/nba";
import { getPlayer, getTeam, listTeams, searchPlayers } from "./sports/nhl";

interface Env { ASSETS: Fetcher }

const json = (data: unknown, status = 200, maxAge = 60) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
  });

// Same-origin image proxy (allowlisted hosts only) so the screenshot feature can read headshots without CORS taint.
const IMG_HOSTS = new Set(["assets.nhle.com", "a.espncdn.com", "images.fotmob.com"]);
async function proxyImage(url: URL): Promise<Response> {
  let target: URL;
  try { target = new URL(url.searchParams.get("u") ?? ""); } catch { return json({ error: "bad url" }, 400, 0); }
  if (target.protocol !== "https:" || !IMG_HOSTS.has(target.hostname)) return json({ error: "host not allowed" }, 403, 0);
  const up = await fetch(target.toString(), { headers: { "user-agent": "Mozilla/5.0 (compatible; lineups-app)" }, cf: { cacheTtl: 86400, cacheEverything: true } });
  const type = up.headers.get("content-type") ?? "";
  if (!up.ok || !type.startsWith("image/")) return json({ error: `upstream ${up.status}` }, 502, 0);
  return new Response(up.body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", sport, ...]
    if (parts[0] !== "api") return env.ASSETS.fetch(request);

    try {
      if (parts[1] === "img") return await proxyImage(url);
      if (parts[1] === "nhl") {
        if (parts[2] === "teams" && !parts[3]) return json(listTeams(), 200, 3600);
        if (parts[2] === "teams" && parts[3]) {
          const team = await getTeam(parts[3]);
          return team ? json(team, 200, 120) : json({ error: "Unknown team" }, 404);
        }
        if (parts[2] === "search") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return q.length < 2 ? json([]) : json(await searchPlayers(q), 200, 300);
        }
        if (parts[2] === "player" && parts[3]) {
          const p = await getPlayer(parts[3]);
          return p ? json(p, 200, 300) : json({ error: "Player not found" }, 404);
        }
      }
      if (parts[1] === "nba") {
        if (parts[2] === "teams" && !parts[3]) return json(listNbaTeams(), 200, 3600);
        if (parts[2] === "teams" && parts[3]) {
          const team = await getNbaTeam(parts[3]);
          return team ? json(team, 200, 120) : json({ error: "Unknown team" }, 404);
        }
        if (parts[2] === "search") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return q.length < 2 ? json([]) : json(await searchNbaPlayers(q), 200, 300);
        }
        if (parts[2] === "player" && parts[3]) {
          const p = await getNbaPlayer(parts[3]);
          return p ? json(p, 200, 300) : json({ error: "Player not found" }, 404);
        }
      }
      if (parts[1] === "nfl") {
        if (parts[2] === "teams" && !parts[3]) return json(listNflTeams(), 200, 3600);
        if (parts[2] === "teams" && parts[3]) {
          const team = await getNflTeam(parts[3]);
          return team ? json(team, 200, 120) : json({ error: "Unknown team" }, 404);
        }
        if (parts[2] === "search") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return q.length < 2 ? json([]) : json(await searchNflPlayers(q), 200, 300);
        }
        if (parts[2] === "player" && parts[3]) {
          const p = await getNflPlayer(parts[3]);
          return p ? json(p, 200, 300) : json({ error: "Player not found" }, 404);
        }
      }
      if (parts[1] === "soccer") {
        if (parts[2] === "leagues" && !parts[3]) return json(LEAGUES, 200, 3600);
        if (parts[2] === "leagues" && parts[3] && parts[4] === "teams") {
          const teams = await getLeagueTeams(Number(parts[3]));
          return teams ? json(teams, 200, 3600) : json({ error: "Unknown league" }, 404);
        }
        if (parts[2] === "teams" && parts[3] && /^\d+$/.test(parts[3])) return json(await getSoccerTeam(Number(parts[3])), 200, 120);
        if (parts[2] === "search") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return q.length < 2 ? json([]) : json(await searchSoccerPlayers(q), 200, 300);
        }
        if (parts[2] === "foot" && parts[3]) {
          const f = await getSoccerFoot(parts[3]);
          return f ? json(f, 200, 86400) : json({ error: "Bad id" }, 400);
        }
        if (parts[2] === "player" && parts[3]) {
          const p = await getSoccerPlayer(parts[3]);
          return p ? json(p, 200, 300) : json({ error: "Player not found" }, 404);
        }
      }
      if (parts[1] === "ncaab") {
        if (parts[2] === "teams" && !parts[3]) return json(await listNcaabTeams(), 200, 3600);
        if (parts[2] === "teams" && parts[3]) {
          const team = await getNcaabTeam(parts[3]);
          return team ? json(team, 200, 120) : json({ error: "Unknown team" }, 404);
        }
        if (parts[2] === "search") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return q.length < 2 ? json([]) : json(await searchNcaabPlayers(q), 200, 300);
        }
        if (parts[2] === "player" && parts[3]) {
          const p = await getNcaabPlayer(parts[3]);
          return p ? json(p, 200, 300) : json({ error: "Player not found" }, 404);
        }
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 502, 0);
    }
  },
} satisfies ExportedHandler<Env>;
