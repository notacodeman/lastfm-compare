// Page state, events and the order things happen in. The maths is in analyze.js, the HTML in render.js.

import { $, esc, nowSec, download as saveFile } from './util.js';
import { MAX_PEOPLE, DAILY_CHART_UP_TO_DAYS, GENRE_ARTISTS } from './config.js';
import { fetchProfile, fetchHistory, savedPeople } from './history.js';
import { clearAll } from './store.js';
import { KINDS, periodRange, summarize, compare, overlap, perDay, countByBucket, bucketAxis, bucketKey, nameKey } from './analyze.js';
import { renderPeople as drawPeople, renderProgress, renderStats, renderTags, renderOverlap, renderShared, renderUnique, renderLegend, renderGenreCompare } from './render.js';
import { lineChart, drawResponsive } from './charts.js';
import { UNITS, periodFromKey, reportPeriod, shiftPeriod, periodLabel, rowsBetween } from './report.js';
import { renderReport, periodOptions, currentReport as shownReport } from './report-view.js';
import { renderArtist } from './artist-view.js';
import { toCsv } from './artist.js';
import { renderPair, renderFirsts, renderClocks } from './compare-charts.js';
import { saveReportImage } from './share-card.js';
import { genreShares, topArtists } from './genres.js';
import { loadTags, tagsFor } from './genre-loader.js';
import { enableSectionSnap } from './snap.js';

const PERIODS = { all: 'All time', '12m': 'Last 12 months', '90d': 'Last 90 days', '30d': 'Last 30 days' };
const MIN_PLAYS = ['1', '3', '10', '25'];

const state = {
  people: [],         // { username, key, slot, status, profile, rows, progress, error, controller, summaries }
  kind: 'artists',
  period: 'all',
  minPlays: 1,
  sharedBy: '2',
  sort: null,         // null = shared by most people, then most plays together
  search: '',
  view: 'compare',    // 'compare' | 'report' | 'artist'
  report: { person: null, unit: 'month', key: null },   // key null = the current period
  compatWith: null,   // whose compatibility over time to show (3+ people)
  artist: null,       // artist page
  pairA: null,        // the two people in "Side by side" (3+ people)
  pairB: null,
  timelineMode: 'month',   // or 'total' (running total)
  returnView: 'compare',
};
const VIEWS = ['compare', 'report', 'artist'];
let view = null;      // the last comparison, reused when only the search or sort changes
let genreRun = 0;     // bumps on every redraw so late tag answers for an old view are dropped

// ---------- URL state: ?u=name,name&k=artists&p=all&m=1

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (KINDS.includes(q.get('k'))) state.kind = q.get('k');
  if (q.get('p')) state.period = q.get('p');
  if (MIN_PLAYS.includes(q.get('m'))) state.minPlays = +q.get('m');
  if (VIEWS.includes(q.get('v'))) state.view = q.get('v');
  if (q.get('a')) state.artist = q.get('a');
  if (state.view === 'artist' && !state.artist) state.view = 'compare';
  if (q.get('r')) state.report.person = q.get('r').toLowerCase();
  if (UNITS.includes(q.get('ru'))) state.report.unit = q.get('ru');
  if (q.get('rk')) state.report.key = q.get('rk');
  return (q.get('u') || '').split(',').map(s => s.trim()).filter(Boolean);
}

function writeUrl() {
  const q = new URLSearchParams();
  if (state.people.length) q.set('u', state.people.map(p => p.profile?.name || p.username).join(','));
  if (state.kind !== 'artists') q.set('k', state.kind);
  if (state.period !== 'all') q.set('p', state.period);
  if (state.minPlays !== 1) q.set('m', state.minPlays);
  if (state.view !== 'compare') q.set('v', state.view);
  if (state.view === 'report') {
    const person = state.people.find(p => p.key === state.report.person);
    if (person) q.set('r', person.profile?.name || person.username);
  }
  if (state.view === 'report') {
    if (state.report.unit !== 'month') q.set('ru', state.report.unit);
    if (state.report.key) q.set('rk', state.report.key);
  }
  if (state.view === 'artist') q.set('a', state.artist);
  const search = q.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', search ? `?${search}` : location.pathname);
}

