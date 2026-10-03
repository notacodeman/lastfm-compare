// Small helpers shared by every file: DOM, number and date formats, and a few bits of markup.

export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- Formats

export const fmt = n => Math.round(n).toLocaleString('en-US');
export const pct = share => `${Math.round(share * 100)}%`;

const dateText = (uts, options) => uts == null ? '—' : new Date(uts * 1000).toLocaleDateString('en-US', options);
export const fmtDate = uts => dateText(uts, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtMonth = uts => dateText(uts, { year: 'numeric', month: 'short' });

// 'YYYY-MM' or 'YYYY-MM-DD' (local time) as a Date
export const keyDate = key => {
  const [y, m, d = 1] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SINGULAR = { artists: 'artist', albums: 'album', tracks: 'track' };
export const capitalize = s => s[0].toUpperCase() + s.slice(1);

// ---------- Markup

// People are coloured by their slot (--person-0 … --person-5); anything else passes a colour.
export const personColor = slot => `var(--person-${slot})`;
export const swatch = color => `<span class="swatch" style="--color:${typeof color === 'number' ? personColor(color) : color}"></span>`;

// Artist names open the artist page (one click listener in app.js handles them all).
export const artistLink = name =>
  `<button type="button" class="artist-link" data-artist="${esc(name)}">${esc(name)}</button>`;

// A list row: the item's name, its artist underneath for albums and tracks, then any extra line, and a value.
export function listRow(item, value, { sub = '', badge = false } = {}) {
  const name = item.artist ? esc(item.name) : artistLink(item.name);
  return `<li><div>
      <div class="item-name">${name}${badge ? ' <span class="badge">new</span>' : ''}</div>
      ${item.artist ? `<span class="item-sub">${artistLink(item.artist)}</span>` : ''}
      ${sub ? `<span class="item-sub">${sub}</span>` : ''}
    </div><span class="num">${value}</span></li>`;
}

// ---------- Behaviour

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// Caps a list at `rows` rows plus half the next one, so it's clear it scrolls, and never taller than
// 80% of the window. Rows can wrap, so it adds up their real heights. Refits only when the width changes.
const fitted = new WeakSet();
export function fitRows(box, rows) {
  const fit = () => {
    const items = box.children;
    if (items.length <= rows) { box.style.maxHeight = ''; return; }
    let height = items[rows].offsetHeight / 2;
    for (let i = 0; i < rows; i++) height += items[i].offsetHeight;
    box.style.maxHeight = `${Math.min(height, innerHeight * 0.8)}px`;
  };
  fit();
  if (fitted.has(box)) return;
  fitted.add(box);
  let width = box.clientWidth;
  new ResizeObserver(() => {
    if (box.clientWidth === width) return;
    width = box.clientWidth;
    fit();
  }).observe(box);
}

// Saves text or a blob as a file.
export function download(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
