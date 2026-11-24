#!/usr/bin/env node
// Links each finished match to its YouTube videos (highlights and full match)
// and writes data/videos.json, which the schedule page reads.
//
//   node scripts/update-videos.mjs
//
// The channel's public RSS feed needs no API key, but only lists the latest 15
// uploads. So existing links are kept and only added to or corrected, never
// dropped. Files are only rewritten when something changed, and an empty or
// failed feed never overwrites the existing data.
//
// A video belongs to a game when its title names the opponent and it was
// published in the 14 days after kickoff. Under 30 minutes it is the highlights,
// longer it is the full match; the length comes from the video's page. With no
// length available it is treated as the full match. If the opponent was played more than
// once, the latest kickoff before the upload wins. Anything that can't be
// matched is listed in the log; pin it by hand in data/video-overrides.json:
//
//   { "<videoId>": "<kickoff exactly as in schedule.json>" }   // force a game
//   { "<videoId>": null }                                       // ignore a video

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEAM = 'Brazuca FC';
const CHANNEL_ID = 'UCuhfgqcKy52XbyH6wOd0ytQ'; // youtube.com/@brazucafc_brz
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const USER_AGENT = 'brazucafc.ca-sync/1.0 (+https://brazucafc.ca; tech@brazucafc.ca)';
const MATCH_WINDOW_DAYS = 14;
const HIGHLIGHTS_MAX_SECONDS = 30 * 60;
const MIN_SECONDS = 2 * 60;   // anything shorter is a Short or a teaser, not a match video

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

// -------------------------------------------------------------------- feed

// An entity naming a code point that doesn't exist stays as written instead of throwing.
const fromCode = (n, whole) => (Number.isInteger(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : whole);
const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (whole, n) => fromCode(Number(n), whole))
  .replace(/&#x([0-9a-f]+);/gi, (whole, n) => fromCode(parseInt(n, 16), whole))
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseFeed(xml) {
  const tag = (block, name) => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, block]) => ({
      id: tag(block, 'yt:videoId'),
      title: decode(tag(block, 'title') ?? '').trim(),
      publishedAt: tag(block, 'published'),
    }))
    .filter(v => v.id && v.title && !Number.isNaN(Date.parse(v.publishedAt)));
}

// ---------------------------------------------------------------- matching

// "PoCo FC Revolution" and "Poco FC Revolution" are the same team; accents and
// punctuation (the titles are full of emoji) never matter.
export const normalize = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function videoKind(seconds) {
  return Number.isFinite(seconds) && seconds < HIGHLIGHTS_MAX_SECONDS ? 'highlights' : 'full';
}

