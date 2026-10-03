// The All time tab: one person's records, milestones, every-day calendar, listening grid,
// top artists by year, forgotten favourites, comebacks and obsessions.

import { $, esc, fmt, fmtDate, fitRows, artistLink, download, nowSec } from './util.js';
import { PANEL_ROWS } from './config.js';
import { records, weekHourGrid, obsessions, artistTimelines, forgotten, comebacks, topArtistsByYear, toCsv } from './lifetime.js';
import { calendarHeatmap, weekHourHeatmap, heatLegend } from './charts.js';

const swatch = slot => `<span class="swatch" style="--color:var(--person-${slot})"></span>`;
const dayLabel = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const years = n => n >= 365 ? `${(n / 365).toFixed(1)} years` : `${fmt(n)} days`;

// Everything here depends only on the person's rows, so it's worked out once per download.
function lifetimeFor(person, now) {
  if (!person.lifetime) {
    const timelines = artistTimelines(person.rows);
    person.lifetime = {
      records: records(person.rows, now),
      grid: weekHourGrid(person.rows),
      obsessions: obsessions(person.rows),
      forgotten: forgotten(timelines, now),
      comebacks: comebacks(timelines),
      years: topArtistsByYear(person.rows),
    };
  }
  return person.lifetime;
}

export function renderAllTime({ person, calendarYear }) {
  const now = nowSec();
  const life = lifetimeFor(person, now);
  const r = life.records;
  $('#alltimeTitle').innerHTML = `${swatch(person.slot)}${esc(person.profile.name)} · all time`;

  const tiles = [
    ['Scrobbles', fmt(r.scrobbles), `since ${fmtDate(person.rows[0]?.[0])}`],
    ['A day', r.perDay.toFixed(1), `over ${years(r.spanDays)}`],
    ['Days listened', fmt(r.daysScrobbled), `${Math.round((r.daysScrobbled / Math.max(1, r.spanDays)) * 100)}% of days`],
    ['Longest streak', `${fmt(r.longest.length)}<small> days</small>`, r.longest.start ? `${dayLabel(r.longest.start)} – ${dayLabel(r.longest.end)}` : '—'],
    ['Current streak', `${fmt(r.current.length)}<small> days</small>`, r.current.length ? `since ${dayLabel(r.current.start)}` : 'no scrobbles today or yesterday'],
    ['Biggest day', fmt(r.biggestDay.count), r.biggestDay.key ? dayLabel(r.biggestDay.key) : '—'],
  ];
  $('#aTiles').innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${esc(sub)}</div></div>`).join('');

  renderMilestones(r);
  renderCalendar(person, r, calendarYear);
  weekHourHeatmap($('#aGrid'), { grid: life.grid, slot: person.slot });
  $('#aGridLegend').innerHTML = heatLegend(person.slot);
  renderYears(life.years);
  renderLists(life);
}

function renderMilestones(r) {
  const table = $('#aMilestoneTable');
  table.style.setProperty('--columns', '6rem minmax(10rem, 1.2fr) minmax(9rem, 1fr) 9rem');
  table.style.setProperty('--columns-narrow', '5rem minmax(9rem, 1.2fr) minmax(8rem, 1fr) 8.5rem');
  const rows = r.milestones.map(({ n, row }) => `<div class="table-row">
    <div class="num item-name">${n === 1 ? 'First' : fmt(n)}</div>
    <div class="item-name">${esc(row[2])}<span class="item-sub">${row[3] ? esc(row[3]) : ''}</span></div>
    <div>${artistLink(row[1])}</div>
    <div>${fmtDate(row[0])}</div></div>`).join('');
  table.innerHTML = `<div class="table-row table-head"><div class="num">Scrobble</div><div>Track</div><div>Artist</div><div>Date</div></div><div class="table-body">${rows}</div>`;
}

function renderCalendar(person, r, calendarYear) {
  const first = new Date((person.rows[0]?.[0] ?? nowSec()) * 1000).getFullYear();
  const last = new Date().getFullYear();
  const year = calendarYear && calendarYear >= first && calendarYear <= last ? calendarYear : last;
  const options = [];
  for (let y = last; y >= first; y--) options.push(`<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`);
  $('#calendarYear').innerHTML = options.join('');
  calendarHeatmap($('#aCalendarChart'), { year, days: r.days, slot: person.slot });
  let total = 0, active = 0;
  for (const [key, count] of r.days) if (key.startsWith(`${year}-`)) { total += count; active++; }
  $('#aCalendarLegend').innerHTML = `<span>${fmt(total)} scrobbles on ${fmt(active)} days in ${year}</span>${heatLegend(person.slot)}`;
}

// Top 10 artists for each year side by side. Hovering an artist lights it up in every year.
function renderYears(list) {
  const shown = list.filter(y => y.scrobbles);
  const cols = shown.map(y => `<div class="year-col"><div class="year-head">${y.year}<span class="item-sub">${fmt(y.scrobbles)}</span></div><ol>${
    y.top.map(a => `<li data-key="${esc(a.key)}">${artistLink(a.name)}<span class="item-sub">${fmt(a.plays)}</span></li>`).join('')}</ol></div>`).reverse();
  const grid = $('#aYearGrid');
  grid.innerHTML = `<div class="year-grid">${cols.join('')}</div>`;
  const highlight = key => grid.querySelectorAll('li').forEach(li => li.classList.toggle('lit', !!key && li.dataset.key === key));
  grid.onpointerover = e => highlight(e.target.closest('li')?.dataset.key);
  grid.onpointerleave = () => highlight(null);
  grid.onfocusin = e => highlight(e.target.closest('li')?.dataset.key);
}

function listPanel(title, count, items, empty) {
  return `<h3><span>${title}</span><small>${fmt(count)}</small></h3><ul class="unique-list">${items.join('') || `<li class="empty">${empty}</li>`}</ul>`;
}

function renderLists(life) {
  $('#aForgottenList').innerHTML = listPanel('Forgotten favourites', life.forgotten.length,
    life.forgotten.map(a => `<li><div><div class="item-name">${artistLink(a.name)}</div><span class="item-sub">last played ${fmtDate(a.last)}</span></div><span class="num">${fmt(a.plays)}</span></li>`),
    'No artist with 25+ plays has gone a year without one.');
  $('#aComebackList').innerHTML = listPanel('Comebacks', life.comebacks.length,
    life.comebacks.map(a => `<li><div><div class="item-name">${artistLink(a.name)}</div><span class="item-sub">back ${fmtDate(a.gapTo)} after ${years(Math.round(a.gap / 86400))} away</span></div><span class="num">${fmt(a.afterGap)}</span></li>`),
    'No artist came back after a year or more away.');
  $('#aDayObsessions').innerHTML = listPanel('Most plays of a track in one day', life.obsessions.days.length,
    life.obsessions.days.map(o => `<li><div><div class="item-name">${esc(o.track)}</div><span class="item-sub">${artistLink(o.artist)} · ${dayLabel(o.day)}</span></div><span class="num">${fmt(o.count)}×</span></li>`),
    'No track played twice in a day.');
  $('#aRuns').innerHTML = listPanel('Longest runs on repeat', life.obsessions.runs.length,
    life.obsessions.runs.map(o => `<li><div><div class="item-name">${esc(o.track)}</div><span class="item-sub">${artistLink(o.artist)} · ${fmtDate(o.start)}</span></div><span class="num">${fmt(o.count)}×</span></li>`),
    'No track played twice in a row.');
  document.querySelectorAll('#alltimeView .unique-list').forEach(list => fitRows(list, PANEL_ROWS));
}

export function exportCsv(person) {
  download(`scrobbles-${person.profile.name}.csv`, toCsv(person.rows), 'text/csv');
}
