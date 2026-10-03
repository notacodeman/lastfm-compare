// Reports for one person over a week, month or year, like Last.fm's own reports but for any period in the
// full history. Pure functions over scrobble rows ([unix time, artist, track, album], oldest first).
// All dates are local time; weeks start on Monday.

import { nameKey, summarize } from './analyze.js';

export const UNITS = ['week', 'month', 'year'];
const DAY_MS = 86400000;
const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- Periods

// The period of `unit` that contains `date`. `key` identifies it in the URL.
export function reportPeriod(unit, date) {
  const start = new Date(date.getFullYear(), unit === 'year' ? 0 : date.getMonth(), unit === 'week' ? date.getDate() : 1);
  if (unit === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  if (unit === 'week') end.setDate(end.getDate() + 7);
  else if (unit === 'month') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  const key = unit === 'year' ? String(start.getFullYear())
    : unit === 'month' ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}`
    : dayKey(start);
  return { unit, key, start, end, from: start / 1000, to: end / 1000 - 1 };
}

export function periodFromKey(unit, key) {
  const [y, m = 1, d = 1] = String(key || '').split('-').map(Number);
  if (!UNITS.includes(unit) || !y) return null;
  return reportPeriod(unit, new Date(y, m - 1, d));
}

// The period `steps` before (-) or after (+) this one.
export function shiftPeriod(period, steps) {
  const d = new Date(period.start);
  if (period.unit === 'week') d.setDate(d.getDate() + 7 * steps);
  else if (period.unit === 'month') d.setMonth(d.getMonth() + steps);
  else d.setFullYear(d.getFullYear() + steps);
  return reportPeriod(period.unit, d);
}

export function periodLabel(period) {
  const { unit, start } = period;
  if (unit === 'year') return String(start.getFullYear());
  if (unit === 'month') return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const last = new Date(period.end - DAY_MS);
  const from = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const to = last.toLocaleDateString('en-US', { month: start.getMonth() === last.getMonth() ? undefined : 'short', day: 'numeric', year: 'numeric' });
  return `${from} – ${to}`;
}

// What the period is split into for the "by day" chart: days of a week or month, months of a year.
export function periodBuckets(period) {
  const buckets = [];
  const d = new Date(period.start);
  while (d < period.end) {
    const next = new Date(d);
    if (period.unit === 'year') next.setMonth(next.getMonth() + 1); else next.setDate(next.getDate() + 1);
    buckets.push({
      from: d / 1000, to: next / 1000 - 1,
      short: period.unit === 'year' ? d.toLocaleDateString('en-US', { month: 'short' })
        : period.unit === 'week' ? d.toLocaleDateString('en-US', { weekday: 'short' }) : String(d.getDate()),
      day: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      long: period.unit === 'year' ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    });
    d.setTime(next);
  }
  return buckets;
}

// ---------- Rows

// Rows are sorted by time, so a period is a slice found by binary search.
export function rowsBetween(rows, from, to) {
  const first = t => { let lo = 0, hi = rows.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] < t) lo = mid + 1; else hi = mid; } return lo; };
  return rows.slice(first(from), first(to + 1));
}

// When each artist, album and track was first played, over the whole history.
export function firstPlays(rows) {
  const artists = new Map(), albums = new Map(), tracks = new Map();
  for (const [time, artist, track, album] of rows) {
    const a = nameKey(artist);
    if (!artists.has(a)) artists.set(a, time);
    const t = `${a}\n${nameKey(track)}`;
    if (!tracks.has(t)) tracks.set(t, time);
    if (album) { const al = `${a}\n${nameKey(album)}`; if (!albums.has(al)) albums.set(al, time); }
  }
  return { artists, albums, tracks };
}

// ---------- The report

const TOP_LIST = 25;
const CONCENTRATION_ARTISTS = 5;

export function buildReport(rows, period, first, now) {
  const slice = rowsBetween(rows, period.from, period.to);
  const previous = shiftPeriod(period, -1);
  const prevSlice = rowsBetween(rows, previous.from, previous.to);
  // A period still under way is compared with the previous one up to the same point
  // (Oct 1–2 against Sep 1–2), not with the whole of it.
  const ongoing = period.end / 1000 > now;
  const elapsed = Math.min(period.end / 1000, now) - period.from;
  const prevTo = ongoing ? Math.min(previous.to, previous.from + elapsed) : previous.to;
  const all = { from: -Infinity, to: Infinity };
  const summary = summarize(slice, all);
  const prevSummary = summarize(rowsBetween(prevSlice, previous.from, prevTo), all);

  // by day (or month) this period and last, lined up by position
  const buckets = periodBuckets(period);
  const prevBuckets = periodBuckets(previous);
  const countIn = (list, rowsIn) => list.map(b => rowsBetween(rowsIn, b.from, b.to).length);
  const byBucket = countIn(buckets, slice);
  const prevByBucket = countIn(prevBuckets, prevSlice);

  // listening clock
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0);
  const activeDays = new Set();
  for (const [time] of slice) {
    const d = new Date(time * 1000);
    hours[d.getHours()]++;
    weekdays[(d.getDay() + 6) % 7]++;
    activeDays.add(dayKey(d));
  }
  const elapsedDays = Math.max(1, Math.ceil(elapsed / 86400));
  const prevDays = Math.max(1, Math.ceil((prevTo - previous.from) / 86400));
  const busiestDay = buckets.length && period.unit !== 'year'
    ? buckets.reduce((best, b, i) => byBucket[i] > best.count ? { label: b.day, count: byBucket[i] } : best, { label: null, count: 0 })
    : null;

  // top lists, with whether each item was first played in this period
  const isNew = (kind, key) => first[kind].get(key) >= period.from;
  const top = {}, fresh = {};
  for (const kind of ['artists', 'albums', 'tracks']) {
    const items = [...summary[kind]].map(([key, item]) => ({ ...item, key, isNew: isNew(kind, key) }));
    items.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
    const newItems = items.filter(i => i.isNew);
    const prevNew = [...prevSummary[kind].keys()].filter(key => first[kind].get(key) >= previous.from).length;
    top[kind] = items.slice(0, TOP_LIST);
    fresh[kind] = {
      items: newItems,
      share: items.length ? newItems.length / items.length : 0,
      prevShare: prevSummary[kind].size ? prevNew / prevSummary[kind].size : 0,
      plays: newItems.reduce((n, i) => n + i.plays, 0),
    };
  }

  const scrobbles = summary.scrobbles;
  const topArtistPlays = top.artists.slice(0, CONCENTRATION_ARTISTS).reduce((n, a) => n + a.plays, 0);
  return {
    period, previous, ongoing, summary, prevSummary,
    buckets, byBucket, prevByBucket,
    hours, weekdays,
    busiestHour: hours.indexOf(Math.max(...hours)),
    busiestDay,
    activeDays: activeDays.size,
    elapsedDays,
    perDay: scrobbles / elapsedDays,
    prevPerDay: prevSummary.scrobbles / prevDays,
    top, fresh,
    // fingerprint, all 0..1
    consistency: activeDays.size / elapsedDays,
    discovery: fresh.artists.share,
    concentration: scrobbles ? topArtistPlays / scrobbles : 0,
    replay: scrobbles ? (scrobbles - summary.tracks.size) / scrobbles : 0,
  };
}

// The 12 months ending with the period's last month (or a year's own months), for the month-by-month table.
export function monthsAround(period) {
  const lastMonth = period.unit === 'year' ? new Date(period.start.getFullYear(), 11, 1) : new Date(period.end - DAY_MS);
  return Array.from({ length: 12 }, (_, i) => reportPeriod('month', new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 11 + i, 1)));
}

export function monthRow(rows, month, first) {
  const summary = summarize(rowsBetween(rows, month.from, month.to), { from: -Infinity, to: Infinity });
  let topArtist = null, topTrack = null, newArtists = 0;
  for (const [key, item] of summary.artists) {
    if (!topArtist || item.plays > topArtist.plays) topArtist = item;
    if (first.artists.get(key) >= month.from) newArtists++;
  }
  for (const item of summary.tracks.values()) if (!topTrack || item.plays > topTrack.plays) topTrack = item;
  return { month, summary, scrobbles: summary.scrobbles, artists: summary.artists.size, newArtists, topArtist, topTrack };
}
