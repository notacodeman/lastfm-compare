// The people cards under the username box, and the list of histories already saved in this browser.

import { $, esc, fmt, personColor } from './util.js';

const ICONS = {
  refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  remove: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

const button = (action, icon, label) =>
  `<button type="button" class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}"><svg viewBox="0 0 16 16">${ICONS[icon]}</svg></button>`;

const ACTIONS = {
  loading: button('pause', 'pause', 'Pause download'),
  paused: button('resume', 'refresh', 'Resume download'),
  error: button('resume', 'refresh', 'Try again'),
  ready: button('csv', 'download', 'Download scrobbles as CSV') + button('refresh', 'refresh', 'Fetch new scrobbles'),
};

export function renderPeople(people) {
  $('#people').innerHTML = people.map(person => {
    const name = person.profile?.name || person.username;
    // a little record: grooves round a label in the person's colour (their Last.fm picture if they have one)
    const label = person.profile?.image
      ? `<span class="label" style="background-image:url('${esc(person.profile.image)}')"></span>`
      : `<span class="label">${esc(name[0].toUpperCase())}</span>`;
    const link = person.profile ? `<a href="${esc(person.profile.url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);
    return `<li class="person" data-key="${esc(person.key)}" style="--color:${personColor(person.slot)}">
      <span class="avatar ${person.status === 'loading' ? 'spinning' : ''}" aria-hidden="true">${label}</span>
      <div>
        <div class="person-name">${link}</div>
        <div class="person-status ${person.status === 'error' ? 'error' : ''}">${esc(statusText(person))}</div>
      </div>
      <div class="person-actions">${ACTIONS[person.status]}${button('remove', 'remove', 'Remove')}</div>
      ${person.status === 'loading' ? `<div class="progress"><span style="width:${progressPercent(person)}%"></span></div>` : ''}
    </li>`;
  }).join('');
  // the record in the intro spins and the equalizer plays while anything downloads
  document.body.classList.toggle('busy', people.some(p => p.status === 'loading'));
}

// Updates one card's progress without rebuilding the list, so its buttons keep focus.
export function renderProgress(person) {
  const card = document.querySelector(`.person[data-key="${CSS.escape(person.key)}"]`);
  if (!card) return;
  card.querySelector('.person-status').textContent = statusText(person);
  const bar = card.querySelector('.progress span');
  if (bar) bar.style.width = `${progressPercent(person)}%`;
}

const progressPercent = ({ progress }) =>
  progress?.totalPages ? Math.round((progress.pagesDone / progress.totalPages) * 100) : 2;

function statusText({ status, progress: p, error, rows }) {
  switch (status) {
    case 'loading':
      if (p?.totalPages) return `Downloading page ${fmt(p.pagesDone)} of ${fmt(p.totalPages)} · ${fmt(p.scrobbles)} scrobbles`;
      return p?.scrobbles ? `Checking for new scrobbles… (${fmt(p.scrobbles)} saved)` : 'Looking up…';
    case 'paused': return `Paused at ${fmt(p?.scrobbles || 0)} scrobbles`;
    case 'error': return error;
    case 'ready': return `${fmt(rows.length)} scrobbles saved`;
    default: return '';
  }
}

// saved: from history.js savedPeople(); added: keys of people already on the page
export function renderSaved(saved, added) {
  const available = saved.filter(p => !added.has(p.key));
  const box = $('#savedPeople');
  box.hidden = !available.length;
  box.innerHTML = '<span class="control-label">Saved in this browser</span>'
    + available.map(p => `<button type="button" class="chip" data-saved="${esc(p.name)}">${esc(p.name)}`
      + `${p.scrobbles == null ? '' : `<small>${fmt(p.scrobbles)}</small>`}</button>`).join('')
    + (available.length > 1 ? '<button type="button" class="chip add-all" data-saved-all>Add all</button>' : '');
}