// ---------- People

// Redraws the cards, and lets the equalizer in the header play while anything is downloading.
function renderPeople(people) {
  drawPeople(people);
  document.body.classList.toggle('busy', people.some(p => p.status === 'loading'));
}

function addPerson(input) {
  const username = input.trim();
  const error = $('#addError');
  error.hidden = true;
  if (!username) return;
  const say = message => { error.textContent = message; error.hidden = false; };
  if (!/^[\w.-]{2,40}$/.test(username)) return say("That doesn't look like a Last.fm username (letters, numbers, - and _ only).");
  const key = username.toLowerCase();
  if (state.people.some(p => p.key === key)) return say(`${username} is already added.`);
  if (state.people.length >= MAX_PEOPLE) return say(`Up to ${MAX_PEOPLE} people at a time.`);

  // Each person keeps their colour slot even when someone before them is removed.
  const used = new Set(state.people.map(p => p.slot));
  const slot = [...Array(MAX_PEOPLE).keys()].find(i => !used.has(i));
  const person = { username, key, slot, status: 'loading', rows: [] };
  state.people.push(person);
  renderPeople(state.people);
  writeUrl();
  download(person);
}

async function download(person) {
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
    person.summaries = new Map();
    person.first = null;   // first-play dates, rebuilt for reports when needed
    person.status = 'ready';
  } catch (err) {
    if (controller.signal.aborted) return;
    person.status = 'error';
    person.error = err.message;
  }
  renderPeople(state.people);
  update();
  renderSaved();
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
    case 'csv':
      saveFile(`scrobbles-${person.profile.name}.csv`, toCsv(person.rows), 'text/csv');
      return;
    case 'resume':
    case 'refresh':
      download(person);
      return;
    case 'remove':
      person.controller?.abort();
      state.people.splice(state.people.indexOf(person), 1);
      writeUrl();
      update();
      renderSaved();
      break;
  }
  renderPeople(state.people);
}

// Names saved in this browser, as buttons that add them (so you don't have to remember spellings).
let savedRun = 0;   // only the latest call draws, since several can be in flight
async function renderSaved() {
  const run = ++savedRun;
  const saved = await savedPeople();
  if (run !== savedRun) return;
  const added = new Set(state.people.map(p => p.key));
  const box = $('#savedPeople');
  const available = saved.filter(p => !added.has(p.key));
  box.hidden = !available.length;
  box.innerHTML = `<span class="control-label">Saved in this browser</span>${available.map(p =>
    `<button type="button" class="chip" data-saved="${esc(p.name)}">${esc(p.name)}${p.scrobbles != null ? `<small>${p.scrobbles.toLocaleString('en-US')}</small>` : ''}</button>`).join('')}${
    available.length > 1 ? '<button type="button" class="chip add-all" data-saved-all>Add all</button>' : ''}`;
}

// ---------- Comparison

const ready = () => state.people.filter(p => p.status === 'ready');

function summaryFor(person, range) {
  if (!person.summaries.has(state.period)) person.summaries.set(state.period, summarize(person.rows, range));
  return person.summaries.get(state.period);
}

function fillPeriodPicker(people) {
  const years = new Set();
  const thisYear = new Date().getFullYear();
  for (const p of people) {
    if (!p.rows.length) continue;
    for (let y = new Date(p.rows[0][0] * 1000).getFullYear(); y <= thisYear; y++) years.add(String(y));
  }
  const options = { ...PERIODS };
  [...years].sort().reverse().forEach(y => { options[y] = y; });
  if (!options[state.period]) state.period = 'all';
  $('#periodPicker').innerHTML = Object.entries(options)
    .map(([value, label]) => `<option value="${value}" ${value === state.period ? 'selected' : ''}>${label}</option>`).join('');
}

