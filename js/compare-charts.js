// The Compare tab's charts: listening over time, compatibility over time, side by side (top 100s and
// "leans to" lists), who played it first, and when you listen.

import { $, esc, fmt, pct, fmtDate, fitRows, listRow, swatch, personColor, keyDate, hourLabel, WEEKDAYS, nowSec } from './util.js';
import { PANEL_ROWS, LEAN_CANDIDATES, LEAN_LIST, SLOPE_SIZE, SLOPE_VISIBLE_ROWS, FIRST_LEAD_DAYS, DAILY_CHART_UP_TO_DAYS } from './config.js';
import { countByBucket, bucketAxis, bucketKey, overlap } from './analyze.js';
import { rowsBetween } from './report.js';
import { tastePoints, lopsided, rankPairs, whoWasFirst, clockShares } from './pair.js';
import { yearSummary } from './summaries.js';
import { lineChart, slopeChart } from './charts.js';

const DAY = 86400;
const legend = (selector, series) => {
  $(selector).innerHTML = series.map(s => `<span>${swatch(s.color || s.slot)}${esc(s.name)}</span>`).join('');
};
const timeSpan = seconds => {
  const days = seconds / DAY;
  return days >= 365 ? `${(days / 365).toFixed(1)} years` : days >= 60 ? `${Math.round(days / 30.4)} months` : `${Math.round(days)} days`;
};
// The artist an item belongs to (itself for artists), for opening the artist page.
const artistOf = item => item.artist || item.name;

// ---------- Listening over time: scrobbles per day or month, or a running total

