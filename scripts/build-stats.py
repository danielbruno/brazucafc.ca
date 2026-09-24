#!/usr/bin/env python3
"""Unify the club's stats spreadsheets into data/stats.json.

Sources (data/source/):
  goals-all-time.csv           goals per player per season, every season played
  spring-2026-player-stats.csv detailed stats, Spring 2026 only

The two files use different spellings and nicknames for the same people, so
NAMES below maps every spelling onto one player. Players on the current squad
are keyed by their slug in data/team.json, which links their photo and number.

Run:  python3 scripts/build-stats.py
"""
import csv, json, re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data' / 'source'

# Season columns in goals-all-time.csv -> season id, in chronological order.
SEASONS = [
    ('24/25',          'w2425',    'Winter 2024/25', '24/25',     'league'),
    ('24/25 CUP',      'w2425cup', 'Cup 2024/25',    '24/25 Cup', 'cup'),
    ('25/26',          'w2526',    'Winter 2025/26', '25/26',     'league'),
    ('25/26 (CUP)',    'w2526cup', 'Cup 2025/26',    '25/26 Cup', 'cup'),
    ('25-26 (summer)', 'spring26', 'Spring 2026',    'Spring 26', 'league'),
    ('26/27',          'w2627',    'Winter 2026/27', '26/27',     'league'),
]

# Current squad: slug -> (full name, shirt number). Slugs match data/team.json.
CURRENT = {
    'tiago': ('Tiago', 1), 'dani': ('Daniel', 3), 'vini': ('Vinicius Totti', 12),
    'renan': ('Renan Gouveia Jorio', 4), 'eliel': ('Eliel', 14), 'leo': ('Leo Correa', 2),
    'comunale': ('Claudio Comunale Filho', 17), 'jeff': ('Jefferson Tosti', 6),
    'tom': ('Tomas Moraes', 25), 'ryan': ('Ryan Jobb', 21), 'alison': ('Alison Marangao', 10),
    'giga': ('Pedro Koster', 22), 'vitor': ('Vitor Sarone', 5), 'diego': ('Diego Sampaio', 8),
    'henrique': ('Henrique Noujeimi', 19), 'felipe': ('Felipe Moreira', 23),
    'igor': ('Igor Paiva', 16), 'gabriel': ('Gabriel Lloyd', 9), 'sam': ('Samuel Moura', 7),
    'hulk': ('Hulk', 11), 'marcelo': ('Marcelo Ribeiro', 20),
}

# Every spelling found in the two files -> player key.
NAMES = {
    # goals-all-time.csv
    'Gabriel Lloyd': 'gabriel', 'Henrique Noujeimi': 'henrique', 'Hulk': 'hulk',
    'Samuel Moura': 'sam', 'Diego': 'diego', 'Igor': 'igor', 'Alison': 'alison',
    'Claudio Comunale Filho': 'comunale', 'Felipe Moreira': 'felipe',
    'Pedro Henrique Pereira Kloster': 'giga', 'Renan Gouveia Jorio': 'renan',
    'Tomas Moraes': 'tom', 'Vinicius Totti': 'vini', 'Vitor Sarone': 'vitor',
    # spring-2026-player-stats.csv
    'Diego Sampaio': 'diego', 'Daniel': 'dani', 'Gabriel': 'gabriel-berenguer-vieira',
    'Jefferson Tosti': 'jeff', 'Igor Paiva': 'igor', 'Tiago': 'tiago', 'Eliel': 'eliel',
    'Vitor Samone': 'vitor', 'Renan Gouveia': 'renan', 'Ryan Jobb': 'ryan',
    'Alison Marangao': 'alison', 'Leo Correa': 'leo', 'Pedro Koster': 'giga',
    'Tomas Morais': 'tom', 'Marcelo Ribeiro': 'marcelo',
}

def key_for(name):
    name = name.strip()
    former = name.endswith('(former player)')
    plain = name.replace('(former player)', '').strip()
    if plain in NAMES:
        return NAMES[plain], plain, former
    slug = re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')
    return slug, plain, former

players = {}

