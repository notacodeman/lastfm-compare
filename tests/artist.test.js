import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streaks, dailyCounts, artistDetail, artistRank, toCsv } from '../js/artist.js';
import { summarize } from '../js/analyze.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h) / 1000;
const row = (time, artist, track = 't', album = '') => [time, artist, track, album];

test('longest run of days, across a month end', () => {
  const rows = [row(at(2026, 1, 1), 'A'), row(at(2026, 1, 3), 'A'), row(at(2026, 2, 28), 'A'), row(at(2026, 3, 1), 'A'), row(at(2026, 3, 2), 'A')];
  const s = streaks(dailyCounts(rows), at(2026, 3, 3));
  assert.equal(s.longest.length, 3);
  assert.equal(s.longest.start, '2026-02-28');
  assert.equal(s.current.length, 3);
});

test('artist detail and rank', () => {
  const rows = [row(at(2024, 5, 1), 'A', 'one', 'LP'), row(at(2024, 5, 1, 13), 'a', 'two', 'LP'), row(at(2024, 5, 2), 'B'), row(at(2024, 6, 2), 'A', 'one', 'LP')];
  const d = artistDetail(rows, 'A');
  assert.equal(d.plays, 3);
  assert.equal(d.tracks[0].name, 'one');
  assert.equal(d.albums[0].plays, 3);
  assert.deepEqual(d.biggestDay, { key: '2024-05-01', count: 2 });
  assert.equal(d.peakMonth.key, '2024-05');
  assert.equal(artistDetail(rows, 'nobody'), null);
  const all = summarize(rows, { from: -Infinity, to: Infinity });
  assert.equal(artistRank(all, 'A'), 1);
  assert.equal(artistRank(all, 'B'), 2);
});

test('CSV quotes commas and quotes', () => {
  assert.equal(toCsv([row(1, 'A, "B"', 't', '')]).split('\n')[1], '1970-01-01T00:00:01.000Z,1,"A, ""B""",t,');
});