function syncControls() {
  document.querySelectorAll('#kindPicker button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === state.kind));
  $('#minPlaysPicker').value = String(state.minPlays);
  $('#sharedByPicker').hidden = ready().length < 3;
  $('#sharedByPicker').value = state.sharedBy;
}

// Full redraw: when people, period, kind or minimum plays change.
function update() {
  const people = ready();
  const loading = state.people.filter(p => p.status === 'loading').map(p => p.profile?.name || p.username);
  $('#results').hidden = people.length < 1;
  const waiting = $('#waitingNote');
  waiting.hidden = !loading.length || people.length < 2;
  waiting.textContent = `Still downloading: ${loading.join(', ')}. They'll be added when they finish.`;
  showView();
  if (!people.length) { view = null; return; }
  if (state.view === 'report') { renderReportView(); return; }
  if (state.view === 'artist') { renderArtist({ people, name: state.artist }); return; }
  $('#compareNeedsTwo').hidden = people.length >= 2;
  $('#compareBody').hidden = people.length < 2;
  if (people.length < 2) { view = null; return; }

  fillPeriodPicker(people);
  syncControls();
  const now = nowSec();
  const range = periodRange(state.period, now);
  const summaries = people.map(p => summaryFor(p, range));
  const result = compare(summaries, state.kind, state.minPlays);
  const common = summaries.length === 2 ? overlap(summaries[0], summaries[1], state.kind) : null;

  const foundFirst = people.map(() => 0);
  for (const row of result.shared) foundFirst[row.foundFirst]++;
  const stats = people.map((p, i) => {
    const s = summaries[i];
    let topArtist = null;
    for (const item of s.artists.values()) if (!topArtist || item.plays > topArtist.plays) topArtist = item;
    return {
      scrobbles: s.scrobbles,
      perDay: perDay(s, range, p.rows[0]?.[0], now),
      artists: s.artists.size, albums: s.albums.size, tracks: s.tracks.size,
      foundFirst: foundFirst[i],
      topArtist,
      firstEver: p.rows[0]?.[0] ?? null,
    };
  });

  view = { people, summaries, result, range };
  renderStats(people, stats, state.kind);
  renderOverlap(people, result, common, state.kind);
  renderSharedView();
  renderUnique(people, result.unique, state.kind);
  renderLegend(people);
  drawTimeline();
  drawCompatibility(people);
  drawPair();
  renderFirsts({ people, allTime: people.map(allTimeSummary), kind: state.kind, minPlays: state.minPlays });
  renderClocks({ people, range });
  loadCompareGenres(people, summaries);
}

function allTimeSummary(person) {
  if (!person.summaries.has('all')) person.summaries.set('all', summarize(person.rows, { from: -Infinity, to: Infinity }));
  return person.summaries.get('all');
}

// Side by side: two people at a time, picked when there are 3+.
function drawPair() {
  if (!view) return;
  const { people, summaries } = view;
  const a = people.find(p => p.key === state.pairA) || people[0];
  const b = people.find(p => p.key === state.pairB && p !== a) || people.find(p => p !== a);
  $('#pairTools').hidden = people.length < 3;
  const options = selected => people.map(p => `<option value="${p.key}" ${p === selected ? 'selected' : ''}>${esc(p.profile.name)}</option>`).join('');
  $('#pairA').innerHTML = options(a);
  $('#pairB').innerHTML = options(b);
  renderPair({ a, b, sa: summaries[people.indexOf(a)], sb: summaries[people.indexOf(b)], kind: state.kind, onArtist: openArtist });
}

// Listening in common for each calendar year (same measure as the Overlap section, all years).
function yearSummary(person, year) {
  const key = `year:${year}`;
  if (!person.summaries.has(key)) {
    const rows = rowsBetween(person.rows, new Date(year, 0, 1) / 1000, new Date(year + 1, 0, 1) / 1000 - 1);
    person.summaries.set(key, summarize(rows, { from: -Infinity, to: Infinity }));
  }
  return person.summaries.get(key);
}

function drawCompatibility(people) {
  const withRows = people.filter(p => p.rows.length);
  if (withRows.length < 2) return;
  const firstYear = Math.min(...withRows.map(p => new Date(p.rows[0][0] * 1000).getFullYear()));
  const years = [];
  for (let y = firstYear; y <= new Date().getFullYear(); y++) years.push(String(y));
  const focus = withRows.find(p => p.key === state.compatWith) || withRows[0];
  const picker = $('#compatPerson');
  picker.hidden = withRows.length < 3;
  picker.innerHTML = withRows.map(p => `<option value="${p.key}" ${p === focus ? 'selected' : ''}>${esc(p.profile.name)} with everyone</option>`).join('');
  const pairs = withRows.length === 2 ? [[withRows[0], withRows[1]]] : withRows.filter(p => p !== focus).map(p => [focus, p]);
  const series = pairs.map(([a, b]) => ({
    name: withRows.length === 2 ? `${a.profile.name} & ${b.profile.name}` : `with ${b.profile.name}`,
    slot: b.slot,
    color: withRows.length === 2 ? 'var(--text)' : undefined,
    values: years.map(y => {
      const sa = yearSummary(a, +y), sb = yearSummary(b, +y);
      return sa.scrobbles && sb.scrobbles ? overlap(sa, sb, state.kind) : null;
    }),
  }));
  // start at the first year two people both scrobbled
  const start = Math.max(0, years.findIndex((_, i) => series.some(s => s.values[i] != null)));
  years.splice(0, start);
  series.forEach(s => s.values.splice(0, start));
  const top = Math.max(0.1, ...series.flatMap(s => s.values).filter(v => v != null));
  $('#compatLegend').innerHTML = series.map(s => `<span><span class="swatch" style="--color:${s.color || `var(--person-${s.slot})`}"></span>${esc(s.name)}</span>`).join('');
  $('#compatNote').textContent = `Listening in common for ${state.kind} in each calendar year, measured the same way as above. Gaps are years when one of you didn't scrobble.`;
  drawResponsive($('#compatChart'), () => lineChart($('#compatChart'), {
    keys: years, series, labelFor: key => key, showTotal: false, max: top,
    format: v => `${Math.round(v * 100)}%`,
  }));
}

// Shared table only: search, sort and "shared by" don't need the comparison redone.
function renderSharedView() {
  if (!view) return;
  const { people, result } = view;
  const needle = nameKey(state.search);
  let rows = result.shared;
  if (state.sharedBy === 'all') rows = rows.filter(r => r.sharedBy === people.length);
  const total = rows.length;
  if (needle) rows = rows.filter(r => nameKey(r.name).includes(needle) || (r.artist && nameKey(r.artist).includes(needle)));
  if (state.sort) {
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      first: (a, b) => a.first[a.foundFirst] - b.first[b.foundFirst],
    }[state.sort] || ((i => (a, b) => b.plays[i] - a.plays[i])(+state.sort.slice(1)));
    rows = [...rows].sort(by);
  }
  renderShared(people, rows, { kind: state.kind, minPlays: state.minPlays, sort: state.sort, total });
}

