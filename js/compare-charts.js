// Compare tab charts that look at people side by side: top-100 ranking, "leans to" lists,
// who played things first, and listening clocks.

import { $, esc, fmt, fmtDate, fitRows, artistLink } from './util.js';
import { PANEL_ROWS, LEAN_CANDIDATES, LEAN_LIST, SLOPE_SIZE, SLOPE_VISIBLE_ROWS, FIRST_LEAD_DAYS } from './config.js';
import { tastePoints, lopsided, rankPairs, whoWasFirst, clockShares } from './pair.js';
import { rowsBetween } from './report.js';
import { slopeChart, lineChart, drawResponsive } from './charts.js';

const NOUN = { artists: 'artists', albums: 'albums', tracks: 'tracks' };
const swatch = slot => `<span class="swatch" style="--color:var(--person-${slot})"></span>`;
const pct = v => `${Math.round(v * 100)}%`;
const span = seconds => { const days = seconds / 86400; return days >= 365 ? `${(days / 365).toFixed(1)} years` : days >= 60 ? `${Math.round(days / 30.4)} months` : `${Math.round(days)} days`; };
// The artist an item belongs to (itself for artists), for opening the artist page.
const artistOf = item => item.artist || item.name;

// ---------- Side by side (one pair at a time)

export function renderPair({ a, b, sa, sb, kind, onArtist }) {
  const noun = NOUN[kind];
  const points = tastePoints(sa, sb, kind, LEAN_CANDIDATES);
  const sides = lopsided(points, LEAN_LIST);
  const leanList = (person, list, other) => `<h3><span>${swatch(person.slot)}Leans to ${esc(person.profile.name)}</span><small>${fmt(list.length)}</small></h3>
    <ul class="unique-list">${list.map(p => {
      const times = Math.exp(Math.abs(p.lean));
      const name = p.artist ? esc(p.name) : artistLink(p.name);
      return `<li><div><div class="item-name">${name}</div><span class="item-sub">${p.artist ? `${artistLink(p.artist)} · ` : ''}${fmt(person === a ? p.x : p.y)} vs ${fmt(person === a ? p.y : p.x)} for ${esc(other.profile.name)}</span></div><span class="num">${times >= 10 ? Math.round(times) : times.toFixed(1)}×</span></li>`;
    }).join('') || `<li class="empty">Nothing leans clearly to ${esc(person.profile.name)}.</li>`}</ul>`;
  $('#leanA').innerHTML = leanList(a, sides.a, b);
  $('#leanB').innerHTML = leanList(b, sides.b, a);
  document.querySelectorAll('#pair .unique-list').forEach(list => fitRows(list, PANEL_ROWS));

  const ranks = rankPairs(sa, sb, kind, SLOPE_SIZE);
  const both = ranks.left.filter(l => ranks.right.some(r => r.key === l.key)).length;
  $('#slopeTitle').innerHTML = `<span>Top ${SLOPE_SIZE} ${noun} side by side</span><small>${fmt(both)} on both lists</small>`;
  slopeChart($('#slopeChart'), { ...ranks, a, b, visibleRows: SLOPE_VISIBLE_ROWS, onPick: item => onArtist(artistOf(item)) });
}

// ---------- Who played it first (all time)

export function renderFirsts({ people, allTime, kind, minPlays }) {
  const noun = NOUN[kind];
  const w = whoWasFirst(allTime, kind, minPlays, FIRST_LEAD_DAYS);
  const total = w.counts.reduce((a, b) => a + b, 0) + w.together;
  $('#firstsNote').textContent = `Across everyone's whole history: for each ${noun.slice(0, -1)} at least two of you have played${minPlays > 1 ? ` ${minPlays}+ times` : ''}, who scrobbled it first, if they were ahead by ${FIRST_LEAD_DAYS}+ days. This shows who got there first, not who introduced whom.`;
  const max = Math.max(1, ...w.counts, w.together);
  const bar = (label, count, color) => `<div class="bar-row"><span>${label}</span><div class="bar">${count ? `<span style="width:${(count / max) * 100}%;background:${color}"></span>` : ''}</div><span class="value">${fmt(count)}</span></div>`;
  $('#firstsCounts').innerHTML = `<h3><span>First to it</span><small>${fmt(total)} shared ${noun}</small></h3><div class="bar-rows firsts-bars">${
    people.map((p, i) => bar(`${swatch(p.slot)}${esc(p.profile.name)}`, w.counts[i], `var(--person-${p.slot})`)).join('')
  }${bar('Within a month', w.together, 'var(--muted)')}</div>`;

  const items = w.items.slice(0, 200).map(item => {
    const first = people[item.first];
    const followers = item.followers.map(f => `${esc(people[f.i].profile.name)} ${span(f.time - item.firstTime)} later`).join(', ');
    const name = item.artist ? esc(item.name) : artistLink(item.name);
    return `<li><div><div class="item-name">${name}</div><span class="item-sub">${item.artist ? `${artistLink(item.artist)} · ` : ''}${swatch(first.slot)}${esc(first.profile.name)} ${fmtDate(item.firstTime)}, then ${followers}</span></div><span class="num">${span(item.lead).replace(' ', '&nbsp;')}</span></li>`;
  }).join('');
  $('#firstsList').innerHTML = `<h3><span>Biggest head starts</span><small>${fmt(w.items.length)}</small></h3><ul class="unique-list">${items || `<li class="empty">No ${noun} where someone was a month or more ahead.</li>`}</ul>`;
  fitRows($('#firstsList .unique-list'), PANEL_ROWS);
}

// ---------- When you listen: hour and weekday shares, a line per person

export function renderClocks({ people, range }) {
  const clocks = people.map(p => clockShares(rowsBetween(p.rows, range.from, range.to)));
  const series = key => people.map((p, i) => ({ name: p.profile.name, slot: p.slot, values: clocks[i][key] }));
  const hour = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  $('#clockLegend').innerHTML = people.map(p => `<span>${swatch(p.slot)}${esc(p.profile.name)}</span>`).join('');
  const top = key => Math.max(0.01, ...clocks.flatMap(c => c[key]));
  const options = { showTotal: false, format: v => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` };
  drawResponsive($('#hourChart'), () => lineChart($('#hourChart'), {
    ...options, max: top('hours'), keys: Array.from({ length: 24 }, (_, h) => String(h)), series: series('hours'),
    labelFor: (key, short) => short ? hour(+key) : `${hour(+key)}–${hour((+key + 1) % 24)}`,
  }));
  drawResponsive($('#weekdayChart'), () => lineChart($('#weekdayChart'), {
    ...options, max: top('weekdays'), keys: DAYS, series: series('weekdays'), labelFor: key => key,
  }));
}
