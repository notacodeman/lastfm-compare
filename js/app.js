// Page state, the URL, events and the order things are drawn in.
// The maths lives in analyze/report/pair/artist/genres.js, the drawing in the *-view.js and *-charts.js files.

import { $, esc, nowSec, download } from './util.js';
import { MAX_PEOPLE, GENRE_ARTISTS } from './config.js';
import { fetchProfile, fetchHistory, savedPeople } from './history.js';
import { clearAll } from './store.js';
import { KINDS, periodRange, compare, overlap, perDay, nameKey } from './analyze.js';
import { UNITS, periodFromKey, reportPeriod, shiftPeriod, periodLabel } from './report.js';
import { genreShares, topArtists } from './genres.js';
import { loadTags, tagsFor } from './genre-loader.js';
import { periodSummary, allTimeSummary, clearCache } from './summaries.js';
import { toCsv } from './artist.js';
import { renderPeople, renderProgress, renderSaved } from './people.js';
import { renderStats, renderTopGenres, renderOverlap, renderGenreCompare, renderShared, renderUnique } from './compare-view.js';
import { renderTimeline, renderCompatibility, renderPair, renderFirsts, renderClocks } from './compare-charts.js';
import { renderReport, periodOptions, shownReport } from './report-view.js';
import { renderArtist } from './artist-view.js';
import { saveReportImage } from './share-card.js';
import { enableSectionSnap } from './snap.js';

const PERIODS = { all: 'All time', '12m': 'Last 12 months', '90d': 'Last 90 days', '30d': 'Last 30 days' };
const MIN_PLAYS = [1, 3, 10, 25];
const VIEWS = ['compare', 'report', 'artist'];
// Last.fm usernames: letters, numbers, - and _ (older accounts can be longer than today's 15)
const USERNAME = /^[\w-]{2,30}$/;

const state = {
  people: [],              // { username, key, slot, status, profile, rows, progress, error, controller, cache }
  view: 'compare',         // 'compare' | 'report' | 'artist'
  returnView: 'compare',   // where the artist page's Back button goes
  // Compare tab
  kind: 'artists',
  period: 'all',
  minPlays: 1,
  sharedBy: '2',           // '2' (two or more) or 'all'
  sort: null,              // shared table column; null = shared by most people, then most plays together
  search: '',
  compatWith: null,        // whose compatibility over time to show, with 3+ people
  pair: [null, null],      // keys of the two people in "Side by side" (picked when there are 3+)
  runningTotal: false,
  // Reports tab and artist page
  report: { person: null, unit: 'month', key: null },   // key null = the current period
  artist: null,
};
let comparison = null;   // the last comparison, reused when only the shared table's search or sort changes
let genreRun = 0;        // bumps on every redraw so tags arriving late for an old view are ignored

const ready = () => state.people.filter(p => p.status === 'ready');
const nameOf = person => person.profile?.name || person.username;

// ---------- URL: ?u=name,name&k=albums&p=2024&m=3&v=report&r=name&ru=year&rk=2024&a=artist

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (KINDS.includes(q.get('k'))) state.kind = q.get('k');
  if (q.get('p')) state.period = q.get('p');   // checked against the real options once histories load
  if (MIN_PLAYS.includes(+q.get('m'))) state.minPlays = +q.get('m');
  if (VIEWS.includes(q.get('v'))) state.view = q.get('v');
  state.artist = q.get('a');
  if (state.view === 'artist' && !state.artist) state.view = 'compare';
  if (q.get('r')) state.report.person = q.get('r').toLowerCase();
  if (UNITS.includes(q.get('ru'))) state.report.unit = q.get('ru');
  state.report.key = q.get('rk');
  return (q.get('u') || '').split(',').map(s => s.trim()).filter(Boolean);
}

