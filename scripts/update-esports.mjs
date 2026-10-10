#!/usr/bin/env node
// Fetches eBrazuca FC's EA Sports FC Pro Clubs record into data/esports.json.
//
//   node scripts/update-esports.mjs
//
// Run on a schedule by .github/workflows/update-esports.yml. EA's edge rejects
// requests that don't look like a browser, so the full header set below is
// required — a bare fetch gets 403. Files are only rewritten when something
// changed, and a failed or empty response never overwrites good data.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLUB_ID = '351608';
const PLATFORM = 'common-gen5';
const CLUB_NAME = 'eBrazuca FC';
const API = 'https://proclubs.ea.com/api/fc';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://proclubs.ea.com/',
  'Origin': 'https://proclubs.ea.com',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const n = value => Number(value ?? 0) || 0;

async function api(path) {
  const res = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

function toMatch(raw) {
  const ours = raw.clubs[CLUB_ID];
  const [opponentId, opponent] = Object.entries(raw.clubs).find(([id]) => id !== CLUB_ID) ?? [];
  const goalsFor = n(ours?.goals);
  const goalsAgainst = n(opponent?.goals);
  const squad = Object.values(raw.players?.[CLUB_ID] ?? {});
  const motm = squad.find(p => p.mom === '1');
  const scorers = squad
    .filter(p => n(p.goals) > 0)
    .sort((a, b) => n(b.goals) - n(a.goals))
    .map(p => ({ name: p.playername, goals: n(p.goals) }));
  return {
    matchId: raw.matchId,
    playedAt: new Date(n(raw.timestamp) * 1000).toISOString(),
    opponent: opponent?.details?.name ?? 'Unknown club',
    opponentId,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
    motm: motm ? motm.playername : null,
    scorers,
  };
}

function toMember(raw) {
  return {
    name: raw.name,
    proName: raw.proName || null,
    position: raw.favoritePosition || null,
    proPosition: raw.proPos || null,
    overall: n(raw.proOverall) || null,
    gamesPlayed: n(raw.gamesPlayed),
    goals: n(raw.goals),
    assists: n(raw.assists),
    winRate: n(raw.winRate),
    rating: Number(raw.ratingAve ?? 0) || 0,
    motm: n(raw.manOfTheMatch),
    passSuccess: n(raw.passSuccessRate),
    passesMade: n(raw.passesMade),
    tackleSuccess: n(raw.tackleSuccessRate),
    tacklesMade: n(raw.tacklesMade),
    shotSuccess: n(raw.shotSuccessRate),
    cleanSheets: n(raw.cleanSheetsDef) + n(raw.cleanSheetsGK),
    redCards: n(raw.redCards),
  };
}

async function writeIfChanged(file, payload) {
  const path = join(dataDir, file);
  try {
    const { updatedAt, ...previous } = JSON.parse(await readFile(path, 'utf8'));
    if (JSON.stringify(previous) === JSON.stringify(payload)) {
      console.log(`= ${file} unchanged`);
      return false;
    }
  } catch { /* first run */ }
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`);
  console.log(`✔ ${file} updated`);
  return true;
}

async function main() {
  const [info, overall, memberData, rawMatches] = await Promise.all([
    api(`clubs/info?platform=${PLATFORM}&clubIds=${CLUB_ID}`),
    api(`clubs/overallStats?platform=${PLATFORM}&clubIds=${CLUB_ID}`),
    api(`members/stats?platform=${PLATFORM}&clubId=${CLUB_ID}`),
    api(`clubs/matches?matchType=leagueMatch&platform=${PLATFORM}&clubIds=${CLUB_ID}&maxResultCount=10`),
  ]);

  const club = info[CLUB_ID];
  const record = overall[0];
  if (!club || !record) throw new Error('EA returned no club or stats; keeping existing data');

  const members = (memberData.members ?? []).map(toMember).sort((a, b) => b.goals - a.goals || b.gamesPlayed - a.gamesPlayed);
  if (members.length === 0) throw new Error('EA returned no members; keeping existing data');

  const matches = (rawMatches ?? []).map(toMatch).sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  const played = n(record.gamesPlayed);

  await writeIfChanged('esports.json', {
    club: {
      id: CLUB_ID,
      name: club.name ?? CLUB_NAME,
      platform: PLATFORM,
      platformLabel: 'PlayStation 5 / Xbox Series X|S',
      stadium: club.customKit?.stadName || null,
    },
    record: {
      gamesPlayed: played,
      wins: n(record.wins),
      ties: n(record.ties),
      losses: n(record.losses),
      goals: n(record.goals),
      goalsAgainst: n(record.goalsAgainst),
      goalDifference: n(record.goals) - n(record.goalsAgainst),
      winRate: played ? Math.round((n(record.wins) / played) * 100) : 0,
      skillRating: n(record.skillRating),
      promotions: n(record.promotions),
      relegations: n(record.relegations),
      winStreak: n(record.wstreak),
      unbeatenStreak: n(record.unbeatenstreak),
    },
    positionCount: memberData.positionCount ?? {},
    members,
    matches,
    form: matches.slice(0, 5).map(m => m.result),
    source: {
      name: 'EA Sports FC Pro Clubs',
      url: `https://www.proclubsanalytics.com/club/${CLUB_ID}?platform=${PLATFORM}&clubName=${encodeURIComponent(CLUB_NAME)}`,
    },
  });
}

main().catch(err => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
