#!/usr/bin/env python3
"""Build data/stats.json from the club's player-stats spreadsheet.

Source (data/source/):
  Brazuca FC -  Player Stats - All Time.csv

One row per player per season and competition, carrying goals and assists.
The roster — shirt number, position, preferred foot, whether the player is
still with us — is read from the same rows, taking each player's most recent
season, so a new number follows automatically.

Run:  python3 scripts/build-stats.py            rebuild from the local copy
      python3 scripts/build-stats.py --fetch    pull the sheet first, then rebuild

The club shares the sheet from OneDrive; see fetch_source() for how the link
is turned into a download. Set STATS_CSV_URL to override it without editing
this file (the share link changes if it is ever regenerated).
"""
import csv, io, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / 'data' / 'source' / 'Brazuca FC -  Player Stats - All Time.csv'

SHARE_URL = os.environ.get('STATS_CSV_URL') or (
    'https://1drv.ms/x/c/c251a7ec2459ede6/'
    'IQAfZhrqyxZXRYF7T7faO2LTAenhTrx6VK_ulNdmA1aOpBA?e=HIoyY5'
)

COMPETITION = 'FVSL Masters 3'

# Spreadsheet column positions.
NICKNAME, NAME, STATUS, NUMBER, POSITION_ORDER, POSITION, FOOT = range(7)
YEAR, SEASON, CHAMPIONSHIP, GOALS, ASSISTS = 7, 8, 9, 10, 11

SEASON_ORDER = {'Fall': 0, 'Winter': 1, 'Spring': 2, 'Summer': 3}

# Stat fields, in display order.
STATS = ['g', 'a', 'gPlusA']
LABELS = {
    'g': ('G', 'Goals'),
    'a': ('A', 'Assists'),
    'gPlusA': ('G+A', 'Goals and assists'),
}

# Display names that differ from the spreadsheet. Players are still matched on
# the spreadsheet spelling, so a re-export keeps working.
NAME_OVERRIDES = {
    'Daniel Bruno da Silva': 'Daniel Bruno',
}

# Nickname -> squad photo slug in assets/img/squad/.
PHOTO_SLUGS = {
    'Tiago': 'tiago', 'Dani': 'dani', 'Vini': 'vini', 'Renan': 'renan', 'Eliel': 'eliel',
    'Leo': 'leo', 'Claudio': 'comunale', 'Jeff': 'jeff', 'Tom': 'tom', 'Ryan': 'ryan',
    'Alison': 'alison', 'Giga': 'giga', 'Vitor': 'vitor', 'Diego': 'diego', 'Henrique': 'henrique',
    'Felipe': 'felipe', 'Igor': 'igor', 'P Bayer': 'gabriel', 'Sam': 'sam', 'Hulk': 'hulk',
    'Marcelo': 'marcelo',
}


def fetch_source():
    """Download the shared sheet and overwrite the local copy.

    The 1drv.ms link redirects to a onedrive.live.com address that only serves
    the file once the redirect has been followed with cookies kept, so the
    share is redeemed first and `download=1` is asked for on the second trip.
    """
    import http.cookiejar, urllib.request

    class Recorder(urllib.request.HTTPRedirectHandler):
        """Remembers where 1drv.ms sends us: that is the redeemable URL."""
        target = None

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if self.target is None:
                self.target = newurl
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    recorder = Recorder()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), recorder)
    opener.addheaders = [(
        'User-Agent',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    )]

    with opener.open(SHARE_URL, timeout=60) as response:
        response.read()
    if not recorder.target:
        raise SystemExit('share link did not redirect — has it been revoked?')

    separator = '&' if '?' in recorder.target else '?'
    with opener.open(recorder.target + separator + 'download=1', timeout=60) as response:
        body = response.read()

    text = body.decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(text)))
    # Never overwrite a good copy with an error page or a truncated download.
    if not rows or rows[0][:3] != ['Nickname', 'Player Name', 'Player Status']:
        raise SystemExit('downloaded file is not the player-stats sheet — left the local copy alone')
    if len(rows) < 20:
        raise SystemExit(f'downloaded sheet has only {len(rows)} rows — left the local copy alone')

    SOURCE_CSV.write_text(text)
    print(f'fetched {len(body)} bytes, {len(rows) - 1} rows -> {SOURCE_CSV.name}')


def num(value):
    """Spreadsheet cell -> int. Blank and the various dashes mean no value."""
    text = (value or '').strip()
    if text in ('', '-', '–', '—'):
        return 0
    return int(float(text))


def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def season_label(year, season):
    start, end = year.split('/')
    return f'{season} {start[-2:]}/{end[-2:]}' if season == 'Winter' else f'{season} {end}'


