// Maths for the side-by-side charts: taste scatter, rank comparison, who played things first,
// listening clocks and month-by-month ranks. Pure functions over summaries (analyze.js) and rows.

import { summarize } from './analyze.js';
import { rowsBetween } from './report.js';

const DAY = 86400;

// ---------- Taste scatter: items both people played, with how far each leans to one of them

// lean > 0: b gives it a bigger share of their listening than a does. 1 = e times bigger.
export function tastePoints(a, b, kind, limit) {
  const points = [];
  for (const [key, x] of a[kind]) {
    const y = b[kind].get(key);
    if (!y) continue;
    points.push({ key, name: x.name, artist: x.artist, x: x.plays, y: y.plays, lean: Math.log((y.plays / b.scrobbles) / (x.plays / a.scrobbles)) });
  }
  points.sort((p, q) => (q.x + q.y) - (p.x + p.y));
  return points.slice(0, limit);
}

// The shared items each person likes most compared with the other, ignoring ones barely played.
export function lopsided(points, count, minPlays = 10) {
  const solid = points.filter(p => Math.max(p.x, p.y) >= minPlays);
  return {
    a: solid.filter(p => p.lean < 0).sort((p, q) => p.lean - q.lean).slice(0, count),
    b: solid.filter(p => p.lean > 0).sort((p, q) => q.lean - p.lean).slice(0, count),
  };
}

// ---------- Rank comparison: each person's top items, and where they sit for the other

function ranks(summary, kind) {
  const keys = [...summary[kind]].sort((p, q) => q[1].plays - p[1].plays || p[1].name.localeCompare(q[1].name)).map(([key]) => key);
  return { keys, rank: new Map(keys.map((key, i) => [key, i + 1])) };
}

export function rankPairs(a, b, kind, size) {
  const ra = ranks(a, kind), rb = ranks(b, kind);
  const side = (summary, own, other) => own.keys.slice(0, size).map(key => {
    const item = summary[kind].get(key);
    return { key, name: item.name, artist: item.artist, plays: item.plays, rank: own.rank.get(key), otherRank: other.rank.get(key) ?? null };
  });
  return { left: side(a, ra, rb), right: side(b, rb, ra) };
}

// ---------- Who played it first
// summaries: each person's all-time summary (items carry `first`, the first play).
// An item counts for whoever played it first, if they were ahead of the next person by at least minLeadDays.

export function whoWasFirst(summaries, kind, minPlays, minLeadDays = 30) {
  const n = summaries.length;
  const counts = Array(n).fill(0);
  const items = [];
  let together = 0;
  const keys = new Set(summaries.flatMap(s => [...s[kind].keys()]));
  for (const key of keys) {
    const holders = [];
    summaries.forEach((s, i) => { const item = s[kind].get(key); if (item && item.plays >= minPlays) holders.push({ i, time: item.first, item }); });
    if (holders.length < 2) continue;
    holders.sort((p, q) => p.time - q.time);
    const lead = holders[1].time - holders[0].time;
    if (lead < minLeadDays * DAY) { together++; continue; }
    counts[holders[0].i]++;
    items.push({ key, name: holders[0].item.name, artist: holders[0].item.artist, first: holders[0].i, firstTime: holders[0].time, followers: holders.slice(1).map(h => ({ i: h.i, time: h.time })), lead });
  }
  items.sort((p, q) => q.lead - p.lead);
  return { counts, together, items };
}

// ---------- Listening clocks, as shares of each person's scrobbles so different volumes compare

export function clockShares(rows) {
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0);
  for (const [time] of rows) {
    const d = new Date(time * 1000);
    hours[d.getHours()]++;
    weekdays[(d.getDay() + 6) % 7]++;
  }
  const total = rows.length || 1;
  return { hours: hours.map(h => h / total), weekdays: weekdays.map(w => w / total) };
}

// ---------- Month-by-month ranks of the top artists across a run of months (bump chart)
// months: periods from report.js. An artist outside the month's top `depth` gets null for that month.

export function monthlyRanks(rows, months, size, depth) {
  const all = { from: -Infinity, to: Infinity };
  const whole = summarize(rowsBetween(rows, months[0].from, months.at(-1).to), all);
  const top = [...whole.artists].sort((p, q) => q[1].plays - p[1].plays).slice(0, size);
  const perMonth = months.map(m => ranks(summarize(rowsBetween(rows, m.from, m.to), all), 'artists').rank);
  return top.map(([key, item]) => ({
    key, name: item.name, plays: item.plays,
    ranks: perMonth.map(rank => { const r = rank.get(key); return r && r <= depth ? r : null; }),
  }));
}
