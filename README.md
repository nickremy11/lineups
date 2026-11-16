# Lineups — lineups.bruisedbanana.dev

Interactive depth charts: start from the current lines, drag players around, add new ones, see "what if".
One Cloudflare Worker serves the static pages and a small data API.

```
public/                 static assets (served by Workers Assets)
  index.html            sport picker
  shared/               CSS shared by all sports
  nhl/                  NHL page (index.html, app.js, nhl.css)   -> /nhl/
src/
  index.ts              router: /api/<sport>/... ; everything else -> assets
  sports/nhl.ts         NHL data adapter (NHL API + DailyFaceoff + PuckPedia)
  sports/nhl-teams.ts   team list (abbrev, DailyFaceoff slug, division)
  sports/types.ts       shared Player / Lineup types
```

Adding a sport = a `public/<sport>/` folder, a `src/sports/<sport>.ts` adapter, and a branch in `src/index.ts`.

## NHL data sources
| Data | Source |
|---|---|
| Default lines, PP/PK, injuries | DailyFaceoff (`__NEXT_DATA__` on the team page) |
| Primary/secondary positions | PuckPedia depth-chart embed, table view (parsed from its RSC payload) |
| Roster, shoots/catches, headshots, TOI/G/A/+-, goalie stats | api-web.nhle.com |
| Player search / add player | NHL search + player landing API |

Each source is best-effort: if DailyFaceoff fails, lines are estimated from NHL ice time; if PuckPedia fails, positions fall back to NHL/DailyFaceoff labels. Warnings show in a banner.
Edits are saved per team in the browser (localStorage); "Reset to default" clears them.

## Dev / deploy
```
npm install
npm run dev        # cf dev — local server, see terminal for the URL
npm run deploy     # needs bruisedbanana.dev on your Cloudflare account (custom domain in cloudflare.config.ts)
```
