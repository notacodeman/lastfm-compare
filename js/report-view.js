// The Reports tab: one person's week, month or year, compared with the period before.

import { $, esc, fmt, fmtDate, fitRows, artistLink } from './util.js';
import { PANEL_ROWS, GENRE_ARTISTS, GENRE_ARTISTS_PER_MONTH, GENRES_SHOWN, GENRES_STACKED } from './config.js';
import { buildReport, monthsAround, monthRow, periodLabel, shiftPeriod, reportPeriod, firstPlays } from './report.js';
import { genreShares, genreVariety, topArtists } from './genres.js';
import { loadTags, tagsFor } from './genre-loader.js';
import { columnChart, stackedShareChart } from './charts.js';

const color = slot => `var(--person-${slot})`;
const swatch = slot => `<span class="swatch" style="--color:${color(slot)}"></span>`;
const pct = v => `${Math.round(v * 100)}%`;
const UNIT_NOUN = { week: 'week', month: 'month', year: 'year' };
// Genre colours, in the validated categorical order; "Other" is neutral.
const GENRE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const OTHER_COLOR = '#5d5c57';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

let run = 0;   // drops genre results that arrive after the report has changed
let shown = null;   // the report on screen, for "Save as image"
export const currentReport = () => shown;

export function firstPlaysFor(person) {
  person.first ??= firstPlays(person.rows);
  return person.first;
}

// people: everyone ready; person: whose report; period: from report.js; now: unix seconds
export function renderReport({ people, person, period, now, onOpenMonth }) {
  const report = buildReport(person.rows, period, firstPlaysFor(person), now);
  shown = { report, person, genres: [] };
  const ongoing = period.end / 1000 > now;
  const prevName = previousName(report.previous);

  $('#reportTitle').innerHTML = `${swatch(person.slot)}${esc(person.profile.name)} · ${esc(periodLabel(period))}${ongoing ? ' <span class="muted">so far</span>' : ''}`;
  renderTiles(report, prevName);
  renderFacts(report);
  renderDays(report, person, prevName);
  renderTop(report);
  renderNew(report);
  const months = monthsAround(period).map(month => monthRow(person.rows, month, firstPlaysFor(person)));
  renderMonths(months, period, onOpenMonth);
  renderClock(report, person);
  const others = people.map(p => ({ person: p, report: p === person ? report : buildReport(p.rows, period, firstPlaysFor(p), now) }));
  renderFingerprint(others, null);
  loadGenres(report, months, others, period);
}

function previousName(previous) {
  return previous.unit === 'month' ? previous.start.toLocaleDateString('en-US', { month: 'long' })
    : previous.unit === 'year' ? String(previous.start.getFullYear()) : 'the week before';
}

// ---------- Summary

function change(now, before) {
  if (!before) return now ? '<span class="delta">new</span>' : '';
  const diff = (now - before) / before;
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
  return `<span class="delta">${arrow} ${Math.abs(Math.round(diff * 100))}%</span>`;
}

function renderTiles(r, prevName) {
  const s = r.summary, p = r.prevSummary;
  const when = r.ongoing ? `by now in ${prevName}` : `in ${prevName}`;
  const tiles = [
    ['Scrobbles', fmt(s.scrobbles), change(s.scrobbles, p.scrobbles), `${fmt(p.scrobbles)} ${when}`],
    ['Artists', fmt(s.artists.size), change(s.artists.size, p.artists.size), `vs ${fmt(p.artists.size)}`],
    ['Albums', fmt(s.albums.size), change(s.albums.size, p.albums.size), `vs ${fmt(p.albums.size)}`],
    ['Tracks', fmt(s.tracks.size), change(s.tracks.size, p.tracks.size), `vs ${fmt(p.tracks.size)}`],
    ['A day', r.perDay.toFixed(1), change(r.perDay, r.prevPerDay), `vs ${r.prevPerDay.toFixed(1)}`],
    ['Days listened', `${fmt(r.activeDays)}<small>/${fmt(r.elapsedDays)}</small>`, '', `${pct(r.consistency)} of days`],
  ];
  $('#reportTiles').innerHTML = tiles.map(([label, value, delta, sub]) => `
    <div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>
    <div class="tile-sub">${delta} <span>${esc(sub)}</span></div></div>`).join('');
}

