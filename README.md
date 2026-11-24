# brazucafc.ca

Website for **Brazuca FC** — more than a team, we are family. 🇧🇷🇨🇦⚽

A static site served by GitHub Pages. No build step: edit the HTML, JSON or
assets and push.

## Pages

| File | What's on it |
|---|---|
| `index.html` | Hero, next match, compact league table, story teaser, squad teaser, sponsors |
| `about.html` | Club story, timeline, values |
| `team.html` | Coach and players by position (rendered from `data/team.json`) |
| `schedule.html` | Next match, full fixture list with filters, league table |
| `stats.html` | All-time goal scorers and detailed Spring 2026 stats (rendered from `data/stats.json`) |
| `esports.html` | eBrazuca FC on EA Sports FC Pro Clubs (rendered from `data/esports.json`) |
| `gallery.html` | Photo albums with a lightbox (rendered from `data/gallery.json`) |
| `contact.html` | Contact inboxes and Instagram |

Shared styles live in `assets/css/site.css` and behaviour in `assets/js/site.js`.
The header and footer are repeated in each page, so change them in all six.

## Data

| File | Updated by |
|---|---|
| `data/schedule.json` | GitHub Action (automatic) |
| `data/standings.json` | GitHub Action (automatic) |
| `data/videos.json` | GitHub Action (automatic, with the schedule) |
| `data/video-overrides.json` | Hand-edited (optional) |
| `data/team.json` | Hand-edited |
| `data/stats.json` | `scripts/build-stats.py` (from the spreadsheets in `data/source/`) |
| `data/esports.json` | GitHub Action (automatic, hourly) |
| `data/gallery.json` | Hand-edited |

### League schedule and standings

`scripts/update-league-data.mjs` downloads the team's fixtures and the
Masters 3 table from the Fraser Valley Soccer League site and writes the two
JSON files. `.github/workflows/update-league-data.yml` runs it every 6 hours
(and on demand from the Actions tab), commits any changes and asks Pages to
rebuild. Files are only rewritten when the league data actually changed, and
an empty or unparseable response never overwrites the existing data.

The "next match" on the site is worked out in the browser from the fixture
dates, so it moves on by itself even between data updates. Rounds against
`BYE` show a bye-week message instead of a match card.

Run it locally:

```bash
node scripts/update-league-data.mjs
```

When the league opens a new season, update `REG_YEAR` (and `TEAM_ID` if it
changes) at the top of the script.

### Match videos

`scripts/update-videos.mjs` reads the YouTube channel's public RSS feed (no API
key) and links each finished game to its **Highlights** and **Full match**
videos in `data/videos.json`; the schedule page shows them as buttons on the
game's row. It runs right after the league data in the same workflow, and a
failure there never blocks the scores.

A video belongs to a game when its title names the opponent and it was
uploaded within 14 days after kickoff. A title with the word "highlights" is
the highlights; any other upload counts as the full match. The feed only lists
the latest 15 uploads, so existing links are kept and never dropped. Unmatched
videos are printed in the Action's log.

To fix one by hand, add it to `data/video-overrides.json` (create the file):

```json
{
  "<videoId>": "2026-11-01T19:00:00-07:00",
  "<anotherVideoId>": null
}
```

A kickoff (exactly as written in `schedule.json`) pins the video to that game;
`null` ignores the video. Tests: `node --test scripts/`.

### Player stats

`data/stats.json` is built from one spreadsheet the club keeps in OneDrive and
updates after matchday, cached in the repo at
`data/source/Brazuca FC -  Player Stats - All Time.csv`. It holds one row per
player per season and competition, with goals and assists; shirt numbers,
positions and squad status are read from the same rows.

```bash
python3 scripts/build-stats.py            # rebuild from the local copy
python3 scripts/build-stats.py --fetch    # pull the sheet first, then rebuild
```

`.github/workflows/update-stats.yml` runs the `--fetch` form every Monday,
commits any change and asks Pages to rebuild. Nothing is committed when the
sheet hasn't moved.

The sheet is shared with "anyone with the link". The 1drv.ms address redirects
to a `onedrive.live.com` one that only serves the file once that redirect has
been followed with cookies kept, so `fetch_source()` makes two trips: the
first redeems the share, the second asks for `download=1`. A download that
isn't the stats sheet, or that comes back short, is refused rather than
written over a good copy.

