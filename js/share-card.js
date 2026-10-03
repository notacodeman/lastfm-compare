// Draws a report as a shareable 1080 x 1350 PNG (the size Instagram and most chat apps show uncropped).

import { download, fmt } from './util.js';
import { periodLabel } from './report.js';

const W = 1080, H = 1350, PAD = 72;
const FONT = '"Albert Sans", system-ui, Arial, sans-serif';
const C = { bg: '#141414', panel: '#1c1c1b', ink: '#ffffff', text: '#e3e1db', muted: '#a3a29b', rule: 'rgba(255,255,255,.1)' };

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function write(ctx, text, x, y, { size, weight = 400, color = C.text, align = 'left', maxWidth = W - 2 * PAD }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fitText(ctx, String(text), maxWidth), x, y);
}

// report: from buildReport; genres: top genre names (may be empty)
export async function saveReportImage({ report, person, genres }) {
  await document.fonts?.ready;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  const accent = getComputedStyle(document.documentElement).getPropertyValue(`--person-${person.slot}`).trim() || '#3987e5';
  const s = report.summary, p = report.prevSummary;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 14);

  write(ctx, person.profile.name, PAD, 150, { size: 68, weight: 700, color: C.ink });
  write(ctx, `${periodLabel(report.period)}${report.ongoing ? ' so far' : ''}`, PAD, 210, { size: 40, color: C.muted });

  write(ctx, fmt(s.scrobbles), PAD, 350, { size: 150, weight: 700, color: C.ink });
  const diff = p.scrobbles ? Math.round(((s.scrobbles - p.scrobbles) / p.scrobbles) * 100) : null;
  const change = diff == null ? '' : diff === 0 ? ' · same as the period before' : ` · ${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}% on the period before`;
  write(ctx, `scrobbles${change}`, PAD, 430, { size: 34, color: C.muted });

  // four small numbers
  const stats = [['Artists', fmt(s.artists.size)], ['Albums', fmt(s.albums.size)], ['Tracks', fmt(s.tracks.size)], ['A day', report.perDay.toFixed(1)]];
  const colW = (W - 2 * PAD) / 4;
  stats.forEach(([label, value], i) => {
    const x = PAD + i * colW;
    write(ctx, value, x, 535, { size: 56, weight: 700, color: C.ink, maxWidth: colW - 16 });
    write(ctx, label, x, 580, { size: 28, color: C.muted, maxWidth: colW - 16 });
  });

  ctx.fillStyle = C.rule;
  ctx.fillRect(PAD, 625, W - 2 * PAD, 2);

  // top artists and tracks
  const half = (W - 2 * PAD - 40) / 2;
  const list = (title, items, x, sub) => {
    write(ctx, title, x, 690, { size: 30, weight: 700, color: accent, maxWidth: half });
    items.slice(0, 5).forEach((item, i) => {
      const y = 750 + i * 82;
      write(ctx, `${i + 1}`, x, y, { size: 30, color: C.muted });
      write(ctx, item.name, x + 44, y, { size: 32, weight: 600, color: C.ink, maxWidth: half - 44 });
      write(ctx, sub(item), x + 44, y + 36, { size: 24, color: C.muted, maxWidth: half - 44 });
    });
  };
  list('Top artists', report.top.artists, PAD, a => `${fmt(a.plays)} plays`);
  list('Top tracks', report.top.tracks, PAD + half + 40, t => `${t.artist} · ${fmt(t.plays)}`);

  // footer facts
  const facts = [
    genres.length ? `Top genres: ${genres.slice(0, 3).join(', ')}` : null,
    `${fmt(report.fresh.artists.items.length)} new artists · ${Math.round(report.consistency * 100)}% of days listened`,
  ].filter(Boolean);
  facts.forEach((text, i) => write(ctx, text, PAD, 1200 + i * 46, { size: 30, color: C.text }));
  write(ctx, 'lastfm.codeman.club', W - PAD, H - 44, { size: 24, color: C.muted, align: 'right' });

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  download(`${person.profile.name}-${report.period.key}.png`, blob);
}
