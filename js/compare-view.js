// The Compare tab's tables and lists: head to head, overlap, genres, shared items and "only one of you".

import { $, esc, fmt, pct, fmtDate, fmtMonth, fitRows, artistLink, listRow, swatch, personColor, SINGULAR, capitalize } from './util.js';
import { TABLE_ROWS, PANEL_ROWS, MAX_RENDERED_ROWS, GENRES_SHOWN } from './config.js';
import { vennSvg, sharedByBars } from './charts.js';

// ---------- Head to head

// stats: per person { scrobbles, perDay, artists, albums, tracks, foundFirst, topArtist, firstEver }
export function renderStats(people, stats, kind) {
  // a number row marks the highest value, unless everyone ties
  const numberRow = (label, values, format = fmt) => {
    const best = Math.max(...values);
    const tie = values.every(v => v === best);
    return `<tr><th scope="row">${label}</th>${values.map(v =>
      `<td class="${v === best && v > 0 && !tie ? 'lead-value' : ''}">${format(v)}</td>`).join('')}</tr>`;
  };
  const textRow = (label, cells, id) =>
    `<tr><th scope="row">${label}</th>${cells.map((cell, i) => `<td class="text"${id ? ` id="${id}-${i}"` : ''}>${cell}</td>`).join('')}</tr>`;
  const column = key => stats.map(s => s[key]);

  $('#statsTable').innerHTML = `<thead><tr><th></th>${people.map(p => `<th scope="col">${swatch(p.slot)}${esc(p.profile.name)}</th>`).join('')}</tr></thead>
    <tbody>
      ${numberRow('Scrobbles', column('scrobbles'))}
      ${numberRow('Scrobbles a day', column('perDay'), v => v.toFixed(1))}
      ${numberRow('Artists', column('artists'))}
      ${numberRow('Albums', column('albums'))}
      ${numberRow('Tracks', column('tracks'))}
      ${numberRow(`Played shared ${kind} first`, column('foundFirst'))}
      ${textRow('Top artist', stats.map(s => s.topArtist ? `${artistLink(s.topArtist.name)}<span class="sub">${fmt(s.topArtist.plays)} plays</span>` : '—'))}
      ${textRow('Top genres', stats.map(() => '<span class="sub">…</span>'), 'topGenres')}
      ${textRow('Scrobbling since', stats.map(s => fmtDate(s.firstEver)))}
    </tbody>`;
}

// Filled in once the genres have loaded.
export function renderTopGenres(index, names) {
  const cell = document.getElementById(`topGenres-${index}`);
  if (cell) cell.textContent = names.join(', ') || '—';
}

// ---------- Overlap

// common: "listening in common" for two people, null for more
export function renderOverlap(people, result, common, kind) {
  const counted = [...result.regions.values()].reduce((a, b) => a + b, 0);
  const everyone = result.regions.get((1 << people.length) - 1) || 0;
  $('#vennPanel').innerHTML = people.length > 3 ? sharedByBars(people, result.regions, kind) : `
    <h3>Who has which ${kind}</h3>
    ${vennSvg(people, result.regions, kind)}
    <p class="note">Circles aren't drawn to scale. ${fmt(counted)} ${kind} in total${people.length > 2 ? `, ${fmt(everyone)} shared by everyone` : ''}.</p>`;

  const match = $('#matchPanel');
  match.hidden = common == null;
  match.closest('.overlap-grid').classList.toggle('single', common == null);
  if (common == null) return;
  match.innerHTML = `
    <h3>Listening in common</h3>
    <div class="big-number">${pct(common)}</div>
    <p class="note">Of each person's plays, the share that goes to ${kind} the other also plays, counting the smaller share of each. 100% would mean identical listening.</p>
    <p>${fmt(result.shared.length)} shared ${kind}</p>`;
}

// ---------- Genres: a butterfly chart for two people, a group of bars per genre for more

