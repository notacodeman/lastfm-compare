// The Reports tab: one person's week, month or year, compared with the period before.

import { $, esc, fmt, pct, fmtDate, nowSec, fitRows, artistLink, listRow, swatch, personColor, hourLabel, WEEKDAYS, capitalize } from './util.js';
import { PANEL_ROWS, GENRE_ARTISTS, GENRE_ARTISTS_PER_MONTH, GENRES_SHOWN, GENRES_STACKED, BUMP_ARTISTS, BUMP_DEPTH } from './config.js';
import { buildReport, monthsAround, monthRow, periodLabel, shiftPeriod, reportPeriod } from './report.js';
import { monthlyRanks } from './pair.js';
import { genreShares, genreVariety, topArtists } from './genres.js';
import { loadTags, tagsFor } from './genre-loader.js';
import { firstPlaysOf } from './summaries.js';
import { columnChart, stackedShareChart, bumpChart } from './charts.js';

// Genre colours: the validated categorical order (as the people use); "Other" is neutral.
const GENRE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const OTHER_COLOR = '#5d5c57';
const monthName = (date, month = 'long') => date.toLocaleDateString('en-US', { month, year: 'numeric' });

let genreRun = 0;      // drops genre results that arrive after the report has changed
let onScreen = null;   // the report being shown, for "Save as image"
export const shownReport = () => onScreen;

// people: everyone ready (for the fingerprint); person: whose report; period: from report.js
export function renderReport({ people, person, period, now, onOpenMonth, onArtist }) {
  const report = buildReport(person.rows, period, firstPlaysOf(person), now);
  onScreen = { report, person, genres: [] };
  const before = previousName(report.previous);

  $('#reportTitle').innerHTML = `${swatch(person.slot)}${esc(person.profile.name)} · ${esc(periodLabel(period))}`
    + (report.ongoing ? ' <span class="muted">so far</span>' : '');
  renderTiles(report, before);
  renderFacts(report);
  renderDays(report, person.slot, before);
  renderTopLists(report);
  renderNew(report);
  const months = monthsAround(period).map(month => monthRow(person.rows, month, firstPlaysOf(person)));
  renderMonths(months, period, onOpenMonth);
  renderBump(person, months.map(m => m.month), onArtist);
  renderClock(report, person.slot);
  const everyone = people.map(p => ({ person: p, report: p === person ? report : buildReport(p.rows, period, firstPlaysOf(p), now) }));
  renderFingerprint(everyone);
  loadGenres(report, months, everyone);
}

function previousName(previous) {
  if (previous.unit === 'month') return previous.start.toLocaleDateString('en-US', { month: 'long' });
  return previous.unit === 'year' ? String(previous.start.getFullYear()) : 'the week before';
}

// ---------- Summary

function change(now, before) {
  if (!before) return now ? '<span class="delta">new</span>' : '';
  const diff = Math.round(((now - before) / before) * 100);
  return `<span class="delta">${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(diff)}%</span>`;
}

function renderTiles(r, before) {
  const s = r.summary, p = r.prevSummary;
  const counted = kind => [capitalize(kind), fmt(s[kind].size), change(s[kind].size, p[kind].size), `vs ${fmt(p[kind].size)}`];
  const tiles = [
    ['Scrobbles', fmt(s.scrobbles), change(s.scrobbles, p.scrobbles), `${fmt(p.scrobbles)} ${r.ongoing ? 'by now in' : 'in'} ${before}`],
    counted('artists'), counted('albums'), counted('tracks'),
    ['A day', r.perDay.toFixed(1), change(r.perDay, r.prevPerDay), `vs ${r.prevPerDay.toFixed(1)}`],
    ['Days listened', `${fmt(r.activeDays)}<small>/${fmt(r.elapsedDays)}</small>`, '', `${pct(r.consistency)} of days`],
  ];
  $('#reportTiles').innerHTML = tiles.map(([label, value, delta, sub]) => `<div class="tile">
    <div class="tile-label">${label}</div>
    <div class="tile-value">${value}</div>
    <div class="tile-sub">${delta} <span>${esc(sub)}</span></div>
  </div>`).join('');
}

