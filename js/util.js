// Small helpers shared by every file.

export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = n => Math.round(n).toLocaleString('en-US');

export const fmtDate = uts => uts == null ? '—'
  : new Date(uts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export const fmtMonth = uts => uts == null ? '—'
  : new Date(uts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

export const nowSec = () => Math.floor(Date.now() / 1000);

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// Cap a list's height at `rows` rows plus half the next one, so it's clear it scrolls.
// Expects the box to hold only the rows (no padding).
// Refits only when the box width changes (rows re-wrap), and never taller than 80% of the window.
const fitted = new WeakMap();
export function fitRows(box, rows) {
  const fit = () => {
    const items = box.children;
    if (items.length <= rows) { box.style.maxHeight = ''; return; }
    let height = items[rows].offsetHeight / 2;   // rows can wrap to two lines, so add up the real heights
    for (let i = 0; i < rows; i++) height += items[i].offsetHeight;
    box.style.maxHeight = `${Math.min(height, window.innerHeight * 0.8)}px`;
  };
  fit();
  if (fitted.has(box)) return;
  let lastWidth = box.clientWidth;
  const observer = new ResizeObserver(() => {
    if (box.clientWidth === lastWidth) return;
    lastWidth = box.clientWidth;
    fit();
  });
  observer.observe(box);
  fitted.set(box, observer);
}

// An artist name that opens the artist page (handled by one click listener in app.js).
export const artistLink = name => `<button type="button" class="artist-link" data-artist="${esc(name)}">${esc(name)}</button>`;

// Save text or a blob as a file.
export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
