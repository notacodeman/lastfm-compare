import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriod, periodFromKey, shiftPeriod, periodLabel, periodBuckets, rowsBetween, firstPlays, buildReport, monthsAround } from '../js/report.js';
import { genreName, genreShares, genreVariety } from '../js/genres.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h) / 1000;

test('periods: weeks start on Monday, months and years line up', () => {
  const week = reportPeriod('week', new Date(2026, 9, 1));   // Thu 1 Oct 2026
  assert.equal(week.key, '2026-09-28');
  assert.equal(week.start.getDay(), 1);
  assert.equal(periodLabel(week), 'Sep 28 – Oct 4, 2026');
  assert.equal(periodBuckets(week).length, 7);
  const month = periodFromKey('month', '2026-02');
  assert.equal(periodLabel(month), 'February 2026');
  assert.equal(periodBuckets(month).length, 28);
  assert.equal(shiftPeriod(month, -1).key, '2026-01');
  assert.equal(shiftPeriod(periodFromKey('month', '2026-01'), -1).key, '2025-12');
  assert.equal(periodBuckets(periodFromKey('year', '2024')).length, 12);
  assert.equal(periodFromKey('decade', '2024'), null);
});

test('rowsBetween slices by time, inclusive', () => {
  const rows = [[1], [2], [3], [5], [8]];
  assert.deepEqual(rowsBetween(rows, 2, 5).map(r => r[0]), [2, 3, 5]);
  assert.deepEqual(rowsBetween(rows, 6, 7), []);
});

test('report: new music, clock, fingerprint', () => {
  const rows = [
    [at(2026, 8, 3), 'Old Band', 'Old Song', 'Old LP'],
    [at(2026, 9, 1, 9), 'Old Band', 'Old Song', 'Old LP'],
    [at(2026, 9, 1, 9), 'New Band', 'Fresh', 'Debut'],
    [at(2026, 9, 2, 21), 'New Band', 'Fresh', 'Debut'],
    [at(2026, 9, 2, 21), 'New Band', 'Other', 'Debut'],
  ];
  const sept = periodFromKey('month', '2026-09');
  const r = buildReport(rows, sept, firstPlays(rows), at(2026, 10, 1));
  assert.equal(r.summary.scrobbles, 4);
  assert.equal(r.prevSummary.scrobbles, 1);
  assert.deepEqual(r.top.artists.map(a => [a.name, a.plays, a.isNew]), [['New Band', 3, true], ['Old Band', 1, false]]);
  assert.equal(r.fresh.artists.share, 0.5);
  assert.equal(r.fresh.tracks.items.length, 2);
  assert.equal(r.byBucket[0], 2);
  assert.equal(r.byBucket[1], 2);
  assert.equal(r.prevByBucket[2], 1);           // Aug 3 lines up with Sep 3
  assert.equal(r.hours[9], 2);
  assert.equal(r.busiestHour, 9);
  assert.equal(r.activeDays, 2);
  assert.equal(r.elapsedDays, 30);
  assert.equal(r.replay, (4 - 3) / 4);
  assert.equal(r.concentration, 1);
});

test('monthsAround gives 12 months ending at the period', () => {
  const months = monthsAround(periodFromKey('month', '2026-03'));
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-04');
  assert.equal(months[11].key, '2026-03');
  assert.equal(monthsAround(periodFromKey('year', '2020'))[0].key, '2020-01');
});

test('genres: clean-up, shares and variety', () => {
  assert.equal(genreName('Seen Live'), null);
  assert.equal(genreName('80s'), null);
  assert.equal(genreName('2010s'), null);
  assert.equal(genreName('Hip-Hop'), 'hip hop');
  const tags = { A: [{ name: 'rock', count: 100 }, { name: 'usa', count: 50 }], B: [{ name: 'jazz', count: 100 }, { name: 'rock', count: 100 }], C: [] };
  const g = genreShares([{ name: 'A', plays: 6 }, { name: 'B', plays: 2 }, { name: 'C', plays: 2 }], n => tags[n]);
  assert.equal(g.tagged, 8);
  assert.equal(g.coverage, 0.8);
  assert.deepEqual(g.shares.map(s => [s.name, s.plays]), [['rock', 7], ['jazz', 1]]);
  assert.equal(genreVariety([{ share: 0.5 }, { share: 0.5 }]).toFixed(5), '2.00000');
  assert.equal(genreVariety([{ share: 1 }]), 1);
});

test('a period under way is compared with the same stretch of the one before', () => {
  const rows = [[at(2026, 9, 1), 'A', 't', ''], [at(2026, 9, 20), 'A', 't', ''], [at(2026, 10, 1), 'A', 't', '']];
  const r = buildReport(rows, periodFromKey('month', '2026-10'), firstPlays(rows), at(2026, 10, 2, 0));
  assert.equal(r.ongoing, true);
  assert.equal(r.prevSummary.scrobbles, 1);     // only Sep 1, not Sep 20
  assert.equal(r.prevByBucket[19], 1);          // the chart still shows all of September
  assert.equal(r.busiestDay.label, 'Thu, Oct 1');
});
