// All-time maths for one person: records, milestones, streaks, calendar, obsessions, forgotten favourites,
// comebacks, top artists by year, and one artist's history. Pure functions over scrobble rows
// ([unix time, artist, track, album], oldest first). Dates are local time.

import { nameKey, summarize } from './analyze.js';
import { dayKey, rowsBetween } from './report.js';

const DAY = 86400;
export const MILESTONES = [1, 1000, 5000, 10000, 25000, 50000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000];
const FORGOTTEN_AFTER_DAYS = 365;
const FORGOTTEN_MIN_PLAYS = 25;
const COMEBACK_GAP_DAYS = 365;
const COMEBACK_MIN_PLAYS = 10;   // plays after the return, so one stray scrobble isn't a comeback
const LIST_LENGTH = 50;

const dayStart = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const nextDay = key => { const d = dayStart(key); d.setDate(d.getDate() + 1); return dayKey(d); };

// ---------- Days, streaks, records

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

export function records(rows, now) {
  const days = dailyCounts(rows);
  let biggest = { key: null, count: 0 };
  for (const [key, count] of days) if (count > biggest.count) biggest = { key, count };
  const first = rows[0]?.[0] ?? null;
  const spanDays = first ? Math.max(1, Math.ceil((now - first) / DAY)) : 0;
  return {
    days,
    scrobbles: rows.length,
    daysScrobbled: days.size,
    spanDays,
    perDay: spanDays ? rows.length / spanDays : 0,
    biggestDay: biggest,
    ...streaks(days, now),
    milestones: MILESTONES.filter(n => n <= rows.length).map(n => ({ n, row: rows[n - 1] })),
  };
}

// 7 x 24 counts, Monday first.
export function weekHourGrid(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [time] of rows) {
    const d = new Date(time * 1000);
    grid[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  return grid;
}

// ---------- Obsessions

// The most plays of one track in a single day, and the longest runs of one track back to back.
export function obsessions(rows) {
  const perDay = new Map();
  const runs = [];
  let run = null;
  for (const [time, artist, track] of rows) {
    const key = `${nameKey(artist)}\n${nameKey(track)}`;
    const day = dayKey(new Date(time * 1000));
    const dayItem = perDay.get(`${key}\n${day}`);
    if (dayItem) dayItem.count++;
    else perDay.set(`${key}\n${day}`, { artist, track, day, count: 1 });
    if (run && run.key === key) { run.count++; run.end = time; }
    else { if (run && run.count > 1) runs.push(run); run = { key, artist, track, start: time, end: time, count: 1 }; }
  }
  if (run && run.count > 1) runs.push(run);
  const byCount = (a, b) => b.count - a.count;
  return {
    days: [...perDay.values()].filter(d => d.count > 1).sort(byCount).slice(0, LIST_LENGTH),
    runs: runs.sort(byCount).slice(0, LIST_LENGTH),
  };
}

// ---------- Forgotten favourites and comebacks

export function artistTimelines(rows) {
  const artists = new Map();
  for (const [time, artist] of rows) {
    const key = nameKey(artist);
    const a = artists.get(key);
    if (!a) { artists.set(key, { name: artist, plays: 1, first: time, last: time, gap: 0, gapFrom: null, gapTo: null, afterGap: 0 }); continue; }
    const gap = time - a.last;
    if (gap > a.gap) { a.gap = gap; a.gapFrom = a.last; a.gapTo = time; a.afterGap = 1; }
    else if (a.gapTo) a.afterGap++;
    a.plays++;
    a.last = time;
  }
  return artists;
}

export function forgotten(timelines, now) {
  return [...timelines.values()]
    .filter(a => a.plays >= FORGOTTEN_MIN_PLAYS && now - a.last >= FORGOTTEN_AFTER_DAYS * DAY)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, LIST_LENGTH);
}

export function comebacks(timelines) {
  return [...timelines.values()]
    .filter(a => a.gap >= COMEBACK_GAP_DAYS * DAY && a.afterGap >= COMEBACK_MIN_PLAYS)
    .sort((a, b) => b.afterGap - a.afterGap)
    .slice(0, LIST_LENGTH);
}

// ---------- Top artists by year

export function topArtistsByYear(rows, size = 10) {
  if (!rows.length) return [];
  const years = [];
  for (let y = new Date(rows[0][0] * 1000).getFullYear(); y <= new Date(rows.at(-1)[0] * 1000).getFullYear(); y++) {
    const slice = rowsBetween(rows, new Date(y, 0, 1) / 1000, new Date(y + 1, 0, 1) / 1000 - 1);
    const s = summarize(slice, { from: -Infinity, to: Infinity });
    const top = [...s.artists].sort((a, b) => b[1].plays - a[1].plays).slice(0, size).map(([key, a]) => ({ key, name: a.name, plays: a.plays }));
    years.push({ year: y, scrobbles: s.scrobbles, top });
  }
  return years;
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