def main(fetch=False):
    if fetch:
        fetch_source()

    rows = []
    for row in list(csv.reader(SOURCE_CSV.open(encoding='utf-8-sig')))[1:]:
        if len(row) <= ASSISTS or not row[NAME].strip():
            continue
        rows.append(row)
    if not rows:
        raise SystemExit(f'no data rows in {SOURCE_CSV.name}')

    # --- roster, from each player's most recent season ----------------------
    players, seasons, appearances = {}, {}, {}
    for row in rows:
        year, season = row[YEAR].strip(), row[SEASON].strip()
        order = (year, SEASON_ORDER.get(season, 9))
        season_id = f'{year} {season}'
        seasons.setdefault(season_id, {'label': season_label(year, season), 'order': order})

        name = row[NAME].strip()
        key = slugify(name)
        appearances.setdefault(key, set()).add(season_id)

        known = players.get(key)
        if known and known['order'] > order:
            continue  # an older season; keep the newer shirt number and position
        nickname, status = row[NICKNAME].strip(), row[STATUS].strip()
        number, position_order = row[NUMBER].strip(), row[POSITION_ORDER].strip()
        slug = PHOTO_SLUGS.get(nickname) if status == 'Current' else None
        photo = f'assets/img/squad/{slug}.jpg' if slug and (ROOT / f'assets/img/squad/{slug}.jpg').exists() else None
        players[key] = {
            'key': key, 'nickname': nickname, 'name': NAME_OVERRIDES.get(name, name),
            'number': int(number) if number.isdigit() else None,
            'position': row[POSITION].strip(),
            'positionOrder': int(position_order) if position_order.isdigit() else 99,
            'foot': row[FOOT].strip(), 'current': status == 'Current',
            'slug': slug, 'photo': photo, 'order': order,
        }

    current_id = max(seasons, key=lambda s: seasons[s]['order'])

    # --- totals -------------------------------------------------------------
    def tally(keep):
        bucket = {}
        for row in rows:
            if not keep(row):
                continue
            key = slugify(row[NAME].strip())
            entry = bucket.setdefault(key, {'g': 0, 'a': 0, 'gPlusA': 0})
            entry['g'] += num(row[GOALS])
            entry['a'] += num(row[ASSISTS])
            entry['gPlusA'] = entry['g'] + entry['a']
        return bucket

    def table(bucket, with_seasons=False):
        out = []
        for key, stats in bucket.items():
            player = {k: v for k, v in players[key].items() if k != 'order'}
            player['stats'] = stats
            if with_seasons:
                player['seasons'] = len(appearances.get(key, ()))
            out.append(player)
        # Best contribution first; players yet to score keep their squad order.
        return sorted(out, key=lambda p: (-p['stats']['gPlusA'], -p['stats']['g'],
                                          p['positionOrder'], p['name']))

    def totals_for(table_rows):
        totals = {field: sum(p['stats'][field] for p in table_rows) for field in STATS}
        totals['players'] = len(table_rows)
        return totals

    current_rows = table(tally(lambda r: f"{r[YEAR].strip()} {r[SEASON].strip()}" == current_id))
    all_time_rows = table(tally(lambda r: True), with_seasons=True)

    data = {
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'legend': [[LABELS[f][0], LABELS[f][1]] for f in STATS],
        'currentSeason': {
            'label': seasons[current_id]['label'],
            'competition': COMPETITION,
            'columns': STATS,
            'players': current_rows,
            'totals': totals_for(current_rows),
        },
        'allTime': {
            'seasons': [s['label'] for s in sorted(seasons.values(), key=lambda s: s['order'])],
            'columns': ['seasons'] + STATS,
            'players': all_time_rows,
            'totals': totals_for(all_time_rows),
        },
        'labels': {f: list(LABELS[f]) for f in LABELS},
    }
    (ROOT / 'data' / 'stats.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    print(f"seasons: {', '.join(data['allTime']['seasons'])}")
    print(f"current season ({data['currentSeason']['label']}): {len(current_rows)} players, "
          f"{data['currentSeason']['totals']['g']} goals, {data['currentSeason']['totals']['a']} assists")
    print(f"all time: {len(all_time_rows)} players, {data['allTime']['totals']['g']} goals, "
          f"{data['allTime']['totals']['a']} assists")
    print('\ntop of the all-time table:')
    for p in all_time_rows[:6]:
        print(f"  {p['stats']['g']:3}G {p['stats']['a']:3}A  {p['name']:30} {p['nickname']:9} "
              f"{'squad' if p['current'] else 'former':6} seasons={p['seasons']}")


if __name__ == '__main__':
    unknown = [a for a in sys.argv[1:] if a != '--fetch']
    if unknown:
        raise SystemExit(f'unexpected argument: {unknown[0]}')
    main(fetch='--fetch' in sys.argv[1:])
