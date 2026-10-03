// The artist page: one artist across everyone you've added. Clicking any artist name opens it.

import { $, esc, fmt, fmtDate, fitRows, swatch, personColor, keyDate } from './util.js';
import { PANEL_ROWS } from './config.js';
import { bucketAxis, countByBucket, bucketKey } from './analyze.js';
import { artistDetail, artistRank } from './artist.js';
import { allTimeSummary } from './summaries.js';
import { lineChart } from './charts.js';

const monthLabel = key => keyDate(key).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const dayLabel = key => keyDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const lastfmUrl = name => `https://www.last.fm/music/${encodeURIComponent(name).replace(/%20/g, '+')}`;
const NONE = '<span class="muted">—</span>';

export function renderArtist({ people, name }) {
  const columns = people.map(person => ({ person, d: artistDetail(person.rows, name) }));
  const played = columns.filter(c => c.d);
  const title = played.at(-1)?.d.name || name;
  $('#artistTitle').textContent = title;
  $('#artistLink').href = lastfmUrl(title);
  $('#artistBody').hidden = !played.length;
  $('#artistEmpty').hidden = played.length > 0;
  if (!played.length) {
    $('#artistStats').innerHTML = '';
    $('#artistEmpty').textContent = `Nobody you've added has scrobbled ${title}.`;
    return;
  }
  renderStats(columns);
  renderMonths(played);
  renderLists('#artistTracks', played, d => d.tracks, 'No tracks');
  renderLists('#artistAlbums', played, d => d.albums, 'No album names scrobbled');
}

// A column per person. Number rows mark the leader when more than one person played the artist.
function renderStats(columns) {
  const numberRow = (label, get) => {
    const values = columns.map(c => c.d ? get(c.d) : null);
    const counted = values.filter(v => v != null);
    const best = Math.max(...counted);
    const lead = v => counted.length > 1 && v === best && counted.some(other => other !== best);
    return `<tr><th scope="row">${label}</th>${values.map(v => `<td class="${lead(v) ? 'lead-value' : ''}">${v == null ? NONE : fmt(v)}</td>`).join('')}</tr>`;
  };
  const textRow = (label, get) =>
    `<tr><th scope="row">${label}</th>${columns.map(c => `<td class="text">${c.d ? get(c.d, c.person) : NONE}</td>`).join('')}</tr>`;
  const withPlays = (text, plays) => `${text}<span class="sub">${fmt(plays)} plays</span>`;

  $('#artistStats').innerHTML = `<thead><tr><th></th>${columns.map(c => `<th scope="col">${swatch(c.person.slot)}${esc(c.person.profile.name)}</th>`).join('')}</tr></thead>
    <tbody>
      ${numberRow('Plays', d => d.plays)}
      ${textRow('Rank among their artists', (d, p) => `#${fmt(artistRank(allTimeSummary(p), d.name))}`)}
      ${textRow('Share of their scrobbles', (d, p) => `${((d.plays / p.rows.length) * 100).toFixed(2)}%`)}
      ${textRow('First played', d => fmtDate(d.first))}
      ${textRow('Last played', d => fmtDate(d.last))}
      ${numberRow('Days played', d => d.daysPlayed)}
      ${textRow('Biggest day', d => withPlays(dayLabel(d.biggestDay.key), d.biggestDay.count))}
      ${textRow('Peak month', d => withPlays(monthLabel(d.peakMonth.key), d.peakMonth.count))}
      ${textRow('Longest daily streak', d => `${fmt(d.longestStreak)} days`)}
      ${textRow('Top track', d => withPlays(esc(d.tracks[0].name), d.tracks[0].plays))}
    </tbody>`;
}

// Plays by month, a line per person who played them.
function renderMonths(played) {
  const keys = bucketAxis(Math.min(...played.map(c => c.d.first)), Math.max(...played.map(c => c.d.last)), 'month');
  const series = played.map(({ person, d }) => {
    const counts = countByBucket(d.rows, { from: -Infinity, to: Infinity }, 'month');
    const started = bucketKey(person.rows[0][0], 'month');
    return { name: person.profile.name, slot: person.slot, values: keys.map(k => k < started ? null : counts.get(k) || 0) };
  });
  $('#artistLegend').innerHTML = series.map(s => `<span>${swatch(s.slot)}${esc(s.name)}</span>`).join('');
  lineChart($('#artistChart'), {
    keys, series,
    labelFor: (key, short) => short && keys.length > 30 ? key.slice(0, 4) : monthLabel(key),
    isYearStart: key => key.endsWith('-01'),
  });
}

function renderLists(selector, played, items, empty) {
  $(selector).innerHTML = played.map(({ person, d }) => {
    const list = items(d);
    const rows = list.slice(0, 200).map(i => `<li><div><div class="item-name">${esc(i.name)}</div></div><span class="num">${fmt(i.plays)}</span></li>`).join('');
    return `<div class="panel list-panel" style="--color:${personColor(person.slot)}">
      <h3><span>${esc(person.profile.name)}</span><small>${fmt(list.length)}</small></h3>
      <ul class="item-list">${rows || `<li class="empty">${empty}</li>`}</ul>
    </div>`;
  }).join('');
  document.querySelectorAll(`${selector} .item-list`).forEach(list => fitRows(list, PANEL_ROWS));
}
