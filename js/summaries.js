// Each person's summaries, worked out once and kept on the person until their history changes.

import { summarize } from './analyze.js';
import { rowsBetween, firstPlays } from './report.js';

const ALL = { from: -Infinity, to: Infinity };

function cached(person, key, make) {
  person.cache ??= new Map();
  if (!person.cache.has(key)) person.cache.set(key, make());
  return person.cache.get(key);
}

export const clearCache = person => person.cache?.clear();

// period: the Compare tab's period ('all', '12m', '2024'…), range: its unix-second bounds
export const periodSummary = (person, period, range) =>
  cached(person, `period:${period}`, () => summarize(rowsBetween(person.rows, range.from, range.to), ALL));

export const allTimeSummary = person => cached(person, 'all', () => summarize(person.rows, ALL));

export const yearSummary = (person, year) => cached(person, `year:${year}`, () =>
  summarize(rowsBetween(person.rows, new Date(year, 0, 1) / 1000, new Date(year + 1, 0, 1) / 1000 - 1), ALL));

// When each artist, album and track was first played
export const firstPlaysOf = person => cached(person, 'first', () => firstPlays(person.rows));