function writeUrl() {
  const q = new URLSearchParams();
  if (state.people.length) q.set('u', state.people.map(nameOf).join(','));
  if (state.kind !== 'artists') q.set('k', state.kind);
  if (state.period !== 'all') q.set('p', state.period);
  if (state.minPlays !== 1) q.set('m', state.minPlays);
  if (state.view !== 'compare') q.set('v', state.view);
  if (state.view === 'report') {
    const person = state.people.find(p => p.key === state.report.person);
    if (person) q.set('r', nameOf(person));
    if (state.report.unit !== 'month') q.set('ru', state.report.unit);
    if (state.report.key) q.set('rk', state.report.key);
  }
  if (state.view === 'artist') q.set('a', state.artist);
  const search = q.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', search ? `?${search}` : location.pathname);
}

// ---------- People

function addPerson(input) {
  const username = input.trim();
  const error = $('#addError');
  const fail = message => { error.textContent = message; error.hidden = false; };
  error.hidden = true;
  if (!username) return;
  if (!USERNAME.test(username)) return fail("That doesn't look like a Last.fm username (letters, numbers, - and _ only).");
  const key = username.toLowerCase();
  if (state.people.some(p => p.key === key)) return fail(`${username} is already added.`);
  if (state.people.length >= MAX_PEOPLE) return fail(`Up to ${MAX_PEOPLE} people at a time.`);

  // Each person keeps their colour even when someone added before them is removed.
  const used = new Set(state.people.map(p => p.slot));
  const slot = [...Array(MAX_PEOPLE).keys()].find(i => !used.has(i));
  const person = { username, key, slot, status: 'loading', rows: [] };
  state.people.push(person);
  writeUrl();
  startDownload(person);
}

async function startDownload(person) {
  person.controller?.abort();
  const controller = person.controller = new AbortController();
  person.status = 'loading';
  person.error = null;
  renderPeople(state.people);
  try {
    person.profile ??= await fetchProfile(person.username, controller.signal);
    renderPeople(state.people);
    writeUrl();
    person.rows = await fetchHistory(person.profile.name, {
      signal: controller.signal,
      onProgress: progress => { person.progress = progress; renderProgress(person); },
    });
    clearCache(person);
    person.status = 'ready';
  } catch (err) {
    if (controller.signal.aborted) return;   // paused or removed; whoever aborted redraws
    person.status = 'error';
    person.error = err.message;
  }
  renderPeople(state.people);
  update();
  showSaved();
}

function onPersonAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const person = state.people.find(p => p.key === button.closest('.person').dataset.key);
  switch (button.dataset.action) {
    case 'pause':
      person.controller.abort();
      person.status = 'paused';
      break;
    case 'resume':
    case 'refresh':
      startDownload(person);
      return;
    case 'csv':
      download(`scrobbles-${nameOf(person)}.csv`, toCsv(person.rows), 'text/csv');
      return;
    case 'remove':
      person.controller?.abort();
      state.people.splice(state.people.indexOf(person), 1);
      writeUrl();
      update();
      showSaved();
      break;
  }
  renderPeople(state.people);
}

// Histories saved in this browser, as buttons that add them. Several calls can overlap; the last one wins.
let savedRun = 0;
async function showSaved() {
  const run = ++savedRun;
  const saved = await savedPeople();
  if (run === savedRun) renderSaved(saved, new Set(state.people.map(p => p.key)));
}

// ---------- Drawing

// Full redraw of the current view (people, period, kind or minimum plays changed).
function update() {
  const people = ready();
  const loading = state.people.filter(p => p.status === 'loading').map(nameOf);
  $('#results').hidden = !people.length;
  $('#waitingNote').hidden = !loading.length || people.length < 2;
  $('#waitingNote').textContent = `Still downloading: ${loading.join(', ')}. They'll be added when they finish.`;
  showView();
  comparison = null;
  if (!people.length) return;
  if (state.view === 'report') return renderReportTab(people);
  if (state.view === 'artist') return renderArtist({ people, name: state.artist });
  $('#compareNeedsTwo').hidden = people.length > 1;
  $('#compareBody').hidden = people.length < 2;
  if (people.length > 1) renderCompareTab(people);
}

