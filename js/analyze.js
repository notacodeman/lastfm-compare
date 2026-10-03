// The comparison maths. Pure functions over scrobble rows ([unix time, artist, track, album], oldest first),
// with no DOM, so tests/analyze.test.js can run them in Node.

const DAY = 86400;
export const KINDS = ['artists', 'tracks', 'albums'];

// Names are matched case-insensitively with whitespace collapsed; Last.fm already corrects most spellings.
export const nameKey = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

// period: 'all' | '12m' | '90d' | '30d' | a year like '2019'. Returns unix seconds, inclusive.
export function periodRange(period, now) {
  const days = { '30d': 30, '90d': 90, '12m': 365 }[period];
  if (days) {   // whole days, so the first day on the chart isn't a partial one
    const start = new Date(now * 1000);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    return { from: start / 1000, to: now };
  }
  if (/^\d{4}$/.test(period)) {
    const year = +period;
    return { from: new Date(year, 0, 1) / 1000, to: new Date(year + 1, 0, 1) / 1000 - 1 };
  }
  return { from: 0, to: now };
}

// Play counts per artist, track and album within the range. `first` is each item's first scrobble in it.
export function summarize(rows, { from, to }) {
  const artists = new Map(), tracks = new Map(), albums = new Map();
  let scrobbles = 0, first = null, last = null;
  for (const [time, artist, track, album] of rows) {
    if (time < from || time > to) continue;
    scrobbles++;
    first ??= time;
    last = time;
    const artistKey = nameKey(artist);
    tally(artists, artistKey, artist, null, time);
    tally(tracks, `${artistKey}\n${nameKey(track)}`, track, artist, time);
    if (album) tally(albums, `${artistKey}\n${nameKey(album)}`, album, artist, time);
  }
  return { scrobbles, first, last, artists, tracks, albums };
}

function tally(map, key, name, artist, time) {
  const item = map.get(key);
  if (item) item.plays++;
  else map.set(key, { name, artist, plays: 1, first: time });
}

// Lines up every person's items. Someone "has" an item when they played it at least minPlays times.
//   shared   items at least two people have, with everyone's plays and first-play times
//   unique   per person, items only they have
//   regions  how many items each combination of people has (bitmask -> count), for the Venn diagram
export function compare(summaries, kind, minPlays) {
  const n = summaries.length;
  const all = new Map();
  summaries.forEach((summary, i) => {
    for (const [key, item] of summary[kind]) {
      let row = all.get(key);
      if (!row) all.set(key, row = { key, name: item.name, artist: item.artist, plays: Array(n).fill(0), first: Array(n).fill(null) });
      row.plays[i] = item.plays;
      row.first[i] = item.first;
    }
  });

  const shared = [], unique = summaries.map(() => []), regions = new Map();
  for (const row of all.values()) {
    let mask = 0, count = 0;
    row.plays.forEach((plays, i) => { if (plays >= minPlays) { mask |= 1 << i; count++; } });
    if (!mask) continue;
    regions.set(mask, (regions.get(mask) || 0) + 1);
    if (count === 1) { unique[Math.log2(mask)].push(row); continue; }
    row.sharedBy = count;
    row.together = Math.min(...row.plays.filter(p => p >= minPlays));   // the least any holder played it
    row.foundFirst = firstListener(row, minPlays);
    shared.push(row);
  }
  shared.sort((a, b) => b.sharedBy - a.sharedBy || b.together - a.together || a.name.localeCompare(b.name));
  unique.forEach((list, i) => list.sort((a, b) => b.plays[i] - a.plays[i] || a.name.localeCompare(b.name)));
  return { shared, unique, regions };
}

function firstListener(row, minPlays) {
  let best = -1;
  row.first.forEach((time, i) => {
    if (row.plays[i] >= minPlays && (best < 0 || time < row.first[best])) best = i;
  });
  return best;
}

// Share of listening two people have in common: the sum over items of the smaller of their two play shares.
// 1 means identical listening proportions, 0 means nothing in common.
export function overlap(a, b, kind) {
  const total = map => { let t = 0; for (const item of map.values()) t += item.plays; return t; };
  const [mapA, mapB] = [a[kind], b[kind]];
  const [totalA, totalB] = [total(mapA), total(mapB)];
  if (!totalA || !totalB) return 0;
  let sum = 0;
  for (const [key, item] of mapA) {
    const other = mapB.get(key);
    if (other) sum += Math.min(item.plays / totalA, other.plays / totalB);
  }
  return sum;
}

// Scrobbles per day or month, keyed 'YYYY-MM' or 'YYYY-MM-DD' in local time.
export function bucketKey(time, unit) {
  const d = new Date(time * 1000);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return unit === 'day' ? `${month}-${String(d.getDate()).padStart(2, '0')}` : month;
}

export function countByBucket(rows, { from, to }, unit) {
  const counts = new Map();
  for (const [time] of rows) {
    if (time < from || time > to) continue;
    const key = bucketKey(time, unit);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Every bucket key from one time to another, so gaps show as zero.
export function bucketAxis(from, to, unit) {
  const keys = [];
  const d = new Date(from * 1000);
  d.setHours(0, 0, 0, 0);
  if (unit === 'month') d.setDate(1);
  const end = to * 1000;
  while (d <= end) {
    keys.push(bucketKey(d / 1000, unit));
    if (unit === 'day') d.setDate(d.getDate() + 1); else d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

// Scrobbles per day over the part of the range the person was scrobbling.
export function perDay(summary, range, firstEver, now) {
  if (!summary.scrobbles) return 0;
  const start = Math.max(range.from, firstEver ?? summary.first);
  const end = Math.min(range.to, now);
  return summary.scrobbles / Math.max(1, (end - start) / DAY);
}
