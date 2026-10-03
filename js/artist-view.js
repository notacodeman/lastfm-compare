// The artist page: one artist across everyone you've added. Opened by clicking any artist name.

import { $, esc, fmt, fmtDate, fitRows } from './util.js';
import { PANEL_ROWS } from './config.js';
import { summarize, bucketAxis, countByBucket, bucketKey } from './analyze.js';
import { artistDetail, artistRank } from './lifetime.js';
import { lineChart, drawResponsive } from './charts.js';

const swatch = slot => `<span class="swatch" style="--color:var(--person-${slot})"></span>`;
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
const dayLabel = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const lastfmUrl = name => `https://www.last.fm/music/${encodeURIComponent(name).replace(/%20/g, '+')}`;

function allTimeSummary(person) {
  if (!person.summaries.has('all')) person.summaries.set('all', summarize(person.rows, { from: -Infinity, to: Infinity }));
  return person.summaries.get('all');
}

export function renderArtist({ people, name }) {
  const details = people.map(person => ({ person, d: artistDetail(person.rows, name) }));
  const played = details.filter(x => x.d);
  const title = played.at(-1)?.d.name || name;
  $('#artistTitle').textContent = title;
  $('#artistLink').href = lastfmUrl(title);

  if (!played.length) {
    $('#artistStats').innerHTML = '';
    $('#artistBody').hidden = true;
    $('#artistEmpty').hidden = false;
    $('#artistEmpty').textContent = `Nobody you've added has scrobbled ${title}.`;
    return;
  }
  $('#artistBody').hidden = false;
  $('#artistEmpty').hidden = true;

  // stats table, a column per person
  const cell = (x, fn) => x.d ? fn(x.d, x.person) : '<span class="muted">—</span>';
  const numRow = (label, fn) => {
    const values = details.map(x => x.d ? fn(x.d, x.person) : null);
    const best = Math.max(...values.filter(v => v != null));
    const shared = values.filter(v => v === best).length;
    const contest = values.filter(v => v != null).length > 1;   // no "leader" when only one person played them
    return `<tr><th scope="row">${label}</th>${values.map(v => `<td class="${contest && v === best && v > 0 && shared < details.length ? 'lead-value' : ''}">${v == null ? '<span class="muted">—</span>' : fmt(v)}</td>`).join('')}</tr>`;
  };
  const textRow = (label, fn) => `<tr><th scope="row">${label}</th>${details.map(x => `<td class="text">${cell(x, fn)}</td>`).join('')}</tr>`;
  $('#artistStats').innerHTML = `<thead><tr><th></th>${details.map(x => `<th scope="col">${swatch(x.person.slot)}${esc(x.person.profile.name)}</th>`).join('')}</tr></thead><tbody>${[
    numRow('Plays', d => d.plays),
    textRow('Rank among their artists', (d, p) => `#${fmt(artistRank(allTimeSummary(p), d.name))}`),
    textRow('Share of their scrobbles', (d, p) => `${((d.plays / p.rows.length) * 100).toFixed(2)}%`),
    textRow('First played', d => fmtDate(d.first)),
    textRow('Last played', d => fmtDate(d.last)),
    numRow('Days played', d => d.daysPlayed),
    textRow('Biggest day', d => `${dayLabel(d.biggestDay.key)}<span class="sub">${fmt(d.biggestDay.count)} plays</span>`),
    textRow('Peak month', d => `${monthLabel(d.peakMonth.key)}<span class="sub">${fmt(d.peakMonth.count)} plays</span>`),
    textRow('Longest daily streak', d => `${fmt(d.longestStreak.length)} days`),
    textRow('Top track', d => `${esc(d.tracks[0].name)}<span class="sub">${fmt(d.tracks[0].plays)} plays</span>`),
  ].join('')}</tbody>`;

  // plays by month, a line per person who played them
  const from = Math.min(...played.map(x => x.d.first));
  const to = Math.max(...played.map(x => x.d.last));
  const keys = bucketAxis(from, to, 'month');
  const series = played.map(({ person, d }) => {
    const counts = countByBucket(d.rows, { from: -Infinity, to: Infinity }, 'month');
    const start = bucketKey(person.rows[0][0], 'month');
    return { name: person.profile.name, slot: person.slot, values: keys.map(k => k < start ? null : counts.get(k) || 0) };
  });
  $('#artistLegend').innerHTML = series.map(s => `<span>${swatch(s.slot)}${esc(s.name)}</span>`).join('');
  drawResponsive($('#artistChart'), () => lineChart($('#artistChart'), {
    keys, series,
    labelFor: (key, short) => short && keys.length > 30 ? key.slice(0, 4) : monthLabel(key),
    isYearStart: key => key.endsWith('-01'),
  }));

  // top tracks and albums per person
  const list = (items, empty) => `<ul class="unique-list">${items.map(i =>
    `<li><div><div class="item-name">${esc(i.name)}</div></div><span class="num">${fmt(i.plays)}</span></li>`).join('') || `<li class="empty">${empty}</li>`}</ul>`;
  $('#artistTracks').innerHTML = played.map(({ person, d }) => `<div class="panel" style="--color:var(--person-${person.slot})">
    <h3><span>${esc(person.profile.name)}</span><small>${fmt(d.tracks.length)}</small></h3>${list(d.tracks.slice(0, 200), 'No tracks')}</div>`).join('');
  $('#artistAlbums').innerHTML = played.map(({ person, d }) => `<div class="panel" style="--color:var(--person-${person.slot})">
    <h3><span>${esc(person.profile.name)}</span><small>${fmt(d.albums.length)}</small></h3>${list(d.albums.slice(0, 200), 'No album names scrobbled')}</div>`).join('');
  document.querySelectorAll('#artistView .unique-list').forEach(l => fitRows(l, PANEL_ROWS));
}
