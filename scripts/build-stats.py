#!/usr/bin/env python3
"""Build data/stats.json from the club's player-stats spreadsheets.

Sources (data/source/), exported from the club's stats workbook:
  Brazuca FC -  Player Stats - Support Tables.csv   the roster: nickname, full name, number, position, status
  Brazuca FC -  Player Stats - All Time.csv         one row per player per season/competition, up to Spring 2026
  Brazuca FC -  Player Stats - Season 2026-2027.csv one row per player per match day, current season

Older seasons only record goals; everything else was first collected in
Spring 2026. Columns that are empty everywhere are left out of the page.

Run:  python3 scripts/build-stats.py
"""
import csv, json, re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data' / 'source'
ROSTER_CSV = SOURCE / 'Brazuca FC -  Player Stats - Support Tables.csv'
ALL_TIME_CSV = SOURCE / 'Brazuca FC -  Player Stats - All Time.csv'
SEASON_CSV = SOURCE / 'Brazuca FC -  Player Stats - Season 2026-2027.csv'

CURRENT_SEASON = ('2026/2027', 'Winter')
DETAILED_SINCE = 'Spring 2026'

# Stat columns, in spreadsheet order. Both files put them at index 12 onwards.
STATS = ['mp', 'gs', 'min', 'mpg', 'g', 'as', 'ga', 'gp', 'sog', 'yc', 'rc', 'pf', 'injury', 'mvp', 'plusMinus']
STAT_START = 12

# Shown on the page; anything with no data anywhere is dropped later.
LABELS = {
    'mp': ('MP', 'Matches played'), 'gs': ('GS', 'Games started'), 'min': ('MIN', 'Minutes played'),
    'mpg': ('MPG', 'Minutes per game'), 'g': ('G', 'Goals'), 'as': ('AS', 'Assists'),
    'ga': ('GA', 'Goals allowed'), 'gp': ('GP', 'Goals prevented'), 'sog': ('SoG', 'Shots on goal'),
    'yc': ('YC', 'Yellow cards'), 'rc': ('RC', 'Red cards'), 'pf': ('PF', 'Fouls'),
    'injury': ('INJ', 'Injuries'), 'mvp': ('MVP', 'Most valuable player awards'),
    'plusMinus': ('+/-', 'On-field score differential'),
}
# Columns worth showing when they carry data, in display order.
DISPLAY_ORDER = ['mp', 'gs', 'min', 'mpg', 'g', 'as', 'ga', 'gp', 'sog', 'yc', 'rc', 'mvp', 'plusMinus']

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

def num(value):
    """Spreadsheet cell -> int. Blank and ' - ' mean no value."""
    text = (value or '').strip()
    if text in ('', '-', '–'):
        return 0
    return int(float(text))

def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

def season_label(year, season):
    start, end = year.split('/')
    return f'{season} {start[-2:]}/{end[-2:]}' if season == 'Winter' else f'{season} {end}'

# --- roster ----------------------------------------------------------------
players = {}
for row in csv.reader(open(ROSTER_CSV)):
    nickname, name, number, position_order, position, foot, status = (c.strip() for c in row[:7])
    if not name or name == 'Player Name':
        continue
    key = slugify(name)
    slug = PHOTO_SLUGS.get(nickname) if status == 'Current' else None
    photo = f'assets/img/squad/{slug}.jpg' if slug and (ROOT / f'assets/img/squad/{slug}.jpg').exists() else None
    players[key] = {
        'key': key, 'nickname': nickname, 'name': NAME_OVERRIDES.get(name, name),
        'number': int(number) if number.isdigit() else None,
        'position': position, 'positionOrder': int(position_order) if position_order.isdigit() else 99,
        'foot': foot, 'current': status == 'Current', 'slug': slug, 'photo': photo,
    }

def blank_stats():
    return dict.fromkeys(STATS, 0)

def accumulate(target, row):
    for i, field in enumerate(STATS):
        if field == 'mpg':
            continue
        target[field] += num(row[STAT_START + i])

def finish(stats):
    stats['mpg'] = round(stats['min'] / stats['mp']) if stats['mp'] else 0
    return stats

def record(bucket, key, row):
    entry = bucket.setdefault(key, blank_stats())
    accumulate(entry, row)

# --- all seasons up to Spring 2026 -----------------------------------------
all_time, seasons, appearances, detailed = {}, {}, {}, set()
unknown = set()

