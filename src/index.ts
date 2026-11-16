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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", sport, ...]
    if (parts[0] !== "api") return env.ASSETS.fetch(request);

    try {
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
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 502, 0);
    }
  },
} satisfies ExportedHandler<Env>;