function renderCompareTab(people) {
  fillPeriodPicker(people);
  syncControls(people);
  const now = nowSec();
  const range = periodRange(state.period, now);
  const summaries = people.map(p => periodSummary(p, state.period, range));
  const result = compare(summaries, state.kind, state.minPlays);

  const foundFirst = people.map(() => 0);
  for (const row of result.shared) foundFirst[row.foundFirst]++;
  const stats = people.map((p, i) => {
    const s = summaries[i];
    const topArtist = [...s.artists.values()].reduce((top, a) => !top || a.plays > top.plays ? a : top, null);
    return {
      scrobbles: s.scrobbles, artists: s.artists.size, albums: s.albums.size, tracks: s.tracks.size,
      perDay: perDay(s, range, p.rows[0]?.[0], now),
      foundFirst: foundFirst[i],
      topArtist,
      firstEver: p.rows[0]?.[0] ?? null,
    };
  });

  comparison = { people, summaries, result, range };
  renderStats(people, stats, state.kind);
  renderOverlap(people, result, people.length === 2 ? overlap(summaries[0], summaries[1], state.kind) : null, state.kind);
  renderCompatibility({ people, kind: state.kind, focusKey: state.compatWith });
  renderPairSection();
  renderFirsts({ people, allTime: people.map(allTimeSummary), kind: state.kind, minPlays: state.minPlays });
  renderSharedTable();
  renderUnique(people, result.unique, state.kind);
  renderClocks({ people, range });
  renderTimelineSection();
  loadCompareGenres(people, summaries);
}

function fillPeriodPicker(people) {
  const options = { ...PERIODS };
  const firstYear = Math.min(...people.filter(p => p.rows.length).map(p => new Date(p.rows[0][0] * 1000).getFullYear()));
  for (let y = new Date().getFullYear(); y >= firstYear; y--) options[y] = String(y);
  if (!options[state.period]) state.period = 'all';
  $('#periodPicker').innerHTML = Object.entries(options)
    .map(([value, label]) => `<option value="${value}"${value === state.period ? ' selected' : ''}>${label}</option>`).join('');
}

