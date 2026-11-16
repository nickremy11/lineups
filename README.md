# Lineups — lineups.bruisedbanana.dev

Interactive depth charts: start from the current lines, drag players around, add new ones, see "what if".
One Cloudflare Worker serves the static pages and a small data API.

```
public/                 static assets (served by Workers Assets)
  index.html            sport picker
  shared/               CSS shared by all sports
  shared/ui.js, dnd.js  team picker, add-player modal, toast, pointer drag & drop (all sports)
  shared/app.css        tile / bench / modal styles shared by all sports
  nhl/                  NHL page (index.html, app.js, nhl.css)   -> /nhl/
  nba/                  NBA half-court page                      -> /nba/
  nfl/                  NFL football-field page                  -> /nfl/
  soccer/               Soccer pitch page                        -> /soccer/
  ncaab/                NCAAB half-court page (no photos)        -> /ncaab/
src/
  index.ts              router: /api/<sport>/... ; everything else -> assets
  sports/nhl.ts         NHL data adapter (NHL API + DailyFaceoff + PuckPedia)
  sports/nba.ts         NBA data adapter (ESPN depth chart, roster, season averages)
  sports/nfl.ts         NFL data adapter (Ourlads depth chart + ESPN roster)
  sports/soccer.ts      Soccer data adapter (FotMob squads, last-match XI, ratings, preferred foot)
  sports/ncaab.ts       NCAAB data adapter (ESPN teams/rosters/stats + RotoWire depth charts)
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

## NBA data sources
ESPN only: depth chart page (`__espnfitt__` JSON: rows PG/SG/SF/PF/C, starter then backups, injuries), roster API (jersey, headshot),
team stats page (MPG/PPG/RPG/APG/FG%/3P%), search + player endpoints for "Add player". Players listed at several positions get a primary
position (where they rank highest) plus secondary chips. Defaults are capped at starter + 3 backups per position.
RealGM is behind a Cloudflare challenge, so it isn't used.

## NFL data sources
Ourlads depth chart page (server-rendered HTML tables: offense, defense, special teams, practice squad, reserves; formation varies by
team, e.g. 3-4 vs 4-3) for the lines; ESPN roster API for headshots, injuries and practice-squad/IR flags (matched by name, then jersey).
Tiles can be switched between light / medium / dark in the header.

## Soccer data sources
FotMob (server-rendered `__NEXT_DATA__`): league pages for team lists (15 European leagues), team squad page for positions
(e.g. `CB,RB`), season rating, injuries and shirt numbers, the last match page for formation + the starting XI in slot order,
and the player page for preferred foot (loaded lazily, cached 30 days, and remembered in the browser).
Formations are generated from the formation string (any `x-y-z`), backups under each slot are auto-picked by positional fit then rating.

## NCAAB data sources
ESPN for the 365-team list (grouped by conference), rosters (class year) and season averages; RotoWire per-team depth chart pages
(PG/SG/SF/PF/C order) for the ~94 high-major teams it covers. Other teams get an estimated depth chart (top-5 by minutes seated by
ESPN G/F/C position) and a banner says so. RealGM is behind a Cloudflare challenge; thedepthchartcbb.com is a paid JS app.

## Dev / deploy
```
npm install
npm run dev        # cf dev — http://localhost:8787 (restart after adding new static files)
npm run deploy     # needs bruisedbanana.dev on your Cloudflare account (custom domain in cloudflare.config.ts)
```
