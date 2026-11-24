// node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, matchVideo, buildVideos, videoKind, normalize } from './update-videos.mjs';

// Real titles and dates from the channel, against the real fixture list.
const game = (kickoff, opponent) => ({ kickoff, opponent, isBye: false });
const games = [
  { kickoff: '2026-09-11T20:45:00-07:00', opponent: null, isBye: true },
  game('2026-09-19T20:00:00-07:00', 'Ridge Meadows Gunners'),
  game('2026-09-25T21:00:00-07:00', 'Poco FC Revolution'),
  game('2026-10-02T20:45:00-07:00', 'Ridge Meadows Chargers'),
  game('2026-10-17T20:00:00-07:00', 'Albion Legacy FC'),
  game('2026-10-23T20:45:00-07:00', 'LUSA Heat'),
  game('2026-11-01T19:00:00-07:00', 'AC Fury'),
  game('2026-11-13T20:45:00-08:00', 'Ridge Meadows Gunners'),
  game('2026-11-20T20:45:00-08:00', 'Poco FC Revolution'),
  game('2027-01-16T20:00:00-08:00', 'Ridge Meadows Gunners'),
];
const v = (id, day, title) => ({ id, title, publishedAt: `${day}T12:00:00+00:00` });
const feed = [
  v('a', '2026-11-24', '⚽ BRAZUCA FC 5️⃣ x 1️⃣ PoCo FC Revolution | FULL MATCH – RAW FOOTAGE'),
  v('b', '2026-11-09', '🔥 BRAZUCA FC 3-1 AC FURY | MATCH HIGHLIGHTS & GOALS ⚽ | FVSL Masters Div 3 2026/27'),
  v('c', '2026-11-03', 'BRAZUCA FC 3 X 1 AC FURY | FULL MATCH | FVSL 2026/27 | Xbotgo Falcon'),
  v('d', '2026-10-26', '⚽ BRAZUCA FC 6 X 0 LUSA Heat | HIGHLIGHTS | FVSL 2026/27'),
  v('e', '2026-10-25', 'Brazuca FC x LUSA Heat - 23/Out/2026 - FVSL Masters 3'),
  v('f', '2026-10-19', 'Brazuca FC x Albion Legacy FC - 17/Out/2026 - FVSL Masters 3'),
  v('g', '2026-10-19', '⚽ BRAZUCA FC 3–0 ALBION LEGACY FC | MATCH HIGHLIGHTS'),
  v('h', '2026-10-04', '⚽ BRAZUCA FC 10–0 RIDGE MEADOWS CHARGERS | MATCH HIGHLIGHTS'),
  v('i', '2026-10-04', 'Brazuca FC x Ridge Meadows Chargers - 02/Out/2026 - FVSL Masters 3'),
];

test('normalize ignores case, accents, emoji and punctuation', () => {
  assert.equal(normalize('⚽ PoCo  FC – Revolution!'), 'poco fc revolution');
});

test('kind comes from the title', () => {
  assert.equal(videoKind('X | MATCH HIGHLIGHTS'), 'highlights');
  assert.equal(videoKind('X | FULL MATCH – RAW FOOTAGE'), 'full');
  assert.equal(videoKind('Brazuca FC x LUSA Heat - 23/Out/2026'), 'full');
});

test('every real video lands on the right game', () => {
  const { matches, unmatched } = buildVideos(feed, games);
  assert.deepEqual(unmatched, []);
  const ids = k => Object.fromEntries(Object.entries(matches[k]).map(([kind, e]) => [kind, e.id]));
  assert.deepEqual(ids('2026-11-20T20:45:00-08:00'), { full: 'a' });
  assert.deepEqual(ids('2026-11-01T19:00:00-07:00'), { highlights: 'b', full: 'c' });
  assert.deepEqual(ids('2026-10-23T20:45:00-07:00'), { highlights: 'd', full: 'e' });
  assert.deepEqual(ids('2026-10-17T20:00:00-07:00'), { full: 'f', highlights: 'g' });
  assert.deepEqual(ids('2026-10-02T20:45:00-07:00'), { highlights: 'h', full: 'i' });
});

test('an opponent played twice resolves to the game before the upload', () => {
  // Gunners were played on 19 Sep and 13 Nov; this upload is days after the second.
  const upload = v('x', '2026-11-16', 'BRAZUCA FC 7 X 0 Ridge Meadows Gunners | HIGHLIGHTS');
  assert.equal(matchVideo(upload, games).kickoff, '2026-11-13T20:45:00-08:00');
  // Ridge Meadows Chargers is a different team from the Gunners.
  assert.equal(matchVideo(v('y', '2026-10-04', 'BRAZUCA FC 10-0 Ridge Meadows Chargers'), games).opponent, 'Ridge Meadows Chargers');
});

test('a video far from any game, or before it, is not matched', () => {
  assert.equal(matchVideo(v('z', '2026-12-20', 'BRAZUCA FC x AC Fury'), games), null);        // no such game yet
  assert.equal(matchVideo(v('z', '2026-12-30', 'BRAZUCA FC x Ridge Meadows Gunners'), games), null); // >14 days after 13 Nov
  assert.equal(matchVideo(v('z', '2026-09-01', 'BRAZUCA FC x Ridge Meadows Gunners'), games), null); // before the game
  assert.equal(matchVideo(v('z', '2026-11-04', 'Some other team x AC Fury'), games), null);   // not about Brazuca
});

test('existing links are kept when the feed no longer lists them', () => {
  const previous = { '2026-09-19T20:00:00-07:00': { full: { id: 'old', title: 't', publishedAt: '2026-09-21T00:00:00Z' } } };
  const { matches } = buildVideos(feed, games, previous);
  assert.equal(matches['2026-09-19T20:00:00-07:00'].full.id, 'old');
});

test('overrides pin a video to a game or ignore it', () => {
  const odd = v('o', '2026-11-05', 'Treino de sexta');
  const withOverride = buildVideos([odd], games, {}, { o: '2026-11-01T19:00:00-07:00' });
  assert.equal(withOverride.matches['2026-11-01T19:00:00-07:00'].full.id, 'o');
  assert.deepEqual(buildVideos([feed[1]], games, {}, { b: null }).matches, {});
});

test('a corrected match moves the video instead of duplicating it', () => {
  const previous = { '2026-09-19T20:00:00-07:00': { full: { id: 'q', title: 't', publishedAt: 'x' } } };
  const { matches } = buildVideos([v('q', '2026-11-05', 'whatever')], games, previous, { q: '2026-11-01T19:00:00-07:00' });
  assert.equal(matches['2026-09-19T20:00:00-07:00'], undefined);
  assert.equal(matches['2026-11-01T19:00:00-07:00'].full.id, 'q');
});

test('parses the YouTube feed format', () => {
  const xml = `<feed><entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>A &amp; B &#39;x&#39;</title><published>2026-11-24T05:00:00+00:00</published></entry>
    <entry><yt:videoId>bad</yt:videoId><title>No date</title></entry></feed>`;
  assert.deepEqual(parseFeed(xml), [{ id: 'abc', title: "A & B 'x'", publishedAt: '2026-11-24T05:00:00+00:00' }]);
});