function renderFacts(r) {
  const facts = [
    ['Top artist', r.top.artists[0] && `${artistLink(r.top.artists[0].name)} <span class="muted">${fmt(r.top.artists[0].plays)} plays</span>`],
    ['Top album', r.top.albums[0] && `${esc(r.top.albums[0].name)} <span class="muted">${esc(r.top.albums[0].artist)}</span>`],
    ['Top track', r.top.tracks[0] && `${esc(r.top.tracks[0].name)} <span class="muted">${esc(r.top.tracks[0].artist)}</span>`],
    ['Busiest day', r.busiestDay?.count && `${esc(r.busiestDay.label)} <span class="muted">${fmt(r.busiestDay.count)} scrobbles</span>`],
    ['Busiest hour', r.summary.scrobbles && `${hourLabel(r.busiestHour)}–${hourLabel((r.busiestHour + 1) % 24)} <span class="muted">${fmt(r.hours[r.busiestHour])} scrobbles</span>`],
    ['Top genres', '<span id="rTopGenres" class="muted">…</span>'],
  ].filter(([, value]) => value);
  $('#reportFacts').innerHTML = facts.map(([label, value]) => `<div class="fact"><div class="fact-label">${label}</div><div class="fact-value">${value}</div></div>`).join('');
}

// ---------- By day (by month for a year)

function renderDays(r, person, prevName) {
  const unit = r.period.unit;
  $('#rDaysTitle').textContent = unit === 'year' ? 'Scrobbles by month' : 'Scrobbles by day';
  $('#rDaysLegend').innerHTML = `<span>${swatch(person.slot)}This ${UNIT_NOUN[unit]}</span><span><span class="previous-key"></span>${esc(prevName[0].toUpperCase() + prevName.slice(1))}</span>`;
  const previous = r.buckets.map((_, i) => r.prevByBucket[i] ?? null);
  columnChart($('#rDaysChart'), {
    labels: r.buckets.map(b => b.short),
    values: r.byBucket,
    previous,
    slot: person.slot,
    minLabelGap: unit === 'month' ? 26 : 30,
    tooltip: i => `<b>${esc(r.buckets[i].long)}</b><div><span>Scrobbles</span><span>${fmt(r.byBucket[i])}</span></div>${
      previous[i] != null ? `<div class="muted"><span>${esc(r.previous.unit === 'year' ? 'Year before' : r.previous.unit === 'month' ? prevName : 'Week before')}</span><span>${fmt(previous[i])}</span></div>` : ''}`,
  });
}

// ---------- Top lists and new music

// Artist names open the artist page; for albums and tracks that's the artist line under the name.
function listItem(item, value, extra = '') {
  const name = item.artist ? esc(item.name) : artistLink(item.name);
  return `<li><div><div class="item-name">${name}${item.isNew ? ' <span class="badge">new</span>' : ''}</div>${
    item.artist ? `<span class="item-sub">${artistLink(item.artist)}</span>` : ''}${extra}</div><span class="num">${value}</span></li>`;
}

function renderTop(r) {
  const panels = [['artists', 'Artists'], ['albums', 'Albums'], ['tracks', 'Tracks']].map(([kind, title]) => {
    const items = r.top[kind];
    return `<div class="panel list-panel"><h3><span>${title}</span><small>${fmt(r.summary[kind].size)}</small></h3>
      <ol class="unique-list ranked">${items.map(i => listItem(i, fmt(i.plays))).join('') || '<li class="empty">Nothing played.</li>'}</ol></div>`;
  });
  $('#rTopGrid').innerHTML = panels.join('');
  $('#rTopGrid').querySelectorAll('.unique-list').forEach(list => fitRows(list, PANEL_ROWS));
}

function renderNew(r) {
  const panels = [['artists', 'New artists'], ['albums', 'New albums'], ['tracks', 'New tracks']].map(([kind, title]) => {
    const fresh = r.fresh[kind];
    const items = fresh.items.slice(0, 200);
    return `<div class="panel list-panel">
      <h3><span>${title}</span><small>${fmt(fresh.items.length)}</small></h3>
      <div class="new-stat"><b>${pct(fresh.share)}</b> of ${r.summary[kind].size ? `the ${kind} you played` : kind} <span class="muted">· ${pct(fresh.prevShare)} the period before · ${fmt(fresh.plays)} scrobbles</span></div>
      <ul class="unique-list">${items.map(i => listItem({ ...i, isNew: false }, fmt(i.plays), `<span class="item-sub">first played ${fmtDate(i.first)}</span>`)).join('') || '<li class="empty">Nothing new.</li>'}</ul></div>`;
  });
  $('#rNewGrid').innerHTML = panels.join('');
  $('#rNewGrid').querySelectorAll('.unique-list').forEach(list => fitRows(list, PANEL_ROWS));
}

// ---------- Month by month

