#!/usr/bin/env node
// Syncs Brazuca FC's schedule and division standings from the Fraser Valley
// Soccer League site (spappz) into data/schedule.json and data/standings.json.
//
//   node scripts/update-league-data.mjs
//
// Runs on a schedule in .github/workflows/update-league-data.yml. Files are
// only rewritten when the league data actually changed, and nothing is
// overwritten when a fetch or parse comes back empty, so a league-site outage
// or layout change can't blank the website.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEAM = 'Brazuca FC';
const TEAM_ID = 1073;
const REG_YEAR = 2027;
const TIME_ZONE = 'America/Vancouver';
const TEAM_PAGE_URL = `https://fraservalleysoccer.spappz.com/webapps/spappz_live/team_info?reg_year=${REG_YEAR}&id=${TEAM_ID}`;
const SCHEDULE_CSV_URL = `${TEAM_PAGE_URL}&cmd=excelsched`;
const USER_AGENT = 'brazucafc.ca-sync/1.0 (+https://brazucafc.ca; tech@brazucafc.ca)';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- schedule

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const endRow = () => {
    row.push(field);
    if (row.some(v => v.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// Minutes east of UTC for `timeZone` at `date` (e.g. -420 for PDT).
function tzOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map(p => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

// "Fri 9/11/2026 8:45PM" (Vancouver wall clock) -> "2026-09-11T20:45:00-07:00".
// The offset is resolved per game, so fixtures after the November DST change get -08:00.
function parseLeagueDate(value) {
  const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  const [, month, day, year, h, minute, meridiem] = m;
  const hour = (Number(h) % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  const wallClock = Date.UTC(+year, +month - 1, +day, hour, +minute);
  let offset = tzOffsetMinutes(new Date(wallClock), TIME_ZONE);
  offset = tzOffsetMinutes(new Date(wallClock - offset * 60_000), TIME_ZONE);
  const pad = n => String(n).padStart(2, '0');
  const abs = Math.abs(offset);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:00${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function toScore(value) {
  const trimmed = (value ?? '').trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function parseSchedule(csv) {
  const [header, ...records] = parseCsv(csv);
  if (!header?.includes('Home Team')) throw new Error('Schedule CSV has an unexpected header');
  const col = name => header.indexOf(name);
  const get = (rec, name) => (rec[col(name)] ?? '').trim();

  return records.map(rec => {
    const home = get(rec, 'Home Team');
    const away = get(rec, 'Visiting Team');
    const isBye = /^bye$/i.test(home) || /^bye$/i.test(away);
    const isHome = home === TEAM;
    const homeScore = toScore(get(rec, 'Home Score'));
    const awayScore = toScore(get(rec, 'Visit Score'));

    let goalsFor = null;
    let goalsAgainst = null;
    let result = null;
    if (!isBye && homeScore !== null && awayScore !== null) {
      goalsFor = isHome ? homeScore : awayScore;
      goalsAgainst = isHome ? awayScore : homeScore;
      result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
    }

    return {
      kickoff: parseLeagueDate(get(rec, 'Date')),
      competition: get(rec, 'Schedule'),
      type: get(rec, 'Type'),
      status: get(rec, 'Status'),
      division: get(rec, 'Division'),
      home,
      away,
      homeScore,
      awayScore,
      field: isBye ? null : get(rec, 'Field') || null,
      notes: get(rec, 'Notes') || null,
      isBye,
      isHome,
      opponent: isBye ? null : isHome ? away : home,
      goalsFor,
      goalsAgainst,
      result,
    };
  }).filter(game => game.kickoff && (game.home === TEAM || game.away === TEAM));
}

// --------------------------------------------------------------- standings

function cleanCell(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// The team page embeds the division table under a "League Standings" heading.
function parseStandings(html) {
  const start = html.indexOf('League Standings');
  if (start === -1) throw new Error('Could not find "League Standings" on the team page');
  const end = html.indexOf('Division Stats', start);
  const block = html.slice(start, end === -1 ? start + 20_000 : end);

  const rows = [...block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cleanCell(c[1])));

  const title = rows.flat().find(cell => /Pool:/i.test(cell)) ?? '';
  const [, division = '', pool = ''] = title.match(/^(.*?)\s*-\s*Pool:\s*(\S+)/i) ?? [];

  const table = rows
    .filter(cells => cells.length >= 10 && /^\d+$/.test(cells.at(-10)))
    .map(cells => {
      const [pos, team, gp, w, d, l, gf, ga, gd, pts] = cells.slice(-10);
      return { pos: +pos, team, gp: +gp, w: +w, d: +d, l: +l, gf: +gf, ga: +ga, gd: +gd, pts: +pts };
    });

  return { division: division.trim(), pool, rows: table };
}

// -------------------------------------------------------------------- output

async function writeIfChanged(file, payload) {
  const path = join(dataDir, file);
  let previous = null;
  try {
    const { updatedAt, ...rest } = JSON.parse(await readFile(path, 'utf8'));
    previous = rest;
  } catch { /* first run */ }

  if (previous && JSON.stringify(previous) === JSON.stringify(payload)) {
    console.log(`= ${file} unchanged`);
    return false;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`);
  console.log(`✔ ${file} updated`);
  return true;
}

async function main() {
  const [csv, teamPage] = await Promise.all([fetchText(SCHEDULE_CSV_URL), fetchText(TEAM_PAGE_URL)]);

  const games = parseSchedule(csv);
  if (games.length === 0) throw new Error('Schedule parsed to zero games; keeping existing data');

  const standings = parseStandings(teamPage);
  if (!standings.rows.some(row => row.team === TEAM)) {
    throw new Error(`Standings parsed without ${TEAM}; keeping existing data`);
  }

  const season = `${REG_YEAR - 1}/${String(REG_YEAR).slice(-2)}`;
  const common = { team: TEAM, season, source: TEAM_PAGE_URL };

  await writeIfChanged('schedule.json', {
    ...common,
    competition: games[0].competition,
    division: games[0].division,
    timeZone: TIME_ZONE,
    games,
  });
  await writeIfChanged('standings.json', {
    ...common,
    division: standings.division,
    pool: standings.pool,
    rows: standings.rows,
  });
}

main().catch(err => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