function renderFacts(r) {
  const [artist] = r.top.artists, [album] = r.top.albums, [track] = r.top.tracks;
  const sub = text => `<span class="muted">${text}</span>`;
  const facts = [
    ['Top artist', artist && `${artistLink(artist.name)} ${sub(`${fmt(artist.plays)} plays`)}`],
    ['Top album', album && `${esc(album.name)} ${sub(esc(album.artist))}`],
    ['Top track', track && `${esc(track.name)} ${sub(esc(track.artist))}`],
    ['Busiest day', r.busiestDay?.count && `${esc(r.busiestDay.label)} ${sub(`${fmt(r.busiestDay.count)} scrobbles`)}`],
    ['Busiest hour', r.summary.scrobbles && `${hourLabel(r.busiestHour)}–${hourLabel((r.busiestHour + 1) % 24)} ${sub(`${fmt(r.hours[r.busiestHour])} scrobbles`)}`],
    ['Top genres', '<span id="reportGenres" class="muted">…</span>'],
  ].filter(([, value]) => value);
  $('#reportFacts').innerHTML = facts.map(([label, value]) =>
    `<div class="fact"><div class="fact-label">${label}</div><div class="fact-value">${value}</div></div>`).join('');
}

// ---------- By day (by month for a year), with the period before as a tick on each bar

function renderDays(r, slot, before) {
  const unit = r.period.unit;
  const beforeLabel = capitalize(before);
  $('#rDaysTitle').textContent = unit === 'year' ? 'Scrobbles by month' : 'Scrobbles by day';
  $('#rDaysLegend').innerHTML = `<span>${swatch(slot)}This ${unit}</span><span><span class="previous-key"></span>${esc(beforeLabel)}</span>`;
  const previous = r.buckets.map((_, i) => r.prevByBucket[i] ?? null);
  const started = r.buckets.filter(b => b.from <= nowSec()).length;   // days still to come don't count
  columnChart($('#rDaysChart'), {
    average: r.summary.scrobbles / Math.max(1, started),
    labels: r.buckets.map(b => b.short),
    values: r.byBucket,
    previous,
    slot,
    minLabelGap: unit === 'month' ? 26 : 30,
    tooltip: i => `<b>${esc(r.buckets[i].long)}</b><div><span>Scrobbles</span><span>${fmt(r.byBucket[i])}</span></div>`
      + (previous[i] == null ? '' : `<div class="muted"><span>${esc(beforeLabel)}</span><span>${fmt(previous[i])}</span></div>`),
  });
}

// ---------- Top lists and new music

const KIND_TITLES = [['artists', 'Artists'], ['albums', 'Albums'], ['tracks', 'Tracks']];

function renderTopLists(r) {
  $('#rTopGrid').innerHTML = KIND_TITLES.map(([kind, title]) => `<div class="panel list-panel">
    <h3><span>${title}</span><small>${fmt(r.summary[kind].size)}</small></h3>
    <ol class="item-list ranked">${r.top[kind].map(item => listRow(item, fmt(item.plays), { badge: item.isNew })).join('')
      || '<li class="empty">Nothing played.</li>'}</ol>
  </div>`).join('');
  $('#rTopGrid').querySelectorAll('.item-list').forEach(list => fitRows(list, PANEL_ROWS));
}

function renderNew(r) {
  $('#rNewGrid').innerHTML = KIND_TITLES.map(([kind, title]) => {
    const fresh = r.fresh[kind];
    return `<div class="panel list-panel">
      <h3><span>New ${title.toLowerCase()}</span><small>${fmt(fresh.items.length)}</small></h3>
      <div class="new-stat"><b>${pct(fresh.share)}</b> of the ${kind} you played
        <span class="muted">· ${pct(fresh.prevShare)} the period before · ${fmt(fresh.plays)} scrobbles</span></div>
      <ul class="item-list">${fresh.items.slice(0, 200).map(item => listRow(item, fmt(item.plays), { sub: `first played ${fmtDate(item.first)}` })).join('')
        || '<li class="empty">Nothing new.</li>'}</ul>
    </div>`;
  }).join('');
  $('#rNewGrid').querySelectorAll('.item-list').forEach(list => fitRows(list, PANEL_ROWS));
}

// ---------- Month by month (a click opens that month's report)