for row in list(csv.reader(open(ALL_TIME_CSV)))[1:]:
    name = row[1].strip()
    if not name:
        continue
    key = slugify(name)
    if key not in players:
        unknown.add(name)
        continue
    year, season, championship = row[7].strip(), row[8].strip(), row[10].strip()
    season_id = f'{year} {season}'
    seasons.setdefault(season_id, {'id': slugify(season_id), 'label': season_label(year, season),
                                   'year': year, 'season': season, 'order': (year, {'Winter': 1, 'Spring': 2, 'Summer': 3, 'Fall': 0}.get(season, 9))})
    record(all_time, key, row)
    appearances.setdefault(key, set()).add(season_id)
    if num(row[STAT_START]):          # minutes recorded -> detailed season
        detailed.add(key)

# --- current season, one row per match day ---------------------------------
current, match_days = {}, {}
for row in list(csv.reader(open(SEASON_CSV)))[1:]:
    name = row[1].strip()
    if not name:
        continue
    key = slugify(name)
    if key not in players:
        unknown.add(name)
        continue
    year, season = row[7].strip(), row[8].strip()
    match_days[row[10].strip()] = row[11].strip()
    record(current, key, row)
    record(all_time, key, row)
    if num(row[STAT_START]):
        appearances.setdefault(key, set()).add(f'{year} {season}')
        detailed.add(key)

season_id = f'{CURRENT_SEASON[0]} {CURRENT_SEASON[1]}'
seasons.setdefault(season_id, {'id': slugify(season_id), 'label': season_label(*CURRENT_SEASON),
                               'year': CURRENT_SEASON[0], 'season': CURRENT_SEASON[1], 'order': (CURRENT_SEASON[0], 1)})

# --- assemble ---------------------------------------------------------------
def rows_for(bucket, with_seasons=False):
    out = []
    for key, stats in bucket.items():
        if not any(stats.values()):
            continue
        player = dict(players[key])
        player['stats'] = finish(dict(stats))
        player['hasDetail'] = key in detailed
        if with_seasons:
            player['seasons'] = len(appearances.get(key, ()))
        out.append(player)
    return sorted(out, key=lambda p: (-p['stats']['g'], -p['stats']['min'], p['positionOrder'], p['name']))

def totals_for(rows):
    totals = {f: sum(p['stats'][f] for p in rows) for f in STATS if f != 'mpg'}
    totals['mpg'] = 0
    totals['players'] = len(rows)
    return totals

current_rows, all_time_rows = rows_for(current), rows_for(all_time, with_seasons=True)

def columns_for(rows, extra_blank=()):  # keep only columns that carry data
    return [f for f in DISPLAY_ORDER
            if f not in extra_blank and any(p['stats'][f] for p in rows)]

current_columns = columns_for(current_rows)
all_time_columns = columns_for(all_time_rows)

data = {
    'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    'detailedSince': DETAILED_SINCE,
    'legend': [[LABELS[f][0], LABELS[f][1]] for f in dict.fromkeys(current_columns + all_time_columns)],
    'currentSeason': {
        'label': season_label(*CURRENT_SEASON),
        'competition': 'FVSL Masters 3',
        'matches': [{'date': d, 'opponent': o} for d, o in sorted(match_days.items())],
        'columns': current_columns,
        'players': current_rows,
        'totals': totals_for(current_rows),
    },
    'allTime': {
        'seasons': [s['label'] for s in sorted(seasons.values(), key=lambda s: s['order'])],
        'columns': ['seasons'] + all_time_columns,
        'players': all_time_rows,
        'totals': totals_for(all_time_rows),
    },
    'labels': {f: list(LABELS[f]) for f in LABELS},
}
(ROOT / 'data' / 'stats.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

print(f"seasons: {', '.join(data['allTime']['seasons'])}")
print(f"current season: {len(current_rows)} players over {len(match_days)} match days, "
      f"{data['currentSeason']['totals']['g']} goals")
print(f"all time: {len(all_time_rows)} players, {data['allTime']['totals']['g']} goals, "
      f"{data['allTime']['totals']['min']} minutes recorded")
print(f"current columns:  {' '.join(current_columns)}")
print(f"all-time columns: {' '.join(all_time_columns)}")
print("\ntop scorers all time:")
for p in all_time_rows[:6]:
    print(f"  {p['stats']['g']:3}  {p['name']:30} {p['nickname']:9} {'squad' if p['current'] else 'former':6} seasons={p['seasons']}")
if unknown:
    print('\nnot in the roster table (ignored):', ', '.join(sorted(unknown)))
