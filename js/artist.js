// One artist's history for one person, plus the CSV export. Pure functions over scrobble rows
// ([unix time, artist, track, album], oldest first). Dates are local time.

import { nameKey, summarize } from './analyze.js';
import { dayKey } from './report.js';

const DAY = 86400;
const nextDay = key => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + 1)); };

export function dailyCounts(rows) {
  const days = new Map();
  for (const [time] of rows) {
    const key = dayKey(new Date(time * 1000));
    days.set(key, (days.get(key) || 0) + 1);
  }
  return days;   // in time order, because rows are
}

// Longest run of consecutive days with a scrobble, and the run that includes today (or yesterday).
export function streaks(days, now) {
  let longest = { length: 0 }, run = null;
  for (const key of days.keys()) {
    if (run && key === nextDay(run.end)) { run.end = key; run.length++; }
    else run = { start: key, end: key, length: 1 };
    if (run.length > longest.length) longest = { ...run };
  }
  const today = dayKey(new Date(now * 1000));
  const yesterday = dayKey(new Date((now - DAY) * 1000));
  const current = run && (run.end === today || run.end === yesterday) ? run : { length: 0 };
  return { longest, current };
}

// ---------- One artist

export function artistDetail(rows, name) {
  const key = nameKey(name);
  const mine = rows.filter(r => nameKey(r[1]) === key);
  if (!mine.length) return null;
  const s = summarize(mine, { from: -Infinity, to: Infinity });
  const top = map => [...map.values()].sort((a, b) => b.plays - a.plays);
  const days = dailyCounts(mine);
  let biggest = { key: null, count: 0 };
  for (const [day, count] of days) if (count > biggest.count) biggest = { key: day, count };
  const months = new Map();
  for (const [time] of mine) {
    const d = new Date(time * 1000);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.set(m, (months.get(m) || 0) + 1);
  }
  let peak = { key: null, count: 0 };
  for (const [m, count] of months) if (count > peak.count) peak = { key: m, count };
  return {
    name: mine.at(-1)[1],   // latest spelling
    plays: mine.length,
    first: mine[0][0],
    last: mine.at(-1)[0],
    daysPlayed: days.size,
    biggestDay: biggest,
    peakMonth: peak,
    longestStreak: streaks(days, 0).longest,
    tracks: top(s.tracks),
    albums: top(s.albums),
    rows: mine,
  };
}

// Rank of an artist among everything the person has played (1 = most played).
export function artistRank(allTime, name) {
  const plays = allTime.artists.get(nameKey(name))?.plays;
  if (!plays) return null;
  let rank = 1;
  for (const a of allTime.artists.values()) if (a.plays > plays) rank++;
  return rank;
}

// ---------- Export

const csvCell = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
export function toCsv(rows) {
  const lines = ['utc_time,unix_time,artist,track,album'];
  for (const [time, artist, track, album] of rows) {
    lines.push([new Date(time * 1000).toISOString(), time, artist, track, album].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
