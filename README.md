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
| `gallery.html` | Photo albums with a lightbox (rendered from `data/gallery.json`) |
| `contact.html` | Contact inboxes and Instagram |

Shared styles live in `assets/css/site.css` and behaviour in `assets/js/site.js`.
The header and footer are repeated in each page, so change them in all six.

## Data

| File | Updated by |
|---|---|
| `data/schedule.json` | GitHub Action (automatic) |
| `data/standings.json` | GitHub Action (automatic) |
| `data/team.json` | Hand-edited |
| `data/stats.json` | `scripts/build-stats.py` (from the spreadsheets in `data/source/`) |
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

### Player stats

`data/stats.json` is built from two spreadsheet exports kept in `data/source/`:

| File | Covers |
|---|---|
| `goals-all-time.csv` | Goals per player per season, every season the club has played |
| `spring-2026-player-stats.csv` | Minutes, starts, assists, cards, plus-minus and MVP — Spring 2026 only |

The files spell the same people differently (nicknames, full names, typos), so
`scripts/build-stats.py` holds a `NAMES` map that folds every spelling onto one
player, and a `CURRENT` map linking players to their squad slug so the page can
show their photo and number. After updating either CSV, rebuild:

```bash
python3 scripts/build-stats.py
```

The script prints the top scorers and warns when the two files disagree. Where
they conflict on goals, the all-time goals file wins. Adding a season means
adding a column to the goals CSV and a line to `SEASONS` in the script.

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

## Run locally

The pages load JSON with `fetch`, so open them through a local server rather
than as files:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000