def get(key, name, former=False):
    if key not in players:
        squad = CURRENT.get(key)
        players[key] = {
            'key': key,
            'name': squad[0] if squad else name,
            'slug': key if squad else None,
            'number': squad[1] if squad else None,
            'current': bool(squad),
            'photo': f'assets/img/squad/{key}.jpg' if squad else None,
            'goalsBySeason': {},
            'goals': 0,
            'spring': None,
        }
    if former and not players[key]['current']:
        players[key]['current'] = False
    return players[key]

# --- goals per season -------------------------------------------------------
rows = list(csv.reader(open(SOURCE / 'goals-all-time.csv')))
header = rows[2]                      # ['', '26/27', '25-26 (summer)', ...]
col = {name: i for i, name in enumerate(header)}
warnings = []

for row in rows[3:]:
    if not row or not row[0].strip():
        continue
    key, name, former = key_for(row[0])
    player = get(key, name, former)
    for csv_col, season_id, _, _, _ in SEASONS:
        raw = row[col[csv_col]].strip()
        if raw.lower() == 'n/a' or raw == '':
            # "n/a" = not with the club, blank = played but did not score
            player['goalsBySeason'][season_id] = None if raw.lower() == 'n/a' else 0
        else:
            player['goalsBySeason'][season_id] = int(raw)
    player['goals'] = sum(v for v in player['goalsBySeason'].values() if v)
    stated = row[col['TOTAL']].strip()
    if stated.isdigit() and int(stated) != player['goals']:
        warnings.append(f"{name}: goals add up to {player['goals']} but TOTAL column says {stated}")

# --- detailed Spring 2026 ---------------------------------------------------
spring_fields = ['mp', 'gs', 'min', 'mpg', 'g', 'as', 'ga', 'yc', 'rc', 'plusMinus', 'mvp']
for row in csv.DictReader(open(SOURCE / 'spring-2026-player-stats.csv')):
    name = (row.get('Player Name') or '').strip()
    if not name:
        continue
    key, plain, _ = key_for(name)
    player = get(key, plain)
    values = [row['MP'], row['GS'], row['MIN'], row['MPG'], row['G'], row['AS'],
              row['GA'], row['YC'], row['RC'], row['+/-'], row['MVP']]
    player['spring'] = {f: int(v) for f, v in zip(spring_fields, values)}
    recorded = player['goalsBySeason'].get('spring26')
    if recorded is None:
        # Played that season, so "n/a" in the goals file means no goals.
        player['goalsBySeason']['spring26'] = player['spring']['g']
    elif recorded != player['spring']['g']:
        warnings.append(
            f"{player['name']}: Spring goals differ — goals file {recorded}, detailed file {player['spring']['g']}"
            " (goals file kept)")
    for season_id in (row_def[1] for row_def in SEASONS):
        player['goalsBySeason'].setdefault(season_id, None)
    player['goals'] = sum(v for v in player['goalsBySeason'].values() if v)

ordered = sorted(players.values(),
                 key=lambda p: (-p['goals'], -(p['spring']['min'] if p['spring'] else 0), p['name']))

spring_players = [p for p in ordered if p['spring']]
totals = {f: sum(p['spring'][f] for p in spring_players) for f in spring_fields if f != 'mpg'}
totals['players'] = len(spring_players)

data = {
    'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    'seasons': [{'id': sid, 'label': label, 'short': short, 'type': kind}
                for csv_col, sid, label, short, kind in SEASONS],
    'detailedSince': 'spring26',
    'players': ordered,
    'springTotals': totals,
    'allTimeGoals': sum(p['goals'] for p in ordered),
}
out = ROOT / 'data' / 'stats.json'
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

print(f"players: {len(ordered)}  (current squad: {sum(1 for p in ordered if p['current'])})")
print(f"all-time goals: {data['allTimeGoals']}   spring players: {totals['players']}")
print("\ntop scorers:")
for p in ordered[:8]:
    print(f"  {p['goals']:3}  {p['name']:32} {'squad' if p['current'] else 'former'}")
print("\nplayers with no goals recorded:", ', '.join(p['name'] for p in ordered if p['goals'] == 0))
if warnings:
    print("\nwarnings:")
    for w in warnings:
        print(' -', w)
