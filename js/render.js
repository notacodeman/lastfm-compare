// Turns state and comparison results into HTML. Each function fills one part of the page.

import { $, esc, fmt, fmtDate, fmtMonth, fitRows, artistLink } from './util.js';
import { TABLE_ROWS, PANEL_ROWS, MAX_RENDERED_ROWS, GENRES_SHOWN } from './config.js';
import { vennSvg, sharedByBars } from './charts.js';

const color = slot => `var(--person-${slot})`;
const swatch = slot => `<span class="swatch" style="--color:${color(slot)}"></span>`;
const NOUN = { artists: 'artists', albums: 'albums', tracks: 'tracks' };
const ONE = { artists: 'artist', albums: 'album', tracks: 'track' };

const ICONS = {
  refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  remove: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  csv: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const iconButton = (action, label) =>
  `<button type="button" class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}"><svg viewBox="0 0 16 16">${ICONS[action === 'resume' ? 'refresh' : action]}</svg></button>`;

// ---------- People cards

export function renderPeople(people) {
  $('#people').innerHTML = people.map(person => {
    const name = person.profile?.name || person.username;
    // a little record: grooves round a label in the person's colour (their Last.fm picture if they have one)
    const label = person.profile?.image
      ? `<span class="label" style="background-image:url('${esc(person.profile.image)}')"></span>`
      : `<span class="label">${esc(name[0].toUpperCase())}</span>`;
    const avatar = `<span class="avatar ${person.status === 'loading' ? 'spinning' : ''}" aria-hidden="true">${label}</span>`;
    const link = person.profile ? `<a href="${esc(person.profile.url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);
    const actions = {
      loading: iconButton('pause', 'Pause download'),
      paused: iconButton('resume', 'Resume download'),
      error: iconButton('resume', 'Try again'),
      ready: iconButton('csv', 'Download scrobbles as CSV') + iconButton('refresh', 'Fetch new scrobbles'),
    }[person.status] + iconButton('remove', 'Remove');
    return `
      <li class="person" data-key="${esc(person.key)}" style="--color:${color(person.slot)}">
        ${avatar}
        <div><div class="person-name">${link}</div><div class="person-status ${person.status === 'error' ? 'error' : ''}">${statusText(person)}</div></div>
        <div class="person-actions">${actions}</div>
        ${person.status === 'loading' ? `<div class="progress"><span style="width:${progressPercent(person)}%"></span></div>` : ''}
      </li>`;
  }).join('');
}

// Updates one card's progress without rebuilding the list (keeps focus on its buttons).
export function renderProgress(person) {
  const card = document.querySelector(`.person[data-key="${CSS.escape(person.key)}"]`);
  if (!card) return;
  card.querySelector('.person-status').textContent = statusText(person);
  const bar = card.querySelector('.progress span');
  if (bar) bar.style.width = `${progressPercent(person)}%`;
}

function progressPercent({ progress }) {
  return progress?.totalPages ? Math.round((progress.pagesDone / progress.totalPages) * 100) : 2;
}

function statusText(person) {
  const p = person.progress;
  switch (person.status) {
    case 'loading':
      if (!p || !p.totalPages) return p?.scrobbles ? `Checking for new scrobbles… (${fmt(p.scrobbles)} saved)` : 'Looking up…';
      return `Downloading page ${fmt(p.pagesDone)} of ${fmt(p.totalPages)} · ${fmt(p.scrobbles)} scrobbles`;
    case 'paused': return `Paused at ${fmt(p?.scrobbles || 0)} scrobbles`;
    case 'error': return person.error;
    case 'ready': return `${fmt(person.rows.length)} scrobbles saved`;
  }
  return '';
}

// ---------- Head to head

export function renderStats(people, stats, kind) {
  const head = `<thead><tr><th></th>${people.map(p => `<th scope="col">${swatch(p.slot)}${esc(p.profile.name)}</th>`).join('')}</tr></thead>`;
  const row = (label, values, { format = fmt, lead = true } = {}) => {
    const best = lead ? Math.max(...values) : null;
    const leaders = values.filter(v => v === best).length;
    return `<tr><th scope="row">${label}</th>${values.map(v =>
      `<td class="${lead && v === best && v > 0 && leaders < values.length ? 'lead-value' : ''}">${format(v)}</td>`).join('')}</tr>`;
  };
  const textRow = (label, cells, id) =>
    `<tr><th scope="row">${label}</th>${cells.map((cell, i) => `<td class="text" ${id ? `id="${id}-${i}"` : ''}>${cell}</td>`).join('')}</tr>`;

  $('#statsTable').innerHTML = head + '<tbody>' + [
    row('Scrobbles', stats.map(s => s.scrobbles)),
    row('Scrobbles a day', stats.map(s => s.perDay), { format: v => v.toFixed(1) }),
    row('Artists', stats.map(s => s.artists)),
    row('Albums', stats.map(s => s.albums)),
    row('Tracks', stats.map(s => s.tracks)),
    row(`Played shared ${NOUN[kind]} first`, stats.map(s => s.foundFirst)),
    textRow('Top artist', stats.map(s => s.topArtist ? `${artistLink(s.topArtist.name)}<span class="sub">${fmt(s.topArtist.plays)} plays</span>` : '—')),
    textRow('Top genres', stats.map(() => '<span class="sub">…</span>'), 'tags'),
    textRow('Scrobbling since', stats.map(s => fmtDate(s.firstEver))),
  ].join('') + '</tbody>';
}

export function renderTags(index, tags) {
  const cell = document.getElementById(`tags-${index}`);
  if (cell) cell.textContent = tags.length ? tags.join(', ') : '—';
}

// ---------- Overlap

export function renderOverlap(people, result, common, kind) {
  const noun = NOUN[kind];
  const counted = [...result.regions.values()].reduce((a, b) => a + b, 0);
  const everyone = result.regions.get((1 << people.length) - 1) || 0;
  $('#vennPanel').innerHTML = people.length <= 3
    ? `<h3>Who has which ${noun}</h3>${vennSvg(people, result.regions, noun)}<p class="note">Circles aren't drawn to scale. ${fmt(counted)} ${noun} in total${people.length > 2 ? `, ${fmt(everyone)} shared by everyone` : ''}.</p>`
    : sharedByBars(people, result.regions, noun);

  // "Listening in common" only for two people; for more, see compatibility over time.
  const match = $('#matchPanel');
  match.hidden = common == null;
  match.closest('.overlap-grid').classList.toggle('single', common == null);
  if (common == null) return;
  match.innerHTML = `
    <h3>Listening in common</h3>
    <div class="big-number">${Math.round(common * 100)}%</div>
    <p class="note">Of each person's plays, the share that goes to ${noun} the other also plays, counting the smaller share of each. 100% would mean identical listening.</p>
    <p>${fmt(result.shared.length)} shared ${noun}</p>`;
}

// ---------- Shared table

export function renderShared(people, rows, { kind, minPlays, sort, total }) {
  const n = people.length;
  const table = $('#sharedTable');
  // On phones "Played first" moves under the name (see .first-inline in the CSS).
  table.style.setProperty('--columns', `minmax(11rem, 1fr) repeat(${n}, 5.2rem) 8.5rem`);
  table.style.setProperty('--columns-narrow', `minmax(8.5rem, 1fr) repeat(${n}, 4.6rem)`);
  $('#sharedTitle').textContent = `Shared ${NOUN[kind]}`;

  const sortButton = (key, label, align = '') =>
    `<div class="${align}"><button type="button" data-sort="${key}" ${sort === key ? 'aria-sort="descending"' : ''}>${label}</button></div>`;
  const header = `<div class="table-row table-head">
    ${sortButton('name', ONE[kind][0].toUpperCase() + ONE[kind].slice(1))}
    ${people.map((p, i) => sortButton(`p${i}`, `${swatch(p.slot)}${esc(p.profile.name)}`, 'num')).join('')}
    ${sortButton('first', 'Played first', 'first-cell')}
  </div>`;

  const shown = rows.slice(0, MAX_RENDERED_ROWS);
  const body = shown.map(row => {
    const first = people[row.foundFirst];
    return `<div class="table-row">
      <div class="item-name">${row.artist ? esc(row.name) : artistLink(row.name)}${row.artist ? `<span class="item-sub">${artistLink(row.artist)}</span>` : ''}<span class="item-sub first-inline">${swatch(first.slot)}${esc(first.profile.name)} first, ${fmtMonth(row.first[row.foundFirst])}</span></div>
      ${row.plays.map(plays => `<div class="num ${plays === 0 ? 'zero' : plays < minPlays ? 'under' : ''}">${plays ? fmt(plays) : '–'}</div>`).join('')}
      <div class="first-cell">${swatch(first.slot)}${esc(first.profile.name)}<span class="item-sub">${fmtDate(row.first[row.foundFirst])}</span></div>
    </div>`;
  }).join('');

  table.innerHTML = header + `<div class="table-body">${body || `<div class="empty">No shared ${NOUN[kind]} with these settings.</div>`}</div>`;
  const scrollBox = table.querySelector('.table-body');
  scrollBox.scrollTop = 0;
  fitRows(scrollBox, TABLE_ROWS);

  $('#sharedNote').textContent = rows.length > shown.length
    ? `Showing the top ${fmt(shown.length)} of ${fmt(rows.length)}. Search to find the rest.`
    : rows.length !== total ? `${fmt(rows.length)} of ${fmt(total)} shared ${NOUN[kind]} match the search.` : '';
}

// ---------- Only one of you

export function renderUnique(people, unique, kind) {
  $('#uniqueTitle').textContent = `${NOUN[kind][0].toUpperCase() + NOUN[kind].slice(1)} only one of you plays`;
  $('#uniqueGrid').innerHTML = people.map((p, i) => {
    const list = unique[i];
    const items = list.slice(0, MAX_RENDERED_ROWS).map(row => `
      <li><div><div class="item-name">${row.artist ? esc(row.name) : artistLink(row.name)}</div>${row.artist ? `<span class="item-sub">${artistLink(row.artist)}</span>` : ''}</div>
      <span class="num">${fmt(row.plays[i])}</span></li>`).join('');
    return `<div class="panel" style="--color:${color(p.slot)}">
      <h3><span>${esc(p.profile.name)}</span><small>${fmt(list.length)}</small></h3>
      <ul class="unique-list">${items || `<li class="empty">Nothing only ${esc(p.profile.name)} plays.</li>`}</ul>
    </div>`;
  }).join('');
  document.querySelectorAll('.unique-list').forEach(list => fitRows(list, PANEL_ROWS));
}

export function renderLegend(people) {
  $('#timelineLegend').innerHTML = people.map(p => `<span>${swatch(p.slot)}${esc(p.profile.name)}</span>`).join('');
}

// ---------- Genres compared: the genres that lead across everyone, each with a bar per person

export function renderGenreCompare(people, genres) {
  const average = new Map();
  genres.forEach(g => g.shares.forEach(s => average.set(s.name, (average.get(s.name) || 0) + s.share / genres.length)));
  const names = [...average].sort((a, b) => b[1] - a[1]).slice(0, GENRES_SHOWN).map(([name]) => name);
  const shareOf = (g, name) => g.shares.find(s => s.name === name)?.share || 0;
  const max = Math.max(0.01, ...names.flatMap(name => genres.map(g => shareOf(g, name))));
  if (people.length === 2 && names.length) { renderButterfly(people, genres, names, shareOf, max); return; }
  $('#genreCompare').innerHTML = names.length ? `<div class="genre-compare">${names.map(name => `
    <div class="genre-group"><div class="genre-name">${esc(name)}</div><div class="bar-rows">${people.map((p, i) => {
      const share = shareOf(genres[i], name);
      return `<div class="bar-row person-bar"><span>${swatch(p.slot)}${esc(p.profile.name)}</span><div class="bar"><span style="width:${(share / max) * 100}%;background:${color(p.slot)}"></span></div><span class="value">${Math.round(share * 100)}%</span></div>`;
    }).join('')}</div></div>`).join('')}</div>` : '<p class="muted">No tags found for these artists.</p>';
}

// Two people: genres down the middle, one person's share growing left, the other's right.
function renderButterfly(people, genres, names, shareOf, max) {
  const [a, b] = people;
  const side = (person, share, dir) => `<div class="fly-side ${dir}"><span class="value">${Math.round(share * 100)}%</span><div class="bar">${share ? `<span style="width:${(share / max) * 100}%;background:${color(person.slot)}"></span>` : ''}</div></div>`;
  $('#genreCompare').innerHTML = `<div class="butterfly">
    <div class="fly-row fly-head"><div class="fly-side left">${swatch(a.slot)}${esc(a.profile.name)}</div><div></div><div class="fly-side right">${swatch(b.slot)}${esc(b.profile.name)}</div></div>
    ${names.map(name => `<div class="fly-row">${side(a, shareOf(genres[0], name), 'left')}<div class="fly-name">${esc(name)}</div>${side(b, shareOf(genres[1], name), 'right')}</div>`).join('')}
  </div>`;
}