**If the share link is ever regenerated**, set a repository variable named
`STATS_CSV_URL` to the new link (Settings → Secrets and variables → Actions →
Variables). The workflow passes it through, and the script falls back to the
link in its own `SHARE_URL` when the variable is unset.

Two things to keep in mind when editing the script:

- `PHOTO_SLUGS` maps each nickname to a file in `assets/img/squad/`, which is
  how the tables show photos and shirt numbers. Add a line when a new player
  joins the squad.
- The current season is whichever is latest in the sheet, so a new season
  appears on its own once rows for it are added.

Assists were first recorded in Spring 2026; the earlier seasons tracked goals
only, which the page explains in a closing note.

### E-sports (EA Sports FC Pro Clubs)

`scripts/update-esports.mjs` pulls eBrazuca FC's record, members and recent
matches from EA's Pro Clubs API into `data/esports.json`.
`.github/workflows/update-esports.yml` runs it hourly, commits any change and
asks Pages to rebuild — four requests per run, and nothing is committed when
the record hasn't moved.

EA's edge **rejects requests that don't look like a browser**: a plain fetch
gets `403 Access Denied` no matter the User-Agent. The full Chrome header set
in `HEADERS` at the top of the script is what makes it work, so keep it intact
if you edit the file.

The club is identified by `CLUB_ID` (351608) and `PLATFORM` (`common-gen5`,
meaning current-gen consoles) at the top of the script. Useful endpoints:

| Endpoint | Gives |
|---|---|
| `clubs/info` | Club name, stadium, kit colours |
| `clubs/overallStats` | Record, goals, skill rating, promotions |
| `members/stats` | Per-member games, goals, assists, rating, MOTM |
| `clubs/matches?matchType=leagueMatch` | Recent matches with per-player detail |

`clubs/seasonalStats` returns 404 for FC and the crest image CDN isn't
publicly reachable, so the page uses a styled badge instead.

Run it locally the same way:

```bash
node scripts/update-esports.mjs
```

### Squad

Edit `data/team.json`. Player photos are 400×500 JPEGs in `assets/img/squad/`,
referenced by each player's `photo`. A player with `"photo": null` (or a
missing file) shows a number badge instead. Set `"captain": true` for the
armband badge.

### Gallery

Add photos to `assets/img/gallery/` and list them in `data/gallery.json`:

```json
{
  "src": "assets/img/gallery/my-photo.jpg",
  "thumb": "assets/img/gallery/my-photo-800.jpg",
  "alt": "What the photo shows, for screen readers",
  "caption": "Optional caption"
}
```

Photos go inside an album's `photos` array; add a new object to `albums` to
start a new album. `thumb` is optional (an ~800px-wide copy keeps the grid fast).

Full-size copies are 1600px on the long edge, thumbnails 800px, both JPEG. A
whole shoot goes in its own subfolder named after the match
(`assets/img/gallery/2026-11-13-gunners/01.jpg` and `01-800.jpg`) so the
top level stays readable. Re-encode from the originals rather than committing
camera files: they carry EXIF (photographer, camera, sometimes GPS) and run to
several megabytes each.

The first photo in the first album is the one the grid features at double size,
and the "send us your shots" card renders once, after the last album.

An album can carry a photo credit, shown under its description. The link is
optional, and only `http`/`https` addresses are turned into one:

```json
"credit": {
  "text": "Photos by Jimmy Ma / sportsUP",
  "link": { "label": "@sportsup.bc", "href": "https://www.instagram.com/sportsup.bc/" }
}
```

## Cache busting

GitHub Pages serves assets with `cache-control: max-age=600`, so for ten
minutes after a deploy a browser can load new HTML alongside the previous
stylesheet. The CSS and JS links therefore carry a content hash
(`site.css?v=ae584fca`), giving every version its own URL.

**After changing anything in `assets/css/` or `assets/js/`, restamp the pages
before committing:**

```bash
python3 scripts/version-assets.py
```

It rewrites the links in all the HTML pages and prints the new hashes. Files
that didn't change keep their hash, so they stay cached.

## Run locally

The pages load JSON with `fetch`, so open them through a local server rather
than as files:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000