function drawTimeline() {
  if (!view) return;
  const { people, range } = view;
  const times = people.flatMap(p => {
    const inRange = p.rows.filter(r => r[0] >= range.from && r[0] <= range.to);
    return inRange.length ? [inRange[0][0], inRange.at(-1)[0]] : [];
  });
  if (!times.length) { $('#timelineChart').innerHTML = '<p class="note">No scrobbles in this period.</p>'; return; }
  const from = state.period === 'all' ? Math.min(...times) : range.from;
  const to = Math.min(range.to, nowSec());
  const unit = (to - from) / 86400 <= DAILY_CHART_UP_TO_DAYS ? 'day' : 'month';
  const keys = bucketAxis(from, to, unit);
  const series = people.map(p => {
    const counts = countByBucket(p.rows, range, unit);
    const started = p.rows.length ? bucketKey(p.rows[0][0], unit) : '';
    const values = keys.map(k => k < started ? null : counts.get(k) || 0);
    if (state.timelineMode === 'total') {   // running total within the period
      let sum = 0;
      values.forEach((v, i) => { if (v != null) values[i] = sum += v; });
    }
    return { name: p.profile.name, slot: p.slot, values };
  });
  document.querySelectorAll('#timelineMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === state.timelineMode));
  const labelFor = (key, short) => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d || 1);
    if (unit === 'day') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric', weekday: 'short' }) });
    if (short && keys.length > 30) return String(y);
    const text = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return !short && key === keys.at(-1) && to >= nowSec() - 86400 ? `${text} (so far)` : text;
  };
  lineChart($('#timelineChart'), { keys, series, labelFor, isYearStart: unit === 'month' ? key => key.endsWith('-01') : null });
}