function renderMonths(months, period, onOpenMonth) {
  const max = Math.max(1, ...months.map(m => m.scrobbles));
  const table = $('#rMonthTable');
  table.style.setProperty('--columns', 'minmax(6.5rem, .8fr) minmax(9rem, 1.3fr) 4.5rem 5.5rem minmax(9rem, 1.2fr) minmax(7rem, .9fr)');
  table.style.setProperty('--columns-narrow', 'minmax(6rem, .8fr) minmax(8rem, 1.3fr) 4.2rem 5rem minmax(8rem, 1.2fr) minmax(6.5rem, .9fr)');
  const head = `<div class="table-row table-head"><div>Month</div><div>Scrobbles</div><div class="num">Artists</div><div class="num">New artists</div><div>Top artist</div><div>Top genre</div></div>`;
  const rows = months.map((m, i) => {
    const current = period.unit === 'month' && m.month.key === period.key;
    return `<div class="table-row month-row ${current ? 'current' : ''}" data-month="${m.month.key}" tabindex="0" role="button">
      <div class="item-name">${esc(m.month.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}</div>
      <div class="inline-bar"><span style="width:${(m.scrobbles / max) * 100}%"></span><b>${fmt(m.scrobbles)}</b></div>
      <div class="num">${fmt(m.artists)}</div>
      <div class="num">${fmt(m.newArtists)}</div>
      <div>${m.topArtist ? `${artistLink(m.topArtist.name)}<span class="item-sub">${fmt(m.topArtist.plays)} plays</span>` : '<span class="muted">—</span>'}</div>
      <div id="month-genre-${i}" class="muted">…</div>
    </div>`;
  }).join('');
  table.innerHTML = head + `<div class="table-body">${rows}</div>`;
  table.querySelectorAll('.month-row').forEach(row => {
    const open = () => onOpenMonth(row.dataset.month);
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

// ---------- When you listen

function renderClock(r, person) {
  $('#rHourTitle').textContent = r.summary.scrobbles ? `Hour of day · busiest ${hourLabel(r.busiestHour)}` : 'Hour of day';
  columnChart($('#rHourChart'), {
    labels: r.hours.map((_, h) => h % 6 ? '' : hourLabel(h)),
    values: r.hours, slot: person.slot, height: 200, minLabelGap: 1,
    tooltip: h => `<b>${hourLabel(h)} – ${hourLabel((h + 1) % 24)}</b><div><span>Scrobbles</span><span>${fmt(r.hours[h])}</span></div>`,
  });
  columnChart($('#rWeekdayChart'), {
    labels: WEEKDAYS, values: r.weekdays, slot: person.slot, height: 200, minLabelGap: 1,
    tooltip: d => `<b>${WEEKDAYS[d]}</b><div><span>Scrobbles</span><span>${fmt(r.weekdays[d])}</span></div>`,
  });
}

// ---------- Fingerprint

const FINGERPRINT = [
  ['consistency', 'Consistency', 'Days with at least one scrobble, out of the days in the period so far.'],
  ['discovery', 'Discovery', 'Artists played for the first time ever, out of all artists played.'],
  ['concentration', 'Concentration', 'Share of scrobbles that went to the top 5 artists.'],
  ['replay', 'Replay rate', 'Share of scrobbles that repeated a track already played in the period.'],
];

// variety: per person, effective number of genres (null until tags are in)
function renderFingerprint(others, variety) {
  const metric = (label, about, rows) => `<div class="metric"><div class="metric-head"><b>${label}</b><span class="muted">${about}</span></div>
    <div class="bar-rows">${rows}</div></div>`;
  const row = (p, width, text) => `<div class="bar-row person-bar"><span>${swatch(p.slot)}${esc(p.profile.name)}</span>
    <div class="bar">${width > 0 ? `<span style="width:${width}%;background:${color(p.slot)}"></span>` : ''}</div><span class="value">${text}</span></div>`;
  const blocks = FINGERPRINT.map(([key, label, about]) =>
    metric(label, about, others.map(o => row(o.person, o.report[key] * 100, pct(o.report[key]))).join('')));
  const maxVariety = variety ? Math.max(1, ...variety) : 1;
  blocks.push(metric('Genre variety', 'How spread out listening is across genres: the number of equally played genres it matches.',
    variety ? others.map((o, i) => row(o.person, (variety[i] / maxVariety) * 100, `${variety[i].toFixed(1)}`)).join('') : '<p class="muted">Waiting for genres…</p>'));
  $('#rFingerprintPanel').innerHTML = blocks.join('');
}

// ---------- Genres (needs artist tags, so it fills in after the rest)

async function loadGenres(report, months, others, period) {
  const mine = ++run;
  const status = $('#rGenreStatus');
  const periodArtists = topArtists(report.summary, GENRE_ARTISTS);
  const monthArtists = months.map(m => topArtists(m.summary, GENRE_ARTISTS_PER_MONTH));
  const otherArtists = others.map(o => topArtists(o.report.summary, GENRE_ARTISTS));
  const names = [periodArtists, ...monthArtists, ...otherArtists].flat().map(a => a.name);

  $('#rGenreTop').innerHTML = '<h3>Top genres</h3><p class="muted">Loading…</p>';
  await loadTags(names, (done, total) => {
    if (mine === run) status.textContent = `Fetching artist tags from Last.fm: ${done} of ${total} (saved for next time)…`;
  });
  if (mine !== run) return;

  const g = genreShares(periodArtists, tagsFor);
  status.textContent = g.total
    ? `From Last.fm's tags for the top ${fmt(periodArtists.length)} artists, which cover ${pct(g.coverage)} of this period's scrobbles. Each artist's plays are split across its tags.`
    : '';
  const shown = g.shares.slice(0, GENRES_SHOWN);
  const max = shown[0]?.share || 1;
  $('#rGenreTop').innerHTML = `<h3><span>Top genres</span><small title="Genre variety: how many equally played genres this spread matches">variety ${genreVariety(g.shares).toFixed(1)}</small></h3>${shown.length
    ? `<div class="bar-rows genre-rows">${shown.map(s => `<div class="bar-row"><span>${esc(s.name)}</span><div class="bar"><span style="width:${(s.share / max) * 100}%"></span></div><span class="value">${pct(s.share)}</span></div>`).join('')}</div>`
    : '<p class="muted">No tags found for these artists.</p>'}`;
  const topGenres = document.getElementById('rTopGenres');
  if (topGenres) topGenres.textContent = g.shares.slice(0, 3).map(s => s.name).join(', ') || '—';
  if (shown?.report === report) shown.genres = g.shares.slice(0, 3).map(s => s.name);

  // month by month: the genres that lead across the 12 months, the rest as Other
  const perMonth = monthArtists.map(list => genreShares(list, tagsFor));
  const totals = new Map();
  perMonth.forEach(m => m.shares.forEach(s => totals.set(s.name, (totals.get(s.name) || 0) + s.share)));
  const leaders = [...totals].sort((a, b) => b[1] - a[1]).slice(0, GENRES_STACKED).map(([name]) => name);
  const series = leaders.map((name, i) => ({ name, color: GENRE_COLORS[i], values: perMonth.map(m => m.shares.find(s => s.name === name)?.share || 0) }));
  series.push({ name: 'Other', color: OTHER_COLOR, values: perMonth.map((m, i) => m.tagged ? Math.max(0, 1 - series.reduce((sum, s) => sum + s.values[i], 0)) : 0) });
  $('#rGenreMonthsTitle').textContent = period.unit === 'year' ? `Genres month by month, ${period.start.getFullYear()}` : 'Genres month by month, last 12 months';
  $('#rGenreLegend').innerHTML = series.map(s => `<span><span class="swatch" style="--color:${s.color}"></span>${esc(s.name)}</span>`).join('');
  const labels = months.map(m => m.month.start.toLocaleDateString('en-US', { month: 'short' }));
  stackedShareChart($('#rGenreChart'), {
    labels, series,
    tooltip: i => `<b>${esc(months[i].month.start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</b>${
      perMonth[i].tagged ? [...series].reverse().map(s => `<div><span><span class="swatch" style="--color:${s.color}"></span>${esc(s.name)}</span><span>${pct(s.values[i])}</span></div>`).join('') : '<div class="muted">No scrobbles</div>'}`,
  });
  perMonth.forEach((m, i) => {
    const cell = document.getElementById(`month-genre-${i}`);
    if (cell) { cell.textContent = m.shares[0]?.name || '—'; cell.classList.toggle('muted', !m.shares[0]); }
  });

  renderFingerprint(others, otherArtists.map(list => genreVariety(genreShares(list, tagsFor).shares)));
}

// ---------- Period picker options: every period from the first scrobble to now, newest first

export function periodOptions(person, unit, now) {
  const options = [];
  if (!person.rows.length) return options;
  let p = reportPeriod(unit, new Date(now * 1000));
  const first = person.rows[0][0];
  while (p.to >= first && options.length < 1000) {
    options.push(p);
    p = shiftPeriod(p, -1);
  }
  return options;
}
