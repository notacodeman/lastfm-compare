// Page state, events and the order things happen in. The maths is in analyze.js, the HTML in render.js.

import { $, nowSec } from './util.js';
import { MAX_PEOPLE, TAG_ARTISTS, DAILY_CHART_UP_TO_DAYS } from './config.js';
import { fetchProfile, fetchHistory, artistTags } from './history.js';
import { clearAll } from './store.js';
import { KINDS, periodRange, summarize, compare, overlap, perDay, countByBucket, bucketAxis, bucketKey, nameKey } from './analyze.js';
import { renderPeople, renderProgress, renderStats, renderTags, renderOverlap, renderShared, renderUnique, renderLegend } from './render.js';
import { lineChart } from './charts.js';
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
};
let view = null;      // the last comparison, reused when only the search or sort changes
let tagsRun = 0;      // bumps on every redraw so late tag answers for an old view are dropped

// ---------- URL state: ?u=name,name&k=artists&p=all&m=1

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (KINDS.includes(q.get('k'))) state.kind = q.get('k');
  if (q.get('p')) state.period = q.get('p');
  if (MIN_PLAYS.includes(q.get('m'))) state.minPlays = +q.get('m');
  return (q.get('u') || '').split(',').map(s => s.trim()).filter(Boolean);
}

function writeUrl() {
  const q = new URLSearchParams();
  if (state.people.length) q.set('u', state.people.map(p => p.profile?.name || p.username).join(','));
  if (state.kind !== 'artists') q.set('k', state.kind);
  if (state.period !== 'all') q.set('p', state.period);
  if (state.minPlays !== 1) q.set('m', state.minPlays);
  const search = q.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', search ? `?${search}` : location.pathname);
}

// ---------- People

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
    person.status = 'ready';
  } catch (err) {
    if (controller.signal.aborted) return;
    person.status = 'error';
    person.error = err.message;
  }
  renderPeople(state.people);
  update();
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
      download(person);
      return;
    case 'remove':
      person.controller?.abort();
      state.people.splice(state.people.indexOf(person), 1);
      writeUrl();
      update();
      break;
  }
  renderPeople(state.people);
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
  $('#results').hidden = people.length < 2;
  const waiting = $('#waitingNote');
  waiting.hidden = !loading.length || people.length < 2;
  waiting.textContent = `Still downloading: ${loading.join(', ')}. They'll be added when they finish.`;
  if (people.length < 2) { view = null; return; }

  fillPeriodPicker(people);
  syncControls();
  const now = nowSec();
  const range = periodRange(state.period, now);
  const summaries = people.map(p => summaryFor(p, range));
  const result = compare(summaries, state.kind, state.minPlays);
  const matrix = summaries.map(a => summaries.map(b => overlap(a, b, state.kind)));

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
  renderOverlap(people, result, matrix, state.kind);
  renderSharedView();
  renderUnique(people, result.unique, state.kind);
  renderLegend(people);
  drawTimeline();
  loadTags(people, summaries);
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
    return { name: p.profile.name, slot: p.slot, values: keys.map(k => k < started ? null : counts.get(k) || 0) };
  });
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

// Top tags: weighted by plays over each person's top artists. Fetched after the page draws.
async function loadTags(people, summaries) {
  const run = ++tagsRun;
  await Promise.all(people.map(async (person, i) => {
    const top = [...summaries[i].artists.values()].sort((a, b) => b.plays - a.plays).slice(0, TAG_ARTISTS);
    const scores = new Map();
    await Promise.all(top.map(async artist => {
      for (const tag of await artistTags(artist.name)) {
        scores.set(tag.name, (scores.get(tag.name) || 0) + artist.plays * (tag.count / 100));
      }
    }));
    if (run !== tagsRun) return;
    renderTags(i, [...scores].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name));
  }));
}

// ---------- Events

$('#addForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#userInput');
  input.value.split(/[\s,]+/).forEach(addPerson);
  input.value = '';
});
$('#people').addEventListener('click', onPersonAction);

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
readUrl().slice(0, MAX_PEOPLE).forEach(addPerson);
syncControls();