// Genres: tags of each person's top artists, fetched after the page draws.
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
  genres.forEach((g, i) => renderTags(i, g.shares.slice(0, 3).map(s => s.name)));
  renderGenreCompare(people, genres);
}

// ---------- Views

function showView() {
  const tab = state.view === 'artist' ? state.returnView : state.view;
  document.querySelectorAll('.view-tabs [data-view]').forEach(t => t.setAttribute('aria-selected', t.dataset.view === tab));
  $('#compareView').hidden = state.view !== 'compare';
  $('#reportView').hidden = state.view !== 'report';
  $('#artistView').hidden = state.view !== 'artist';
}

// The person shown in Reports.
function focusPerson() {
  const people = ready();
  return people.find(p => p.key === state.report.person) || people[0];
}

function renderPersonPicker(selector) {
  const person = focusPerson();
  $(selector).innerHTML = ready().map(p =>
    `<button type="button" data-person="${p.key}" aria-pressed="${p === person}"><span class="swatch" style="--color:var(--person-${p.slot})"></span>${esc(p.profile.name)}</button>`).join('');
}

function setView(next) {
  if (next !== 'artist') state.returnView = next;
  state.view = next;
  writeUrl();
  update();
}

function openArtist(name) {
  if (state.view !== 'artist') state.returnView = state.view;
  state.artist = name;
  setView('artist');
  scrollTo({ top: $('#results').offsetTop - 8 });
}

function currentReport() {
  const people = ready();
  const person = focusPerson();
  const now = nowSec();
  const period = periodFromKey(state.report.unit, state.report.key) || reportPeriod(state.report.unit, new Date(now * 1000));
  return { people, person, period, now };
}

function renderReportView() {
  const { people, person, period, now } = currentReport();
  if (!person) return;
  renderPersonPicker('#reportPerson');
  document.querySelectorAll('#reportUnit button').forEach(b => b.setAttribute('aria-pressed', b.dataset.unit === period.unit));
  const options = periodOptions(person, period.unit, now);
  if (!options.some(o => o.key === period.key)) options.unshift(period);
  $('#reportPeriodPicker').innerHTML = options.map(o => `<option value="${o.key}" ${o.key === period.key ? 'selected' : ''}>${periodLabel(o)}</option>`).join('');
  $('#periodNext').disabled = period.end / 1000 > now;
  $('#periodPrev').disabled = !person.rows.length || period.from <= person.rows[0][0];
  renderReport({ people, person, period, now, onOpenMonth: key => openReport({ unit: 'month', key }), onArtist: openArtist });
}

function openReport(changes) {
  Object.assign(state.report, changes);
  state.view = 'report';
  writeUrl();
  update();
  if (changes.unit === 'month' && changes.key) document.getElementById('rSummary').scrollIntoView();
}

// ---------- Events

$('#addForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#userInput');
  input.value.split(/[\s,]+/).forEach(addPerson);
  input.value = '';
  renderSaved();
});
$('#people').addEventListener('click', onPersonAction);
$('#savedPeople').addEventListener('click', event => {
  const chip = event.target.closest('[data-saved], [data-saved-all]');
  if (!chip) return;
  const names = chip.dataset.savedAll != null
    ? [...$('#savedPeople').querySelectorAll('[data-saved]')].map(c => c.dataset.saved)
    : [chip.dataset.saved];
  names.forEach(addPerson);
  renderSaved();
});