export function renderTimeline({ people, range, wholeHistory, runningTotal }) {
  const slices = people.map(p => rowsBetween(p.rows, range.from, range.to));
  const active = slices.filter(rows => rows.length);
  if (!active.length) { $('#timelineChart').innerHTML = '<p class="note">No scrobbles in this period.</p>'; return; }
  const from = wholeHistory ? Math.min(...active.map(rows => rows[0][0])) : range.from;
  const to = Math.min(range.to, nowSec());
  const unit = (to - from) / DAY <= DAILY_CHART_UP_TO_DAYS ? 'day' : 'month';
  const keys = bucketAxis(from, to, unit);

  const series = people.map((p, i) => {
    const counts = countByBucket(slices[i], range, unit);
    const started = p.rows.length ? bucketKey(p.rows[0][0], unit) : '';
    let total = 0;
    const values = keys.map(k => {
      if (k < started) return null;   // no line before someone started scrobbling
      total = runningTotal ? total + (counts.get(k) || 0) : counts.get(k) || 0;
      return total;
    });
    return { name: p.profile.name, slot: p.slot, values };
  });

  const labelFor = (key, short) => {
    const date = keyDate(key);
    if (unit === 'day') return date.toLocaleDateString('en-US', short ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (short && keys.length > 30) return key.slice(0, 4);
    const text = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return !short && key === keys.at(-1) && to >= nowSec() - DAY ? `${text} (so far)` : text;
  };
  legend('#timelineLegend', series);
  lineChart($('#timelineChart'), { keys, series, labelFor, isYearStart: unit === 'month' ? key => key.endsWith('-01') : null });
}

// ---------- Compatibility over time: listening in common for each calendar year
// With two people that's one line; with more, one person against each of the others.

export function renderCompatibility({ people, kind, focusKey }) {
  const withRows = people.filter(p => p.rows.length);
  if (withRows.length < 2) return;
  const focus = withRows.find(p => p.key === focusKey) || withRows[0];
  const picker = $('#compatPerson');
  picker.hidden = withRows.length < 3;
  picker.innerHTML = withRows.map(p => `<option value="${esc(p.key)}"${p === focus ? ' selected' : ''}>${esc(p.profile.name)} with everyone</option>`).join('');

  const pairs = withRows.length === 2 ? [withRows] : withRows.filter(p => p !== focus).map(p => [focus, p]);
  const firstYear = Math.min(...withRows.map(p => new Date(p.rows[0][0] * 1000).getFullYear()));
  let years = [];
  for (let y = firstYear; y <= new Date().getFullYear(); y++) years.push(y);
  let series = pairs.map(([a, b]) => ({
    name: withRows.length === 2 ? `${a.profile.name} & ${b.profile.name}` : `with ${b.profile.name}`,
    slot: b.slot,
    color: withRows.length === 2 ? 'var(--text)' : undefined,
    values: years.map(year => {
      const sa = yearSummary(a, year), sb = yearSummary(b, year);
      return sa.scrobbles && sb.scrobbles ? overlap(sa, sb, kind) : null;
    }),
  }));
  // start at the first year two people both scrobbled
  const start = Math.max(0, years.findIndex((_, i) => series.some(s => s.values[i] != null)));
  years = years.slice(start);
  series = series.map(s => ({ ...s, values: s.values.slice(start) }));

  legend('#compatLegend', series);
  $('#compatNote').textContent = `Listening in common for ${kind} in each calendar year, measured the same way as above. Gaps are years when one of you didn't scrobble.`;
  lineChart($('#compatChart'), {
    keys: years.map(String), series, labelFor: key => key, format: pct, showTotal: false,
    max: Math.max(0.1, ...series.flatMap(s => s.values).filter(v => v != null)),
  });
}

// ---------- Side by side: two people's top lists and what leans to each

// sa, sb: the two people's summaries for the period
export function renderPair({ a, b, sa, sb, kind, onArtist }) {
  const ranks = rankPairs(sa, sb, kind, SLOPE_SIZE);
  const rightKeys = new Set(ranks.right.map(item => item.key));
  const onBoth = ranks.left.filter(item => rightKeys.has(item.key)).length;
  $('#slopeTitle').innerHTML = `<span>Top ${SLOPE_SIZE} ${kind} side by side</span><small>${fmt(onBoth)} on both lists</small>`;
  slopeChart($('#slopeChart'), { ...ranks, a, b, visibleRows: SLOPE_VISIBLE_ROWS, onPick: item => onArtist(artistOf(item)) });

  const sides = lopsided(tastePoints(sa, sb, kind, LEAN_CANDIDATES), LEAN_LIST);
  // mine/theirs: which of a point's play counts (x is a's, y is b's) belongs to the list's person
  const leanList = (person, other, list, mine, theirs) => `
    <h3><span>${swatch(person.slot)}Leans to ${esc(person.profile.name)}</span><small>${fmt(list.length)}</small></h3>
    <ul class="item-list">${list.map(p => {
      const times = Math.exp(Math.abs(p.lean));
      const sub = `${fmt(p[mine])} vs ${fmt(p[theirs])} for ${esc(other.profile.name)}`;
      return listRow(p, `${times >= 10 ? Math.round(times) : times.toFixed(1)}×`, { sub });
    }).join('') || `<li class="empty">Nothing leans clearly to ${esc(person.profile.name)}.</li>`}</ul>`;
  $('#leanA').innerHTML = leanList(a, b, sides.a, 'x', 'y');
  $('#leanB').innerHTML = leanList(b, a, sides.b, 'y', 'x');
  document.querySelectorAll('#pair .item-list').forEach(list => fitRows(list, PANEL_ROWS));
}

// ---------- Who played it first (across everyone's whole history)

// allTime: each person's all-time summary
export function renderFirsts({ people, allTime, kind, minPlays }) {
  const w = whoWasFirst(allTime, kind, minPlays, FIRST_LEAD_DAYS);
  const total = w.counts.reduce((a, b) => a + b, 0) + w.together;
  $('#firstsNote').textContent = `Across everyone's whole history: for each ${kind.slice(0, -1)} at least two of you have played${minPlays > 1 ? ` ${minPlays}+ times` : ''}, `
    + `who scrobbled it first, if they were ahead by ${FIRST_LEAD_DAYS}+ days. This shows who got there first, not who introduced whom.`;

  const max = Math.max(1, ...w.counts, w.together);
  const bar = (label, count, color) => `<div class="bar-row"><span>${label}</span>
    <div class="bar">${count ? `<span style="width:${(count / max) * 100}%;background:${color}"></span>` : ''}</div>
    <span class="value">${fmt(count)}</span></div>`;
  $('#firstsCounts').innerHTML = `<h3><span>First to it</span><small>${fmt(total)} shared ${kind}</small></h3>
    <div class="bar-rows firsts-bars">
      ${people.map((p, i) => bar(`${swatch(p.slot)}${esc(p.profile.name)}`, w.counts[i], personColor(p.slot))).join('')}
      ${bar('Within a month', w.together, 'var(--muted)')}
    </div>`;

  const rows = w.items.slice(0, 200).map(item => {
    const first = people[item.first];
    const followers = item.followers.map(f => `${esc(people[f.i].profile.name)} ${timeSpan(f.time - item.firstTime)} later`).join(', ');
    const sub = `${swatch(first.slot)}${esc(first.profile.name)} ${fmtDate(item.firstTime)}, then ${followers}`;
    return listRow(item, timeSpan(item.lead).replace(' ', '&nbsp;'), { sub });
  }).join('');
  $('#firstsList').innerHTML = `<h3><span>Biggest head starts</span><small>${fmt(w.items.length)}</small></h3>
    <ul class="item-list">${rows || `<li class="empty">No ${kind} where someone was a month or more ahead.</li>`}</ul>`;
  fitRows($('#firstsList .item-list'), PANEL_ROWS);
}

// ---------- When you listen: hour and weekday, as shares of each person's scrobbles

export function renderClocks({ people, range }) {
  const clocks = people.map(p => clockShares(rowsBetween(p.rows, range.from, range.to)));
  const series = key => people.map((p, i) => ({ name: p.profile.name, slot: p.slot, values: clocks[i][key] }));
  const top = key => Math.max(0.01, ...clocks.flatMap(c => c[key]));
  const format = v => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  legend('#clockLegend', series('hours'));
  lineChart($('#hourChart'), {
    keys: Array.from({ length: 24 }, (_, h) => String(h)), series: series('hours'), format, showTotal: false, max: top('hours'),
    labelFor: (key, short) => short ? hourLabel(+key) : `${hourLabel(+key)}–${hourLabel((+key + 1) % 24)}`,
  });
  lineChart($('#weekdayChart'), {
    keys: WEEKDAYS, series: series('weekdays'), format, showTotal: false, max: top('weekdays'), labelFor: key => key,
  });
}
