import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tastePoints, lopsided, rankPairs, whoWasFirst, clockShares, monthlyRanks } from '../js/pair.js';
import { summarize } from '../js/analyze.js';
import { periodFromKey, shiftPeriod } from '../js/report.js';

const ALL = { from: -Infinity, to: Infinity };
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h) / 1000;
const rows = list => list.flatMap(([artist, n, time = 0]) => Array.from({ length: n }, (_, i) => [time + i, artist, 't', ''])).sort((a, b) => a[0] - b[0]);

const ann = summarize(rows([['X', 30], ['Y', 10], ['Only Ann', 60]]), ALL);   // 100 scrobbles
const ben = summarize(rows([['X', 5], ['Y', 15]]), ALL);                        // 20 scrobbles

test('taste points lean by share, not raw plays', () => {
  const points = tastePoints(ann, ben, 'artists', 10);
  assert.deepEqual(points.map(p => p.key), ['x', 'y']);
  const y = points.find(p => p.key === 'y');
  assert.ok(Math.abs(y.lean - Math.log(0.75 / 0.1)) < 1e-9);   // ben 75% vs ann 10%
  const x = points.find(p => p.key === 'x');
  assert.ok(x.lean < 0 === (0.25 < 0.3));
  const sides = lopsided(points, 5);
  assert.deepEqual(sides.b.map(p => p.key), ['y']);
  assert.deepEqual(sides.a.map(p => p.key), ['x']);
});

test('rank pairs', () => {
  const r = rankPairs(ann, ben, 'artists', 2);
  assert.deepEqual(r.left.map(i => [i.key, i.rank, i.otherRank]), [['only ann', 1, null], ['x', 2, 2]]);
  assert.deepEqual(r.right.map(i => [i.key, i.rank, i.otherRank]), [['y', 1, 3], ['x', 2, 2]]);
});

test('who was first needs a 30-day lead', () => {
  const a = summarize([[at(2020, 1, 1), 'Early', 't', ''], [at(2021, 1, 1), 'Same', 't', '']], ALL);
  const b = summarize([[at(2020, 6, 1), 'Early', 't', ''], [at(2021, 1, 10), 'Same', 't', '']], ALL);
  const w = whoWasFirst([a, b], 'artists', 1);
  assert.deepEqual(w.counts, [1, 0]);
  assert.equal(w.together, 1);
  assert.equal(w.items[0].name, 'Early');
  assert.equal(w.items[0].followers[0].i, 1);
});

test('clock shares add up to 1', () => {
  const c = clockShares([[at(2026, 10, 5, 9), 'A'], [at(2026, 10, 5, 21), 'A']]);   // a Monday
  assert.equal(c.hours[9], 0.5);
  assert.equal(c.weekdays[0], 1);
});

test('monthly ranks for a bump chart', () => {
  const m2 = periodFromKey('month', '2026-02'), m1 = shiftPeriod(m2, -1);
  const data = [[at(2026, 1, 5), 'A'], [at(2026, 1, 6), 'A'], [at(2026, 1, 7), 'B'], [at(2026, 2, 5), 'B'], [at(2026, 2, 6), 'B'], [at(2026, 2, 7), 'C']].map(([t, a]) => [t, a, 't', '']);
  const r = monthlyRanks(data, [m1, m2], 2, 1);
  assert.deepEqual(r.map(x => [x.name, x.ranks]), [['B', [null, 1]], ['A', [1, null]]]);
});