function renderMonths(months, period, onOpenMonth) {
  const max = Math.max(1, ...months.map(m => m.scrobbles));
  const table = $('#rMonthTable');
  table.style.setProperty('--columns', 'minmax(6.5rem, .8fr) minmax(9rem, 1.3fr) 4.5rem 5.5rem minmax(9rem, 1.2fr) minmax(7rem, .9fr)');
  table.style.setProperty('--columns-narrow', 'minmax(6rem, .8fr) minmax(8rem, 1.3fr) 4.2rem 5rem minmax(8rem, 1.2fr) minmax(6.5rem, .9fr)');
  const rows = months.map((m, i) => {
    const current = period.unit === 'month' && m.month.key === period.key;
    return `<div class="table-row month-row${current ? ' current' : ''}" data-month="${m.month.key}" tabindex="0" role="button">
      <div class="item-name">${monthName(m.month.start, 'short')}</div>
      <div class="inline-bar"><span style="width:${(m.scrobbles / max) * 100}%"></span><b>${fmt(m.scrobbles)}</b></div>
      <div class="num">${fmt(m.artists)}</div>
      <div class="num">${fmt(m.newArtists)}</div>
      <div>${m.topArtist ? `${artistLink(m.topArtist.name)}<span class="item-sub">${fmt(m.topArtist.plays)} plays</span>` : '<span class="muted">—</span>'}</div>
      <div id="monthGenre-${i}" class="muted">…</div>
    </div>`;
  }).join('');
  table.innerHTML = `<div class="table-row table-head">
      <div>Month</div><div>Scrobbles</div><div class="num">Artists</div><div class="num">New artists</div><div>Top artist</div><div>Top genre</div>
    </div>
    <div class="table-body">${rows}</div>`;
  // artist links inside a row open the artist instead (handled by the page-wide listener)
  const open = row => { if (row) onOpenMonth(row.dataset.month); };
  table.onclick = e => { if (!e.target.closest('[data-artist]')) open(e.target.closest('.month-row')); };
  table.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ' || !e.target.matches('.month-row')) return;
    e.preventDefault();
    open(e.target);
  };
}

// ---------- Top artists month by month

function renderBump(person, months, onArtist) {
  const series = monthlyRanks(person.rows, months, BUMP_ARTISTS, BUMP_DEPTH);
  if (!series.length) { $('#rBumpChart').innerHTML = '<p class="muted">No scrobbles in these months.</p>'; return; }
  bumpChart($('#rBumpChart'), {
    series, depth: BUMP_DEPTH, slot: person.slot,
    labels: months.map(m => m.start.toLocaleDateString('en-US', { month: 'short' })),
    longLabels: months.map(m => monthName(m.start)),
    onPick: s => onArtist(s.name),
  });
}

// ---------- When you listen

function renderClock(r, slot) {
  $('#rHourTitle').textContent = r.summary.scrobbles ? `Hour of day · busiest ${hourLabel(r.busiestHour)}` : 'Hour of day';
  columnChart($('#rHourChart'), {
    labels: r.hours.map((_, h) => h % 6 ? '' : hourLabel(h)),
    values: r.hours, slot, height: 200, minLabelGap: 1,
    tooltip: h => `<b>${hourLabel(h)} – ${hourLabel((h + 1) % 24)}</b><div><span>Scrobbles</span><span>${fmt(r.hours[h])}</span></div>`,
  });
  columnChart($('#rWeekdayChart'), {
    labels: WEEKDAYS, values: r.weekdays, slot, height: 200, minLabelGap: 1,
    tooltip: d => `<b>${WEEKDAYS[d]}</b><div><span>Scrobbles</span><span>${fmt(r.weekdays[d])}</span></div>`,
  });
}

// ---------- Fingerprint: the same period for everyone, side by side

const FINGERPRINT = [
  ['consistency', 'Consistency', 'Days with at least one scrobble, out of the days in the period so far.'],
  ['discovery', 'Discovery', 'Artists played for the first time ever, out of all artists played.'],
  ['concentration', 'Concentration', 'Share of scrobbles that went to the top 5 artists.'],
  ['replay', 'Replay rate', 'Share of scrobbles that repeated a track already played in the period.'],
];

// variety: each person's genre variety, once tags have loaded
function renderFingerprint(everyone, variety = null) {
  const metric = (label, about, rows) => `<div class="metric">
    <div class="metric-head"><b>${label}</b><span class="muted">${about}</span></div>
    <div class="bar-rows">${rows}</div>
  </div>`;
  const row = (person, share, text) => `<div class="bar-row person-bar"><span>${swatch(person.slot)}${esc(person.profile.name)}</span>
    <div class="bar">${share > 0 ? `<span style="width:${share * 100}%;background:${personColor(person.slot)}"></span>` : ''}</div>
    <span class="value">${text}</span></div>`;

  const blocks = FINGERPRINT.map(([key, label, about]) =>
    metric(label, about, everyone.map(e => row(e.person, e.report[key], pct(e.report[key]))).join('')));
  const mostVaried = Math.max(1, ...(variety || []));
  blocks.push(metric('Genre variety', 'How spread out listening is across genres: the number of equally played genres it matches.',
    variety ? everyone.map((e, i) => row(e.person, variety[i] / mostVaried, variety[i].toFixed(1))).join('') : '<p class="muted">Waiting for genres…</p>'));
  $('#rFingerprintPanel').innerHTML = blocks.join('');
}

