// node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, matchVideo, buildVideos, videoKind, parseDuration, normalize } from './update-videos.mjs';

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
// Real lengths in seconds, as read from the video pages.
const durations = { a: 6037, b: 588, c: 6307, d: 567, e: 5970, f: 6638, g: 434, h: 514, i: 5886 };
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

test('every real video lands on the right game', () => {
  const { matches, unmatched } = buildVideos(feed, games, {}, {}, durations);
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

test('length decides the kind: under 30 minutes is highlights, otherwise the full match', () => {
  assert.equal(videoKind(588), 'highlights');
  assert.equal(videoKind(1799), 'highlights');
  assert.equal(videoKind(1800), 'full');
  assert.equal(videoKind(6037), 'full');
  assert.equal(videoKind(undefined), 'full');   // no length available: full match, whatever the title says
});

test('lengths are kept with the link', () => {
  const { matches } = buildVideos(feed, games, {}, {}, durations);
  const kinds = k => Object.fromEntries(Object.entries(matches[k]).map(([kind, e]) => [kind, [e.id, e.durationSeconds]]));
  assert.deepEqual(kinds('2026-11-01T19:00:00-07:00'), { highlights: ['b', 588], full: ['c', 6307] });
  assert.deepEqual(kinds('2026-10-23T20:45:00-07:00'), { highlights: ['d', 567], full: ['e', 5970] });
});

test('a video whose kind changes is moved, not duplicated', () => {
  const previous = { '2026-11-01T19:00:00-07:00': { highlights: { id: 'c', title: 't', publishedAt: 'x' } } };
  const { matches } = buildVideos([feed[2]], games, previous, {}, { c: 6307 });
  assert.deepEqual(Object.keys(matches['2026-11-01T19:00:00-07:00']), ['full']);
});

test('a clip under two minutes (a Short) is not shown', () => {
  const { matches, unmatched } = buildVideos([feed[1]], games, {}, {}, { b: 45 });
  assert.deepEqual(matches, {});
  assert.equal(unmatched.length, 1);
});

test('reads the length from a watch page', () => {
  assert.equal(parseDuration('..."lengthSeconds":"6037"...'), 6037);
  assert.equal(parseDuration('<meta itemprop="duration" content="PT1H4M2S">'), 3842);
  assert.equal(parseDuration('<meta itemprop="duration" content="PT9M48S">'), 588);
  assert.equal(parseDuration('<html>nothing</html>'), null);
});

test('with no lengths at all, every upload counts as the full match', () => {
  const { matches } = buildVideos(feed, games);
  assert.ok(Object.values(matches).every(kinds => Object.keys(kinds).join() === 'full'));
});
