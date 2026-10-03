// Run with: node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, compare, overlap, periodRange, bucketAxis, countByBucket, nameKey } from '../js/analyze.js';

const ALL = { from: 0, to: Infinity };
const rows = list => list.map(([time, artist, track = 'Song', album = '']) => [time, artist, track, album]);

const ana = summarize(rows([[1, 'Radiohead', 'Creep'], [2, 'radiohead ', 'Creep'], [3, 'Björk', 'Joga'], [4, 'Low']]), ALL);
const ben = summarize(rows([[5, 'Radiohead', 'Creep'], [6, 'Low'], [7, 'Low'], [8, 'Sufjan Stevens']]), ALL);
const cal = summarize(rows([[0, 'Low'], [9, 'Björk']]), ALL);

test('names match regardless of case and spacing', () => {
  assert.equal(nameKey('  The  National '), 'the national');
  assert.equal(ana.artists.get('radiohead').plays, 2);
  assert.equal(ana.tracks.get('radiohead\ncreep').plays, 2);
});

test('summarize respects the range', () => {
  const s = summarize(rows([[1, 'A'], [5, 'B'], [9, 'C']]), { from: 2, to: 8 });
  assert.equal(s.scrobbles, 1);
  assert.deepEqual([...s.artists.keys()], ['b']);
});

test('albums with no name are skipped', () => {
  const s = summarize([[1, 'A', 't', ''], [2, 'A', 't', 'LP']], ALL);
  assert.equal(s.albums.size, 1);
});

test('compare finds shared and unique artists', () => {
  const { shared, unique, regions } = compare([ana, ben], 'artists', 1);
  assert.deepEqual(shared.map(r => r.key).sort(), ['low', 'radiohead']);
  assert.deepEqual(unique[0].map(r => r.key), ['björk']);
  assert.deepEqual(unique[1].map(r => r.key), ['sufjan stevens']);
  assert.equal(regions.get(0b11), 2);
  assert.equal(regions.get(0b01), 1);
});

test('minPlays decides who has an item', () => {
  const { shared, unique } = compare([ana, ben], 'artists', 2);
  assert.equal(shared.length, 0);
  assert.deepEqual(unique[0].map(r => r.key), ['radiohead']);
  assert.deepEqual(unique[1].map(r => r.key), ['low']);
});

test('found first picks the earliest holder', () => {
  const { shared } = compare([ana, ben, cal], 'artists', 1);
  const low = shared.find(r => r.key === 'low');
  assert.equal(low.sharedBy, 3);
  assert.equal(low.foundFirst, 2);
  assert.equal(shared[0].key, 'low', 'shared by everyone sorts first');
});

test('overlap is 1 for identical listening and 0 for none', () => {
  assert.equal(overlap(ana, ana, 'artists'), 1);
  const x = summarize(rows([[1, 'X']]), ALL);
  assert.equal(overlap(ana, x, 'artists'), 0);
  // ana: radiohead .5, björk .25, low .25; ben: radiohead .25, low .5, sufjan .25 -> .25 + .25
  assert.equal(overlap(ana, ben, 'artists'), 0.5);
  assert.equal(overlap(ben, ana, 'artists'), 0.5);
});

test('periods and buckets', () => {
  const now = 1_000_000_000;
  const last30 = periodRange('30d', now);
  assert.equal(last30.to, now);
  assert.equal(new Date(last30.from * 1000).getHours(), 0);
  assert.ok(now - last30.from > 29 * 86400 && now - last30.from <= 30 * 86400);
  const y = periodRange('2020', now);
  assert.equal(new Date(y.from * 1000).getFullYear(), 2020);
  assert.equal(new Date(y.to * 1000).getFullYear(), 2020);
  const jan = new Date(2020, 0, 15) / 1000, apr = new Date(2020, 3, 2) / 1000;
  assert.deepEqual(bucketAxis(jan, apr, 'month'), ['2020-01', '2020-02', '2020-03', '2020-04']);
  const counts = countByBucket([[jan, 'a'], [jan + 60, 'a'], [apr, 'b']], ALL, 'month');
  assert.equal(counts.get('2020-01'), 2);
});