$('#kindPicker').addEventListener('click', event => {
  const kind = event.target.closest('[data-kind]')?.dataset.kind;
  if (!kind || kind === state.kind) return;
  state.kind = kind;
  state.sort = null;
  writeUrl();
  update();
});
$('#periodPicker').addEventListener('change', event => { state.period = event.target.value; writeUrl(); update(); });
$('#minPlaysPicker').addEventListener('change', event => { state.minPlays = +event.target.value; writeUrl(); update(); });
$('#sharedByPicker').addEventListener('change', event => { state.sharedBy = event.target.value; renderSharedView(); });
$('#sharedSearch').addEventListener('input', event => { state.search = event.target.value; renderSharedView(); });
$('#sharedTable').addEventListener('click', event => {
  const key = event.target.closest('[data-sort]')?.dataset.sort;
  if (!key) return;
  state.sort = state.sort === key ? null : key;
  renderSharedView();
});

document.querySelector('.view-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-view]');
  if (!tab || tab.dataset.view === state.view) return;
  setView(tab.dataset.view);
});
$('#saveImage').addEventListener('click', async event => {
  const shown = shownReport();
  if (!shown) return;
  const button = event.target;
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
$('#compatPerson').addEventListener('change', event => { state.compatWith = event.target.value; drawCompatibility(ready()); });
$('#pairA').addEventListener('change', event => {
  state.pairA = event.target.value;
  if (state.pairB === state.pairA) state.pairB = null;
  drawPair();
});
$('#pairB').addEventListener('change', event => {
  state.pairB = event.target.value;
  if (state.pairA === state.pairB) state.pairA = null;
  drawPair();
});
$('#timelineMode').addEventListener('click', event => {
  const mode = event.target.closest('[data-mode]')?.dataset.mode;
  if (!mode || mode === state.timelineMode) return;
  state.timelineMode = mode;
  drawTimeline();
});
$('#artistBack').addEventListener('click', () => setView(state.returnView));
// Artist names anywhere on the page open the artist page.
document.addEventListener('click', event => {
  const link = event.target.closest('[data-artist]');
  if (link) { event.preventDefault(); openArtist(link.dataset.artist); }
});
$('#reportPerson').addEventListener('click', event => {
  const key = event.target.closest('[data-person]')?.dataset.person;
  if (key) openReport({ person: key });
});
$('#reportUnit').addEventListener('click', event => {
  const unit = event.target.closest('[data-unit]')?.dataset.unit;
  if (!unit || unit === state.report.unit) return;
  // keep looking at roughly the same time: the new unit's period containing the old period's start
  openReport({ unit, key: reportPeriod(unit, currentReport().period.start).key });
});
$('#reportPeriodPicker').addEventListener('change', event => openReport({ key: event.target.value }));
$('#periodPrev').addEventListener('click', () => openReport({ key: shiftPeriod(currentReport().period, -1).key }));
$('#periodNext').addEventListener('click', () => openReport({ key: shiftPeriod(currentReport().period, 1).key }));

$('#clearSaved').addEventListener('click', () => $('#clearDialog').showModal());
$('#clearDialog').addEventListener('close', async () => {
  if ($('#clearDialog').returnValue !== 'clear') return;
  state.people.forEach(p => p.controller?.abort());
  await clearAll();
  location.reload();
});

// Redraw the timeline only when its width changes.
let chartWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0].contentRect.width;
  if (width && width !== chartWidth) { chartWidth = width; drawTimeline(); }
}).observe($('#timelineChart'));

enableSectionSnap('.section > h2, .section-head h2');
// A static waveform above the footer, drawn once (just decoration).
function drawWaveform() {
  const bars = Array.from({ length: 160 }, (_, i) => {
    const h = 0.18 + 0.82 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11) * Math.sin(i * 0.053 + 1));
    return `<i style="height:${Math.round(h * 100)}%"></i>`;
  });
  $('#waveform').innerHTML = bars.join('');
}
drawWaveform();

readUrl().slice(0, MAX_PEOPLE).forEach(addPerson);
renderSaved();
syncControls();