// genres: per person, from genres.js genreShares()
export function renderGenreCompare(people, genres) {
  const average = new Map();
  for (const g of genres) for (const s of g.shares) average.set(s.name, (average.get(s.name) || 0) + s.share / genres.length);
  const names = [...average].sort((a, b) => b[1] - a[1]).slice(0, GENRES_SHOWN).map(([name]) => name);
  if (!names.length) { $('#genreCompare').innerHTML = '<p class="muted">No tags found for these artists.</p>'; return; }

  const shareOf = (i, name) => genres[i].shares.find(s => s.name === name)?.share || 0;
  const max = Math.max(...names.flatMap(name => people.map((_, i) => shareOf(i, name))));
  const bar = (person, share) => `<div class="bar">${share ? `<span style="width:${(share / max) * 100}%;background:${personColor(person.slot)}"></span>` : ''}</div>`;

  if (people.length === 2) {
    const [a, b] = people;
    $('#genreCompare').innerHTML = `<div class="butterfly">
      <div class="fly-row fly-head"><div class="fly-side left">${swatch(a.slot)}${esc(a.profile.name)}</div><div></div><div class="fly-side right">${swatch(b.slot)}${esc(b.profile.name)}</div></div>
      ${names.map(name => `<div class="fly-row">
        <div class="fly-side left"><span class="value">${pct(shareOf(0, name))}</span>${bar(a, shareOf(0, name))}</div>
        <div class="fly-name">${esc(name)}</div>
        <div class="fly-side right">${bar(b, shareOf(1, name))}<span class="value">${pct(shareOf(1, name))}</span></div>
      </div>`).join('')}
    </div>`;
    return;
  }

  $('#genreCompare').innerHTML = `<div class="genre-compare">${names.map(name => `
    <div><div class="genre-name">${esc(name)}</div><div class="bar-rows">${people.map((p, i) => `
      <div class="bar-row person-bar"><span>${swatch(p.slot)}${esc(p.profile.name)}</span>${bar(p, shareOf(i, name))}<span class="value">${pct(shareOf(i, name))}</span></div>`).join('')}
    </div></div>`).join('')}</div>`;
}

// ---------- Shared table

// rows: shared items after search and sort; total: before the search
export function renderShared(people, rows, { kind, minPlays, sort, total }) {
  const table = $('#sharedTable');
  // On phones "Played first" moves under the name (.first-inline in the CSS).
  table.style.setProperty('--columns', `minmax(11rem, 1fr) repeat(${people.length}, 5.2rem) 8.5rem`);
  table.style.setProperty('--columns-narrow', `minmax(8.5rem, 1fr) repeat(${people.length}, 4.6rem)`);
  $('#sharedTitle').textContent = `Shared ${kind}`;

  const sortButton = (key, label, cls = '') =>
    `<div class="${cls}"><button type="button" data-sort="${key}"${sort === key ? ' aria-sort="descending"' : ''}>${label}</button></div>`;
  const header = `<div class="table-row table-head">
    ${sortButton('name', capitalize(SINGULAR[kind]))}
    ${people.map((p, i) => sortButton(`p${i}`, `${swatch(p.slot)}${esc(p.profile.name)}`, 'num')).join('')}
    ${sortButton('first', 'Played first', 'first-cell')}
  </div>`;

  const shown = rows.slice(0, MAX_RENDERED_ROWS);
  const body = shown.map(row => {
    const first = people[row.foundFirst];
    const firstTime = row.first[row.foundFirst];
    const plays = row.plays.map(n => `<div class="num ${n === 0 ? 'zero' : n < minPlays ? 'under' : ''}">${n ? fmt(n) : '–'}</div>`).join('');
    return `<div class="table-row">
      <div class="item-name">${row.artist ? esc(row.name) : artistLink(row.name)}
        ${row.artist ? `<span class="item-sub">${artistLink(row.artist)}</span>` : ''}
        <span class="item-sub first-inline">${swatch(first.slot)}${esc(first.profile.name)} first, ${fmtMonth(firstTime)}</span>
      </div>
      ${plays}
      <div class="first-cell">${swatch(first.slot)}${esc(first.profile.name)}<span class="item-sub">${fmtDate(firstTime)}</span></div>
    </div>`;
  }).join('');

  table.innerHTML = `${header}<div class="table-body">${body || `<div class="empty">No shared ${kind} with these settings.</div>`}</div>`;
  const scrollBox = table.querySelector('.table-body');
  fitRows(scrollBox, TABLE_ROWS);

  $('#sharedNote').textContent = rows.length > shown.length ? `Showing the top ${fmt(shown.length)} of ${fmt(rows.length)}. Search to find the rest.`
    : rows.length !== total ? `${fmt(rows.length)} of ${fmt(total)} shared ${kind} match the search.` : '';
}

// ---------- Only one of you

export function renderUnique(people, unique, kind) {
  $('#uniqueTitle').textContent = `${capitalize(kind)} only one of you plays`;
  $('#uniqueGrid').innerHTML = people.map((p, i) => `
    <div class="panel list-panel" style="--color:${personColor(p.slot)}">
      <h3><span>${esc(p.profile.name)}</span><small>${fmt(unique[i].length)}</small></h3>
      <ul class="item-list">${unique[i].slice(0, MAX_RENDERED_ROWS).map(row => listRow(row, fmt(row.plays[i]))).join('')
        || `<li class="empty">Nothing only ${esc(p.profile.name)} plays.</li>`}</ul>
    </div>`).join('');
  document.querySelectorAll('#uniqueGrid .item-list').forEach(list => fitRows(list, PANEL_ROWS));
}