// Length in seconds from a watch page, or null when the page doesn't say.
export function parseDuration(html) {
  // The duration meta tag belongs to the page's own video; other "lengthSeconds" in the page may not.
  const iso = html.match(/itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
  if (iso) return Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
  const exact = html.match(/"lengthSeconds":"(\d+)"/);
  return exact ? Number(exact[1]) : null;
}

const PT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// "17/Out/2026" in a title -> "2026-10-17", or null.
export function titleDate(title) {
  const m = title.match(/\b(\d{1,2})\/([a-zç]{3})\/(\d{4})\b/i);
  const month = m && PT_MONTHS.indexOf(m[2].toLowerCase());
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Returns the game (from schedule.json) a video is about, or null. When the opponent was played
// more than once, a date written in the title picks the game; without one, the latest kickoff
// before the upload wins.
export function matchVideo(video, games) {
  const title = ` ${normalize(video.title)} `;
  if (!title.includes(` ${normalize(TEAM)} `)) return null;
  const published = Date.parse(video.publishedAt);
  const window = MATCH_WINDOW_DAYS * 864e5;
  const candidates = games.filter(game => {
    if (game.isBye || !game.opponent || !game.kickoff) return false;
    if (!title.includes(` ${normalize(game.opponent)} `)) return false;
    const age = published - Date.parse(game.kickoff);
    // Uploads can't precede the game; allow a few hours for timezone slack.
    return age >= -6 * 36e5 && age <= window;
  });
  const dated = titleDate(video.title);
  const byDate = dated && candidates.find(game => game.kickoff.slice(0, 10) === dated);
  return byDate || candidates.sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0] || null;
}

export function buildVideos(feed, games, previous = {}, overrides = {}, durations = {}) {
  const matches = structuredClone(previous);
  const unmatched = [];
  const byKickoff = new Map(games.map(g => [g.kickoff, g]));
  // Links are keyed by kickoff text. When the league moves a game or rewrites its UTC offset the key
  // changes, and the feed can't rebuild old links (it holds 15 uploads), so a link whose key is gone
  // follows the one game within 6 hours that has none. With zero or several candidates it is kept, unseen.
  for (const kickoff of Object.keys(matches)) {
    if (byKickoff.has(kickoff)) continue;
    const at = Date.parse(kickoff);
    const near = games.filter(g => g.kickoff && !g.isBye && !matches[g.kickoff] && Math.abs(Date.parse(g.kickoff) - at) <= 6 * 36e5);
    if (near.length === 1) { matches[near[0].kickoff] = matches[kickoff]; delete matches[kickoff]; }
  }

  // Takes a video out of wherever it is filed, optionally keeping one slot (game + kind).
  const unfile = (id, keep) => {
    for (const [kickoff, kinds] of Object.entries(matches)) {
      for (const [kind, entry] of Object.entries(kinds)) {
        if (entry.id === id && !(keep && keep.kickoff === kickoff && keep.kind === kind)) delete kinds[kind];
      }
      if (!Object.keys(kinds).length) delete matches[kickoff];
    }
  };
  const isFiled = id => Object.values(matches).some(kinds => Object.values(kinds).some(e => e.id === id));

  // Oldest first, so when a game has two videos of one kind the newest wins.
  for (const video of [...feed].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))) {
    let game;
    if (Object.hasOwn(overrides, video.id)) {
      if (overrides[video.id] === null) { unfile(video.id); continue; }   // ignored, even if linked before
      game = byKickoff.get(overrides[video.id]);
      if (!game) {
        console.log(`Override for ${video.id} names a kickoff that is not in the schedule (${overrides[video.id]}); ignoring it.`);
        continue;
      }
    } else {
      game = matchVideo(video, games);
    }
    // A length of 0 is a stream or upload still processing, not a clip: treat it as unknown.
    const seconds = durations[video.id] > 0 ? durations[video.id] : undefined;
    if (!game || (Number.isFinite(seconds) && seconds < MIN_SECONDS)) {
      unfile(video.id);                                                     // no longer a match (or a Short)
      unmatched.push(video);
      continue;
    }
    const known = Number.isFinite(seconds);
    // Without a length the kind is only a guess, so it must not replace a link that is already
    // there, nor re-file one (unless pinned by hand): it waits for the next run, when the length may be readable.
    if (!known && !Object.hasOwn(overrides, video.id) && isFiled(video.id)) continue;
    const kind = videoKind(seconds);
    if (!known && matches[game.kickoff]?.[kind]) { unmatched.push(video); continue; }

    // A video is filed under one game and one kind: a corrected match moves it.
    unfile(video.id, { kickoff: game.kickoff, kind });
    matches[game.kickoff] ??= {};
    matches[game.kickoff][kind] = {
      id: video.id, title: video.title, publishedAt: video.publishedAt,
      ...(known && { durationSeconds: seconds }),
    };
  }
  return { matches, unmatched };
}

// -------------------------------------------------------------------- main

// A missing file is fine (first run). A file that exists but can't be read or parsed stops the run,
// so a bad merge can't be mistaken for "no data" and overwritten, losing links the feed can't restore.
async function readJson(path, fallback) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try { return JSON.parse(text); } catch (err) { throw new Error(`${path} is not valid JSON (${err.message}); fix it or delete it.`); }
}

// Lengths already stored are reused; only new videos cost a page fetch.
async function loadDurations(feed, previous, relevant) {
  const durations = {};
  for (const kinds of Object.values(previous)) {
    for (const entry of Object.values(kinds)) if (Number.isFinite(entry.durationSeconds)) durations[entry.id] = entry.durationSeconds;
  }
  for (const video of feed) {
    if (video.id in durations || !relevant(video)) continue;
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' },
        signal: AbortSignal.timeout(30_000),
      });
      const seconds = res.ok ? parseDuration(await res.text()) : null;
      if (seconds !== null) durations[video.id] = seconds;
      else console.log(`No length for ${video.id}; counting it as the full match.`);
    } catch (err) {
      console.log(`No length for ${video.id} (${err.message}); counting it as the full match.`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return durations;
}

async function main() {
  const res = await fetch(FEED_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${FEED_URL} -> HTTP ${res.status}`);
  const feed = parseFeed(await res.text());
  if (!feed.length) throw new Error('The feed had no videos; keeping the existing data.');

  const schedule = await readJson(join(dataDir, 'schedule.json'), null);
  if (!schedule?.games?.length) throw new Error('data/schedule.json is missing or empty.');
  const overrides = await readJson(join(dataDir, 'video-overrides.json'), {});
  const path = join(dataDir, 'videos.json');
  const previous = await readJson(path, {});

  const durations = await loadDurations(feed, previous.games ?? {}, v => Object.hasOwn(overrides, v.id) || matchVideo(v, schedule.games) !== null);
  const { matches, unmatched } = buildVideos(feed, schedule.games, previous.games, overrides, durations);
  for (const v of unmatched) console.log(`Unmatched: ${v.publishedAt.slice(0, 10)} ${v.id} ${v.title}`);

  const payload = { channel: `https://www.youtube.com/channel/${CHANNEL_ID}`, games: matches };
  const { updatedAt, ...before } = previous;
  if (JSON.stringify(before) === JSON.stringify(payload)) {
    console.log('Videos unchanged.');
    return;
  }
  await writeFile(path, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(matches).length} games with videos.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
