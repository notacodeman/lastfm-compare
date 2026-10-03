import { test } from 'node:test';
import assert from 'node:assert/strict';
import { records, streaks, dailyCounts, obsessions, artistTimelines, forgotten, comebacks, topArtistsByYear, artistDetail, artistRank, weekHourGrid, toCsv } from '../js/lifetime.js';
import { summarize } from '../js/analyze.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min) / 1000;
const row = (time, artist, track = 't', album = '') => [time, artist, track, album];

test('streaks: longest and current runs of days', () => {
  const rows = [row(at(2026, 1, 1), 'A'), row(at(2026, 1, 2), 'A'), row(at(2026, 1, 3), 'A'),
    row(at(2026, 2, 27), 'A'), row(at(2026, 2, 28), 'A'), row(at(2026, 3, 1), 'A')];
  const s = streaks(dailyCounts(rows), at(2026, 3, 2));
  assert.equal(s.longest.length, 3);
  assert.equal(s.longest.start, '2026-01-01');
  assert.equal(s.current.length, 3);                 // ran up to yesterday, across a month end
  assert.equal(streaks(dailyCounts(rows), at(2026, 3, 5)).current.length, 0);
});

test('records: biggest day and milestones', () => {
  const rows = [row(at(2026, 1, 1), 'A'), row(at(2026, 1, 2, 9), 'B'), row(at(2026, 1, 2, 10), 'C')];
  const r = records(rows, at(2026, 1, 3));
  assert.deepEqual(r.biggestDay, { key: '2026-01-02', count: 2 });
  assert.deepEqual(r.milestones.map(m => m.n), [1]);
  assert.equal(r.milestones[0].row[1], 'A');
  assert.equal(r.daysScrobbled, 2);
});

test('obsessions: same track in a day, and back to back', () => {
  const rows = [row(at(2026, 1, 1, 9), 'A', 'x'), row(at(2026, 1, 1, 10), 'A', 'x'), row(at(2026, 1, 1, 11), 'A', 'X '),
    row(at(2026, 1, 1, 12), 'B', 'y'), row(at(2026, 1, 1, 13), 'A', 'x')];
  const o = obsessions(rows);
  assert.equal(o.days[0].count, 4);
  assert.equal(o.runs[0].count, 3);
  assert.equal(o.runs.length, 1);
});

test('forgotten favourites and comebacks', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row(at(2020, 1, 1) + i * 60, 'Old Fave'));
  for (let i = 0; i < 12; i++) rows.push(row(at(2020, 1, 2) + i * 60, 'Comeback Kid'));
  for (let i = 0; i < 12; i++) rows.push(row(at(2023, 5, 1) + i * 60, 'Comeback Kid'));
  rows.sort((a, b) => a[0] - b[0]);
  const t = artistTimelines(rows);
  assert.deepEqual(forgotten(t, at(2026, 1, 1)).map(a => a.name), ['Old Fave']);   // Comeback Kid has only 24 plays
  const c = comebacks(t);
  assert.equal(c[0].name, 'Comeback Kid');
  assert.equal(c[0].afterGap, 12);
});

test('top artists by year', () => {
  const rows = [row(at(2024, 5, 1), 'A'), row(at(2024, 5, 2), 'A'), row(at(2024, 5, 3), 'B'), row(at(2026, 1, 1), 'B')];
  const years = topArtistsByYear(rows, 2);
  assert.deepEqual(years.map(y => y.year), [2024, 2025, 2026]);
  assert.deepEqual(years[0].top.map(a => a.name), ['A', 'B']);
  assert.equal(years[1].scrobbles, 0);
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

test('week-hour grid and CSV', () => {
  const grid = weekHourGrid([row(at(2026, 10, 5, 9), 'A')]);   // a Monday
  assert.equal(grid[0][9], 1);
  assert.equal(toCsv([row(1, 'A, "B"', 't', '')]).split('\n')[1], '1970-01-01T00:00:01.000Z,1,"A, ""B""",t,');
});
