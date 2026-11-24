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
// published in the 14 days after kickoff. If the opponent was played more than
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

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

// -------------------------------------------------------------------- feed

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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

export function videoKind(title) {
  return /highlight|melhores momentos|resumo/i.test(title) ? 'highlights' : 'full';
}

// Returns the game (from schedule.json) a video is about, or null.
export function matchVideo(video, games) {
  const title = ` ${normalize(video.title)} `;
  if (!title.includes(` ${normalize(TEAM)} `)) return null;
  const published = Date.parse(video.publishedAt);
  const window = MATCH_WINDOW_DAYS * 864e5;
  let best = null;
  for (const game of games) {
    if (game.isBye || !game.opponent || !game.kickoff) continue;
    if (!title.includes(` ${normalize(game.opponent)} `)) continue;
    const kickoff = Date.parse(game.kickoff);
    const age = published - kickoff;
    // Uploads can't precede the game; allow a few hours for timezone slack.
    if (age < -6 * 36e5 || age > window) continue;
    if (!best || kickoff > Date.parse(best.kickoff)) best = game;
  }
  return best;
}

export function buildVideos(feed, games, previous = {}, overrides = {}) {
  const matches = structuredClone(previous);
  const unmatched = [];
  const byKickoff = new Map(games.map(g => [g.kickoff, g]));
  // Oldest first, so when a game has two videos of one kind the newest wins.
  for (const video of [...feed].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))) {
    let game;
    if (Object.hasOwn(overrides, video.id)) {
      if (overrides[video.id] === null) continue;
      game = byKickoff.get(overrides[video.id]);
    } else {
      game = matchVideo(video, games);
    }
    if (!game) { unmatched.push(video); continue; }
    // A video is filed under one game only: a corrected match moves it.
    for (const [kickoff, kinds] of Object.entries(matches)) {
      for (const [kind, entry] of Object.entries(kinds)) {
        if (entry.id === video.id && kickoff !== game.kickoff) delete kinds[kind];
      }
      if (!Object.keys(kinds).length) delete matches[kickoff];
    }
    matches[game.kickoff] ??= {};
    matches[game.kickoff][videoKind(video.title)] = { id: video.id, title: video.title, publishedAt: video.publishedAt };
  }
  return { matches, unmatched };
}

// -------------------------------------------------------------------- main

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
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

  const { matches, unmatched } = buildVideos(feed, schedule.games, previous.games, overrides);
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