function syncControls(people) {
  document.querySelectorAll('#kindPicker button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === state.kind));
  $('#minPlaysPicker').value = String(state.minPlays);
  $('#sharedByPicker').hidden = people.length < 3;
  $('#sharedByPicker').value = state.sharedBy;
  document.querySelectorAll('#timelineMode button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.mode === 'total') === state.runningTotal));
}

// Search, sort and "shared by" only redraw the shared table.
function renderSharedTable() {
  if (!comparison) return;
  const { people, result } = comparison;
  let rows = state.sharedBy === 'all' ? result.shared.filter(r => r.sharedBy === people.length) : result.shared;
  const total = rows.length;
  const needle = nameKey(state.search);
  if (needle) rows = rows.filter(r => nameKey(r.name).includes(needle) || (r.artist && nameKey(r.artist).includes(needle)));
  if (state.sort) {
    const person = state.sort.startsWith('p') ? +state.sort.slice(1) : null;
    const order = state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : state.sort === 'first' ? (a, b) => a.first[a.foundFirst] - b.first[b.foundFirst]
      : (a, b) => b.plays[person] - a.plays[person];
    rows = [...rows].sort(order);
  }
  renderShared(people, rows, { kind: state.kind, minPlays: state.minPlays, sort: state.sort, total });
}

function renderPairSection() {
  if (!comparison) return;
  const { people, summaries } = comparison;
  const a = people.find(p => p.key === state.pair[0]) || people[0];
  const b = people.find(p => p.key === state.pair[1] && p !== a) || people.find(p => p !== a);
  state.pair = [a.key, b.key];
  const options = selected => people.map(p => `<option value="${esc(p.key)}"${p === selected ? ' selected' : ''}>${esc(p.profile.name)}</option>`).join('');
  $('#pairTools').hidden = people.length < 3;
  $('#pairA').innerHTML = options(a);
  $('#pairB').innerHTML = options(b);
  renderPair({ a, b, sa: summaries[people.indexOf(a)], sb: summaries[people.indexOf(b)], kind: state.kind, onArtist: openArtist });
}

function renderTimelineSection() {
  if (!comparison) return;
  renderTimeline({ people: comparison.people, range: comparison.range, wholeHistory: state.period === 'all', runningTotal: state.runningTotal });
}

// Genres need artist tags from Last.fm, so they fill in after everything else.
async function loadCompareGenres(people, summaries) {
  const run = ++genreRun;
  const lists = summaries.map(s => topArtists(s, GENRE_ARTISTS));
  const status = $('#genreStatus');
  await loadTags(lists.flat().map(a => a.name), (done, total) => {
    if (run === genreRun) status.textContent = `Fetching artist tags from Last.fm: ${done} of ${total} (saved for next time)…`;
  });
  if (run !== genreRun) return;
  const genres = lists.map(list => genreShares(list, tagsFor));
  status.textContent = `From Last.fm's tags for each person's top ${GENRE_ARTISTS} artists in this period. Each artist's plays are split across its tags.`;
  genres.forEach((g, i) => renderTopGenres(i, g.shares.slice(0, 3).map(s => s.name)));
  renderGenreCompare(people, genres);
}

// The person shown in Reports (the first one, until another is picked).
function reportPerson() {
  const people = ready();
  return people.find(p => p.key === state.report.person) || people[0];
}

function currentPeriod(now = nowSec()) {
  return periodFromKey(state.report.unit, state.report.key) || reportPeriod(state.report.unit, new Date(now * 1000));
}

function renderReportTab(people) {
  const person = reportPerson();
  const now = nowSec();
  const period = currentPeriod(now);
  $('#reportPerson').innerHTML = people.map(p => `<button type="button" data-person="${esc(p.key)}" aria-pressed="${p === person}">`
    + `<span class="swatch" style="--color:var(--person-${p.slot})"></span>${esc(p.profile.name)}</button>`).join('');
  document.querySelectorAll('#reportUnit button').forEach(b => b.setAttribute('aria-pressed', b.dataset.unit === period.unit));
  const options = periodOptions(person, period.unit, now);
  if (!options.some(o => o.key === period.key)) options.unshift(period);
  $('#reportPeriodPicker').innerHTML = options.map(o => `<option value="${o.key}"${o.key === period.key ? ' selected' : ''}>${periodLabel(o)}</option>`).join('');
  $('#periodNext').disabled = period.end / 1000 > now;
  $('#periodPrev').disabled = !person.rows.length || period.from <= person.rows[0][0];
  renderReport({
    people, person, period, now, onArtist: openArtist,
    onOpenMonth: key => { openReport({ unit: 'month', key }); $('#rSummary').scrollIntoView(); },
  });
}

// ---------- Views

function showView() {
  const tab = state.view === 'artist' ? state.returnView : state.view;
  document.querySelectorAll('.view-tabs [data-view]').forEach(t => t.setAttribute('aria-selected', t.dataset.view === tab));
  for (const view of VIEWS) $(`#${view}View`).hidden = state.view !== view;
}

function setView(view) {
  if (view !== 'artist') state.returnView = view;
  state.view = view;
  writeUrl();
  update();
}

function openArtist(name) {
  state.artist = name;
  setView('artist');
  scrollTo({ top: $('#results').offsetTop - 8 });
}

function openReport(changes) {
  Object.assign(state.report, changes);
  setView('report');
}

// ---------- Events

$('#addForm').addEventListener('submit', event => {
  event.preventDefault();
  $('#userInput').value.split(/[\s,]+/).forEach(addPerson);
  $('#userInput').value = '';
  showSaved();
});
$('#people').addEventListener('click', onPersonAction);
$('#savedPeople').addEventListener('click', event => {
  const chip = event.target.closest('[data-saved], [data-saved-all]');
  if (!chip) return;
  const chips = 'savedAll' in chip.dataset ? $('#savedPeople').querySelectorAll('[data-saved]') : [chip];
  for (const c of chips) addPerson(c.dataset.saved);
  showSaved();
});

document.querySelector('.view-tabs').addEventListener('click', event => {
  const view = event.target.closest('[data-view]')?.dataset.view;
  if (view && view !== state.view) setView(view);
});
// Artist names anywhere on the page open the artist page.
document.addEventListener('click', event => {
  const link = event.target.closest('[data-artist]');
  if (link) openArtist(link.dataset.artist);
});
$('#artistBack').addEventListener('click', () => setView(state.returnView));

// Compare tab
const redraw = () => { writeUrl(); update(); };
$('#kindPicker').addEventListener('click', event => {
  const kind = event.target.closest('[data-kind]')?.dataset.kind;
  if (!kind || kind === state.kind) return;
  state.kind = kind;
  state.sort = null;
  redraw();
});
$('#periodPicker').addEventListener('change', event => { state.period = event.target.value; redraw(); });
$('#minPlaysPicker').addEventListener('change', event => { state.minPlays = +event.target.value; redraw(); });
$('#sharedByPicker').addEventListener('change', event => { state.sharedBy = event.target.value; renderSharedTable(); });
$('#sharedSearch').addEventListener('input', event => { state.search = event.target.value; renderSharedTable(); });
$('#sharedTable').addEventListener('click', event => {
  const column = event.target.closest('[data-sort]')?.dataset.sort;
  if (!column) return;
  state.sort = state.sort === column ? null : column;
  renderSharedTable();
});
$('#compatPerson').addEventListener('change', event => {
  state.compatWith = event.target.value;
  renderCompatibility({ people: ready(), kind: state.kind, focusKey: state.compatWith });
});
for (const [i, select] of [$('#pairA'), $('#pairB')].entries()) {
  select.addEventListener('change', () => {
    const previous = state.pair[i];
    state.pair[i] = select.value;
    if (state.pair[1 - i] === select.value) state.pair[1 - i] = previous;   // picking the other side's person swaps them
    renderPairSection();
  });
}
$('#timelineMode').addEventListener('click', event => {
  const mode = event.target.closest('[data-mode]')?.dataset.mode;
  if (!mode) return;
  state.runningTotal = mode === 'total';
  syncControls(ready());
  renderTimelineSection();
});

// Reports tab
$('#reportPerson').addEventListener('click', event => {
  const key = event.target.closest('[data-person]')?.dataset.person;
  if (key) openReport({ person: key });
});
$('#reportUnit').addEventListener('click', event => {
  const unit = event.target.closest('[data-unit]')?.dataset.unit;
  // switching unit keeps roughly the same time: the new unit's period containing the old one's start
  if (unit && unit !== state.report.unit) openReport({ unit, key: reportPeriod(unit, currentPeriod().start).key });
});
$('#reportPeriodPicker').addEventListener('change', event => openReport({ key: event.target.value }));
$('#periodPrev').addEventListener('click', () => openReport({ key: shiftPeriod(currentPeriod(), -1).key }));
$('#periodNext').addEventListener('click', () => openReport({ key: shiftPeriod(currentPeriod(), 1).key }));
$('#saveImage').addEventListener('click', async ({ currentTarget: button }) => {
  const shown = shownReport();
  if (!shown) return;
  button.disabled = true;
  button.textContent = 'Preparing image…';
  try {
    if (!shown.genres.length) {   // genres may still be loading; the image waits for them
      const artists = topArtists(shown.report.summary, GENRE_ARTISTS);
      await loadTags(artists.map(a => a.name));
      shown.genres = genreShares(artists, tagsFor).shares.slice(0, 3).map(g => g.name);
    }
    await saveReportImage(shown);
  } finally {
    button.disabled = false;
    button.textContent = 'Save as image';
  }
});

// Footer
$('#clearSaved').addEventListener('click', () => $('#clearDialog').showModal());
$('#clearDialog').addEventListener('close', async () => {
  if ($('#clearDialog').returnValue !== 'clear') return;
  state.people.forEach(p => p.controller?.abort());
  await clearAll();
  location.reload();
});

// ---------- Start

// The waveform above the footer is decoration, drawn once.
$('#waveform').innerHTML = Array.from({ length: 160 }, (_, i) => {
  const height = 0.18 + 0.82 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11) * Math.sin(i * 0.053 + 1));
  return `<i style="height:${Math.round(height * 100)}%"></i>`;
}).join('');

enableSectionSnap('.section > h2, .section-head > h2');
readUrl().slice(0, MAX_PEOPLE).forEach(addPerson);
showSaved();