// ---------- Genres (needs artist tags, so it fills in after the rest)

async function loadGenres(report, months, everyone) {
  const run = ++genreRun;
  const status = $('#rGenreStatus');
  const periodArtists = topArtists(report.summary, GENRE_ARTISTS);
  const monthArtists = months.map(m => topArtists(m.summary, GENRE_ARTISTS_PER_MONTH));
  const everyoneArtists = everyone.map(e => topArtists(e.report.summary, GENRE_ARTISTS));

  $('#rGenreTop').innerHTML = '<h3>Top genres</h3><p class="muted">Loading…</p>';
  await loadTags([periodArtists, ...monthArtists, ...everyoneArtists].flat().map(a => a.name), (done, total) => {
    if (run === genreRun) status.textContent = `Fetching artist tags from Last.fm: ${done} of ${total} (saved for next time)…`;
  });
  if (run !== genreRun) return;

  const genres = genreShares(periodArtists, tagsFor);
  const topNames = genres.shares.slice(0, 3).map(s => s.name);
  onScreen.genres = topNames;
  $('#reportGenres').textContent = topNames.join(', ') || '—';
  status.textContent = genres.total ? `From Last.fm's tags for the top ${fmt(periodArtists.length)} artists, which cover ${pct(genres.coverage)} of this period's scrobbles. `
    + "Each artist's plays are split across its tags." : '';
  renderGenreList(genres);
  renderGenreMonths(months, monthArtists, report.period);
  renderFingerprint(everyone, everyoneArtists.map(list => genreVariety(genreShares(list, tagsFor).shares)));
}

function renderGenreList(genres) {
  const shown = genres.shares.slice(0, GENRES_SHOWN);
  const max = shown[0]?.share || 1;
  const rows = shown.map(s => `<div class="bar-row"><span>${esc(s.name)}</span>
    <div class="bar"><span style="width:${(s.share / max) * 100}%"></span></div><span class="value">${pct(s.share)}</span></div>`).join('');
  $('#rGenreTop').innerHTML = `<h3><span>Top genres</span>
    <small title="Genre variety: how many equally played genres this spread matches">variety ${genreVariety(genres.shares).toFixed(1)}</small></h3>
    ${rows ? `<div class="bar-rows genre-rows">${rows}</div>` : '<p class="muted">No tags found for these artists.</p>'}`;
}

// The genres that lead across the 12 months, each month's share of them, and the rest as Other.
function renderGenreMonths(months, monthArtists, period) {
  const perMonth = monthArtists.map(list => genreShares(list, tagsFor));
  const totals = new Map();
  for (const m of perMonth) for (const s of m.shares) totals.set(s.name, (totals.get(s.name) || 0) + s.share);
  const leaders = [...totals].sort((a, b) => b[1] - a[1]).slice(0, GENRES_STACKED).map(([name]) => name);
  const series = leaders.map((name, i) => ({ name, color: GENRE_COLORS[i], values: perMonth.map(m => m.shares.find(s => s.name === name)?.share || 0) }));
  series.push({ name: 'Other', color: OTHER_COLOR, values: perMonth.map((m, i) => m.tagged ? Math.max(0, 1 - series.reduce((sum, s) => sum + s.values[i], 0)) : 0) });

  $('#rGenreMonthsTitle').textContent = `Genres month by month, ${period.unit === 'year' ? period.start.getFullYear() : 'last 12 months'}`;
  $('#rGenreLegend').innerHTML = series.map(s => `<span>${swatch(s.color)}${esc(s.name)}</span>`).join('');
  stackedShareChart($('#rGenreChart'), {
    labels: months.map(m => m.month.start.toLocaleDateString('en-US', { month: 'short' })),
    series,
    tooltip: i => `<b>${monthName(months[i].month.start)}</b>` + (perMonth[i].tagged
      ? [...series].reverse().map(s => `<div><span>${swatch(s.color)}${esc(s.name)}</span><span>${pct(s.values[i])}</span></div>`).join('')
      : '<div class="muted">No scrobbles</div>'),
  });
  perMonth.forEach((m, i) => {
    const cell = document.getElementById(`monthGenre-${i}`);
    cell.textContent = m.shares[0]?.name || '—';
    cell.classList.toggle('muted', !m.shares[0]);
  });
}

// ---------- Period picker options: every period from the first scrobble to now, newest first

export function periodOptions(person, unit, now) {
  const options = [];
  if (!person.rows.length) return options;
  const first = person.rows[0][0];
  for (let p = reportPeriod(unit, new Date(now * 1000)); p.to >= first && options.length < 1000; p = shiftPeriod(p, -1)) options.push(p);
  return options;
}
