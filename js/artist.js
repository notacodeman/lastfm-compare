// One artist's history for one person, and the CSV export. Pure functions over scrobble rows
// ([unix time, artist, track, album], oldest first). Dates are local time.

import { nameKey, summarize, bucketKey } from './analyze.js';
import { dayKey } from './report.js';

const nextDay = key => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
};

// Counts per key, with the busiest key: { counts: Map, top: { key, count } }
function countBy(rows, keyOf) {
  const counts = new Map();
  let top = { key: null, count: 0 };
  for (const row of rows) {
    const key = keyOf(row);
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > top.count) top = { key, count };
  }
  return { counts, top };
}

// The longest run of consecutive days in a list of day keys (oldest first).
export function longestStreak(days) {
  let longest = 0, run = 0, previous = null;
  for (const day of days) {
    run = previous && day === nextDay(previous) ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return longest;
}

export function artistDetail(rows, name) {
  const key = nameKey(name);
  const mine = rows.filter(r => nameKey(r[1]) === key);
  if (!mine.length) return null;
  const { tracks, albums } = summarize(mine, { from: -Infinity, to: Infinity });
  const byPlays = map => [...map.values()].sort((a, b) => b.plays - a.plays);
  const days = countBy(mine, ([time]) => dayKey(new Date(time * 1000)));
  const months = countBy(mine, ([time]) => bucketKey(time, 'month'));
  return {
    name: mine.at(-1)[1],   // the latest spelling
    plays: mine.length,
    first: mine[0][0],
    last: mine.at(-1)[0],
    daysPlayed: days.counts.size,
    biggestDay: days.top,
    peakMonth: months.top,
    longestStreak: longestStreak(days.counts.keys()),
    tracks: byPlays(tracks),
    albums: byPlays(albums),
    rows: mine,
  };
}

// Where an artist ranks among everything the person has played (1 = most played).
export function artistRank(allTime, name) {
  const plays = allTime.artists.get(nameKey(name))?.plays;
  if (!plays) return null;
  let rank = 1;
  for (const a of allTime.artists.values()) if (a.plays > plays) rank++;
  return rank;
}

const csvCell = value => /[",\n]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : String(value);

export function toCsv(rows) {
  const lines = rows.map(([time, artist, track, album]) =>
    [new Date(time * 1000).toISOString(), time, artist, track, album].map(csvCell).join(','));
  return ['utc_time,unix_time,artist,track,album', ...lines].join('\n') + '\n';
}
