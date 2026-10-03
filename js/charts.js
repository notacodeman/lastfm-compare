// Hand-drawn SVG charts. Each one redraws itself when its container's width changes.
// People keep their own colour (--person-N) in every chart.

import { esc, fmt, personColor } from './util.js';

// ---------- Shared parts

// Redraw a chart when (and only when) its container's width changes.
const drawers = new WeakMap();
const resizeObserver = new ResizeObserver(entries => {
  for (const { target, contentRect } of entries) {
    const entry = drawers.get(target);
    const width = Math.round(contentRect.width);
    if (entry && width && width !== entry.width) { entry.width = width; entry.draw(); }
  }
});
function drawResponsive(container, draw) {
  if (!drawers.has(container)) resizeObserver.observe(container);
  drawers.set(container, { draw, width: Math.round(container.clientWidth) });
  if (container.clientWidth) draw();
}

function niceStep(rough) {
  const pow = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 2.5, 5, 10].map(m => m * pow).find(step => step >= rough);
}

// Gridlines and labels for a y axis from 0 to a round number at or above `max`.
function yAxis(max, y, left, right, format) {
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step || step;
  let svg = '';
  for (let v = 0; v <= top + step / 1000; v += step) {
    svg += `<line x1="${left}" x2="${right}" y1="${y(v, top)}" y2="${y(v, top)}"/>`
      + `<text x="${left - 8}" y="${y(v, top)}" text-anchor="end" dominant-baseline="middle">${format(v)}</text>`;
  }
  return { top, svg };
}
const fmtTick = v => v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmt(v);

// Puts a tooltip beside `rect` (a DOMRect), flipping to the left when it would run off the container.
function placeTooltip(tooltip, container, rect, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const box = container.getBoundingClientRect();
  const right = rect.right - box.left + 8;
  const fits = right + tooltip.offsetWidth <= box.width;
  tooltip.style.left = `${fits ? right : rect.left - box.left - tooltip.offsetWidth - 8}px`;
  tooltip.style.top = `${Math.max(0, rect.top - box.top - 10)}px`;
}

// A bar with rounded top corners, flat on the baseline.
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// SVG text can't cut itself off, so estimate the width (px per character) and add an ellipsis.
const clip = (text, width, perChar = 7.4) => {
  const chars = Math.floor(width / perChar);
  return text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text;
};

// ---------- Venn diagram for 2 or 3 people (fixed layout, not drawn to scale)

const VENN = {
  2: {
    viewBox: '0 0 380 230', r: 92,
    circles: [[140, 125], [240, 125]],
    names: [[110, 18], [270, 18]],
    labels: { 0b01: [95, 125], 0b10: [285, 125], 0b11: [190, 125] },   // region bitmask -> label position
  },
  3: {
    viewBox: '0 0 380 330', r: 88,
    circles: [[148, 125], [232, 125], [190, 198]],
    names: [[90, 20], [290, 20], [190, 318]],
    labels: { 0b001: [110, 105], 0b010: [270, 105], 0b100: [190, 240], 0b011: [190, 92], 0b101: [148, 178], 0b110: [232, 178], 0b111: [190, 150] },
  },
};

export function vennSvg(people, regions, noun) {
  const layout = VENN[people.length];
  const circles = layout.circles.map(([cx, cy], i) => {
    const color = personColor(people[i].slot);
    return `<circle cx="${cx}" cy="${cy}" r="${layout.r}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="2"/>`;
  }).join('');
  const names = layout.names.map(([x, y], i) => `<text class="venn-name" x="${x}" y="${y}">${esc(people[i].profile.name)}</text>`).join('');
  const labels = Object.entries(layout.labels).map(([mask, [x, y]]) => {
    const who = people.filter((_, i) => mask & (1 << i)).map(p => p.profile.name);
    const count = fmt(regions.get(+mask) || 0);
    const title = who.length === 1 ? `Only ${who[0]}` : who.length === 3 ? 'Everyone' : who.join(' and ');
    return `<text x="${x}" y="${y}"><title>${esc(title)}: ${count} ${noun}</title>${count}</text>`;
  }).join('');
  return `<svg class="venn" viewBox="${layout.viewBox}" role="img" aria-label="Who has which ${noun}">${circles}${names}${labels}</svg>`;
}

// For 4+ people, where a Venn stops being readable: how many items are shared by how many people.
export function sharedByBars(people, regions, noun) {
  const counts = people.map(() => 0);
  for (const [mask, count] of regions) {
    let holders = 0;
    for (let m = mask; m; m &= m - 1) holders++;
    counts[holders - 1] += count;
  }
  const max = Math.max(1, ...counts);
  const label = k => k === 1 ? 'Only one person' : k === people.length ? 'Everyone' : `${k} people`;
  const rows = counts.map((count, i) => `<div class="bar-row"><span>${label(i + 1)}</span>
    <div class="bar">${count ? `<span style="width:${(count / max) * 100}%"></span>` : ''}</div>
    <span class="value">${fmt(count)}</span></div>`).reverse().join('');
  return `<h3>How many of you have each of the ${noun}</h3><div class="bar-rows">${rows}</div>`;
}

// ---------- Line chart: a line per series, crosshair tooltip, and labels for each line's peak and latest value

const LINE_HEIGHT = 270;
const LINE_MARGIN = { top: 12, right: 14, bottom: 28, left: 52 };

// series: [{ name, slot or color, values }], null values = no line there (e.g. before someone started).
// keys: one per point; labelFor(key, short) gives axis (short) and tooltip text.
// isYearStart(key): on long monthly charts, label years and draw a line at each January.
export function lineChart(container, { keys, series, labelFor, isYearStart, format = fmt, showTotal = true, max }) {
  drawResponsive(container, () => drawLines(container, { keys, series, labelFor, isYearStart, format, showTotal, max }));
}

function drawLines(container, { keys, series, labelFor, isYearStart, format, showTotal, max: fixedMax }) {
  const stroke = s => s.color || personColor(s.slot);
  const labelled = series.length <= 4;   // more lines than that and the labels collide
  const width = container.clientWidth;
  const m = { ...LINE_MARGIN, right: labelled ? 62 : LINE_MARGIN.right };
  const plotW = width - m.left - m.right, plotH = LINE_HEIGHT - m.top - m.bottom;
  const values = series.flatMap(s => s.values).filter(v => v != null);
  const axis = yAxis(fixedMax ?? Math.max(1, ...values) * (labelled ? 1.12 : 1), (v, top) => m.top + plotH - (v / top) * plotH, m.left, width - m.right, format);
  const x = i => m.left + (keys.length === 1 ? plotW / 2 : (i / (keys.length - 1)) * plotW);
  const y = v => m.top + plotH - (v / axis.top) * plotH;

  // x labels: a year at each January on long monthly charts (skipping years that would crowd), else evenly spaced
  let xLabels = '', yearLines = '';
  const label = i => { xLabels += `<text x="${x(i)}" y="${LINE_HEIGHT - 8}" text-anchor="middle">${esc(labelFor(keys[i], true))}</text>`; };
  if (isYearStart && keys.length > 30) {
    const yearStep = Math.max(1, Math.ceil(50 / (plotW / (keys.length / 12))));
    keys.forEach((key, i) => {
      if (!isYearStart(key)) return;
      yearLines += `<line x1="${x(i)}" x2="${x(i)}" y1="${m.top}" y2="${m.top + plotH}"/>`;
      if (+key.slice(0, 4) % yearStep === 0) label(i);
    });
  } else {
    const every = Math.max(1, Math.ceil(keys.length / (plotW / 70)));
    keys.forEach((_, i) => { if (i % every === 0) label(i); });
  }

  const lines = series.map(s => {
    let d = '', pen = 'M';
    s.values.forEach((v, i) => {
      if (v == null) { pen = 'M'; return; }
      d += `${pen}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = 'L';
    });
    return `<path class="series" d="${d}" stroke="${stroke(s)}"/>`;
  }).join('');

  const details = labelled ? lineDetails({ series, values, keys, labelFor, format, stroke, x, y, m, width, plotW }) : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${LINE_HEIGHT}" height="${LINE_HEIGHT}" role="img">
      <g class="grid axis">${axis.svg}${yearLines}</g>
      <g class="axis">${xLabels}</g>
      ${lines}${details}
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${m.top}" y2="${m.top + plotH}"/>
        ${series.map(s => `<circle r="4.5" fill="${stroke(s)}" stroke="var(--panel)" stroke-width="2"/>`).join('')}
      </g>
      <rect class="hit" x="${m.left - 6}" y="0" width="${plotW + 12}" height="${LINE_HEIGHT}" fill="transparent"/>
    </svg>
    <div class="tooltip" hidden></div>`;

  const svg = container.querySelector('svg');
  const hover = svg.querySelector('.hover');
  const dots = hover.querySelectorAll('circle');
  const tooltip = container.querySelector('.tooltip');
  const show = event => {
    const box = svg.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    const i = Math.max(0, Math.min(keys.length - 1, Math.round(((px - m.left) / plotW) * (keys.length - 1))));
    hover.querySelector('line').setAttribute('x1', x(i));
    hover.querySelector('line').setAttribute('x2', x(i));
    series.forEach((s, n) => {
      dots[n].setAttribute('visibility', s.values[i] == null ? 'hidden' : 'inherit');
      dots[n].setAttribute('cx', x(i));
      dots[n].setAttribute('cy', y(s.values[i] ?? 0));
    });
    hover.setAttribute('visibility', 'visible');
    const total = series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    const rows = series.map(s => `<div><span><span class="swatch" style="--color:${stroke(s)}"></span>${esc(s.name)}</span>`
      + `<span>${s.values[i] == null ? '–' : format(s.values[i])}</span></div>`).join('');
    const scale = box.width / width;
    const at = new DOMRect(box.left + x(i) * scale, box.top + m.top, 0, 0);
    placeTooltip(tooltip, container, at, `<b>${esc(labelFor(keys[i], false))}</b>${rows}`
      + (showTotal ? `<div class="total"><span>Total</span><span>${format(total)}</span></div>` : ''));
  };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tooltip.hidden = true; });
}

// Each line's peak, each line's latest value at the right edge, and an average when there's one line.
function lineDetails({ series, values, keys, labelFor, format, stroke, x, y, m, width, plotW }) {
  let svg = '';
  const placed = [];
  for (const s of series) {
    let peak = -1;
    s.values.forEach((v, i) => { if (v != null && (peak < 0 || v > s.values[peak])) peak = i; });
    if (peak < 0 || !s.values[peak]) continue;
    const px = x(peak), py = y(s.values[peak]);
    let ly = py - 9;
    while (placed.some(p => Math.abs(p.x - px) < 110 && Math.abs(p.y - ly) < 13)) ly -= 13;   // stack labels that would collide
    placed.push({ x: px, y: ly });
    const anchor = px > m.left + plotW - 60 ? 'end' : px < m.left + 60 ? 'start' : 'middle';
    const who = series.length > 1 ? `${esc(s.name)} ` : '';
    svg += `<circle class="peak" cx="${px}" cy="${py}" r="3.5" fill="${stroke(s)}"/>`
      + `<text class="mark-label" x="${px}" y="${Math.max(10, ly)}" text-anchor="${anchor}">${who}peak ${format(s.values[peak])} · ${esc(labelFor(keys[peak], false))}</text>`;
  }

  const ends = series.map(s => {
    const i = s.values.findLastIndex(v => v != null);
    return i < 0 ? null : { s, value: s.values[i], y: y(s.values[i]) };
  }).filter(Boolean).sort((p, q) => p.y - q.y);
  ends.forEach((e, n) => { if (n) e.y = Math.max(e.y, ends[n - 1].y + 13); });   // keep them apart
  svg += ends.map(e => `<text class="end-value" x="${width - m.right + 8}" y="${e.y}" dominant-baseline="middle">`
    + `<tspan fill="${stroke(e.s)}">●</tspan> ${format(e.value)}</text>`).join('');

  if (series.length === 1 && values.length > 2) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    svg += `<line class="average" x1="${m.left}" x2="${width - m.right}" y1="${y(avg)}" y2="${y(avg)}"/>`
      + `<text class="mark-label" x="${m.left + 6}" y="${y(avg) - 5}">average ${format(avg)}</text>`;
  }
  return svg;
}

// ---------- Column charts (one bar per bucket) and 100% stacked columns

const COLUMN_MARGIN = { top: 10, right: 8, bottom: 26, left: 44 };

// The parts both column charts share: bands, x labels, a hover highlight and a tooltip per band.
function columnFrame(container, { count, labels, height, minLabelGap }) {
  const width = container.clientWidth;
  const m = COLUMN_MARGIN;
  const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
  const band = plotW / count;
  const bands = Array.from({ length: count }, (_, i) => ({ x: m.left + i * band, w: band }));
  const every = Math.max(1, Math.ceil(minLabelGap / band));
  const xLabels = labels.map((label, i) => i % every || !label ? ''
    : `<text x="${bands[i].x + band / 2}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`).join('');
  const hits = bands.map(b => `<rect class="band" x="${b.x}" y="0" width="${b.w}" height="${height}" fill="transparent"/>`).join('');
  return { width, m, plotW, plotH, band, bands, xLabels, hits };
}

function attachBandTooltip(container, bands, html) {
  const svg = container.querySelector('svg');
  const tooltip = container.querySelector('.tooltip');
  const highlight = svg.querySelector('.band-highlight');
  svg.querySelectorAll('.band').forEach((band, i) => {
    const show = () => {
      highlight.setAttribute('x', bands[i].x);
      highlight.setAttribute('width', bands[i].w);
      highlight.setAttribute('visibility', 'visible');
      const rect = band.getBoundingClientRect();
      placeTooltip(tooltip, container, new DOMRect(rect.left, rect.top + 18, rect.width, 0), html(i));
    };
    band.addEventListener('pointerenter', show);
    band.addEventListener('pointerdown', show);
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; highlight.setAttribute('visibility', 'hidden'); });
}

// values: a number per bucket; previous: the period before's value per bucket (or null), drawn as a tick.
// Also draws a dashed average (pass `average` when not every bucket counts, e.g. days still to come),
// and each bar's value on top when bars are wide enough.
export function columnChart(container, options) {
  const { labels, values, previous = [], slot, tooltip, height = 230, minLabelGap = 30 } = options;
  const avg = options.average ?? values.reduce((a, b) => a + b, 0) / (values.length || 1);
  drawResponsive(container, () => {
    const f = columnFrame(container, { count: values.length, labels, height, minLabelGap });
    const max = Math.max(1, ...values, ...previous.filter(v => v != null)) * 1.1;   // room for value labels
    const y = (v, top) => f.m.top + f.plotH - (v / top) * f.plotH;
    const axis = yAxis(max, y, f.m.left, f.width - f.m.right, fmtTick);
    const barW = Math.max(2, Math.min(f.band - 2, f.band * 0.72));
    const barX = i => f.bands[i].x + (f.band - barW) / 2;

    const bars = values.map((v, i) => barPath(barX(i), y(v, axis.top), barW, y(0, axis.top) - y(v, axis.top))).join('');
    const ticks = previous.map((v, i) => v == null ? ''
      : `<line class="previous" x1="${barX(i) - 1}" x2="${barX(i) + barW + 1}" y1="${y(v, axis.top)}" y2="${y(v, axis.top)}"/>`).join('');
    const average = avg > 0 ? `<line class="average" x1="${f.m.left}" x2="${f.width - f.m.right}" y1="${y(avg, axis.top)}" y2="${y(avg, axis.top)}"/>`
      + `<text class="mark-label" x="${f.width - f.m.right}" y="${y(avg, axis.top) - 5}" text-anchor="end">average ${avg >= 10 ? fmt(avg) : avg.toFixed(1)}</text>` : '';
    const valueLabels = barW < 22 ? '' : values.map((v, i) => v
      ? `<text class="bar-value" x="${f.bands[i].x + f.band / 2}" y="${y(v, axis.top) - 5}" text-anchor="middle">${fmtTick(v)}</text>` : '').join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${f.width} ${height}" height="${height}" role="img">
        <g class="grid axis">${axis.svg}</g>
        <rect class="band-highlight" y="${f.m.top}" height="${f.plotH}" visibility="hidden"/>
        <path d="${bars}" fill="${personColor(slot)}"/>
        ${ticks}${average}${valueLabels}
        <g class="axis">${f.xLabels}</g>
        ${f.hits}
      </svg>
      <div class="tooltip" hidden></div>`;
    attachBandTooltip(container, f.bands, tooltip);
  });
}

// series: [{ name, color, values: shares 0..1 }], stacked bottom-up in order. Shares are written inside
// segments big enough to hold them.
export function stackedShareChart(container, { labels, series, tooltip, height = 260 }) {
  drawResponsive(container, () => {
    const f = columnFrame(container, { count: labels.length, labels, height, minLabelGap: 34 });
    const y = v => f.m.top + f.plotH - v * f.plotH;
    const barW = Math.max(4, Math.min(f.band - 4, f.band * 0.7));
    const GAP = 2;   // surface-coloured gap between segments
    const below = labels.map(() => 0);
    const segments = series.map(s => `<g fill="${s.color}">${labels.map((_, i) => {
      const share = s.values[i] || 0;
      const top = y(below[i] + share) + GAP / 2, h = share * f.plotH - GAP;
      below[i] += share;
      if (h <= 0) return '';
      const x = f.bands[i].x + (f.band - barW) / 2;
      const text = h >= 16 && barW >= 28
        ? `<text class="segment-value" x="${x + barW / 2}" y="${top + h / 2}" text-anchor="middle" dominant-baseline="middle">${Math.round(share * 100)}</text>` : '';
      return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" rx="2"/>${text}`;
    }).join('')}</g>`).join('');
    const grid = [0, 0.25, 0.5, 0.75, 1].map(v => `<line x1="${f.m.left}" x2="${f.width - f.m.right}" y1="${y(v)}" y2="${y(v)}"/>`
      + `<text x="${f.m.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v * 100}%</text>`).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${f.width} ${height}" height="${height}" role="img">
        <g class="grid axis">${grid}</g>
        <rect class="band-highlight" y="${f.m.top}" height="${f.plotH}" visibility="hidden"/>
        ${segments}
        <g class="axis">${f.xLabels}</g>
        ${f.hits}
      </svg>
      <div class="tooltip" hidden></div>`;
    attachBandTooltip(container, f.bands, tooltip);
  });
}

// ---------- Rank comparison: a's top list on the left, b's on the right, lines joining what's on both
// The names sit above the scroll box, so they stay put while the rows scroll.

const SLOPE_ROW = 24;

export function slopeChart(container, { left, right, a, b, visibleRows, onPick }) {
  drawResponsive(container, () => {
    const scrolled = container.querySelector('.slope-scroll')?.scrollTop || 0;   // keep the place on redraws
    const width = container.clientWidth;
    const height = Math.max(left.length, right.length) * SLOPE_ROW + 4;
    const col = Math.min(250, Math.max(130, width * 0.36));
    const y = i => i * SLOPE_ROW + SLOPE_ROW / 2;
    const rightRow = new Map(right.map((item, i) => [item.key, i]));
    const leftKeys = new Set(left.map(item => item.key));

    const lines = left.map((item, i) => !rightRow.has(item.key) ? ''
      : `<line class="link" data-key="${esc(item.key)}" x1="${col + 6}" y1="${y(i)}" x2="${width - col - 6}" y2="${y(rightRow.get(item.key))}"/>`).join('');
    const label = (item, i, isLeft) => {
      const [owner, other] = isLeft ? [a, b] : [b, a];
      // not on the other list: show where it ranks for the other person instead of a line
      const onOther = isLeft ? rightRow.has(item.key) : leftKeys.has(item.key);
      const where = onOther ? '' : item.otherRank ? `#${item.otherRank}` : '–';
      const name = clip(item.name, col - 34 - (where ? where.length * 6.5 + 4 : 0), 7.6);
      const title = `${item.name}${item.artist ? ` – ${item.artist}` : ''}: ${fmt(item.plays)} plays, #${item.rank} for ${owner.profile.name}, `
        + `${item.otherRank ? `#${item.otherRank}` : 'not played'} for ${other.profile.name}`;
      const rank = isLeft ? `<text class="rank" x="4" y="${y(i)}">${item.rank}</text>`
        : `<text class="rank" x="${width - 4}" y="${y(i)}" text-anchor="end">${item.rank}</text>`;
      return `${rank}<text class="item" data-key="${esc(item.key)}" x="${isLeft ? col : width - col}" y="${y(i)}" text-anchor="${isLeft ? 'end' : 'start'}">`
        + `${esc(name)}${where ? ` <tspan class="off">${where}</tspan>` : ''}<title>${esc(title)}</title></text>`;
    };

    container.innerHTML = `
      <div class="slope-head" style="--col:${col}px">
        <span style="color:${personColor(a.slot)}">${esc(a.profile.name)}</span>
        <span style="color:${personColor(b.slot)}">${esc(b.profile.name)}</span>
      </div>
      <div class="slope-scroll">
        <svg class="slope" viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Top lists side by side">
          ${lines}
          ${left.map((item, i) => label(item, i, true)).join('')}
          ${right.map((item, i) => label(item, i, false)).join('')}
        </svg>
      </div>`;

    const box = container.querySelector('.slope-scroll');
    const rows = Math.max(left.length, right.length);
    box.style.maxHeight = rows > visibleRows ? `${Math.min(SLOPE_ROW * (visibleRows + 0.5), innerHeight * 0.8)}px` : '';
    box.scrollTop = scrolled;
    const svg = box.querySelector('svg');
    const highlight = key => svg.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('lit', !!key && el.dataset.key === key));
    svg.addEventListener('pointerover', e => highlight(e.target.closest('[data-key]')?.dataset.key));
    svg.addEventListener('pointerleave', () => highlight(null));
    svg.addEventListener('click', e => {
      const key = e.target.closest('.item')?.dataset.key;
      const item = key && [...left, ...right].find(i => i.key === key);
      if (item) onPick(item);
    });
  });
}

// ---------- Bump chart: the top artists' rank in each month; point at one to follow it

const BUMP_ROW = 26;

// series: [{ name, plays, ranks: [rank or null per month], monthPlays }]
export function bumpChart(container, { series, labels, longLabels, depth, slot, onPick }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const side = Math.min(170, width * 0.24);   // room for names at both ends
    const m = { top: 14, bottom: 26 };
    const height = m.top + depth * BUMP_ROW + m.bottom;
    const plotW = width - 2 * side;
    const x = i => side + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
    const y = rank => m.top + (rank - 0.5) * BUMP_ROW;
    const name = s => esc(clip(s.name, side - 40, 7));

    const grid = Array.from({ length: depth }, (_, r) => `<line x1="${side}" x2="${width - side}" y1="${y(r + 1)}" y2="${y(r + 1)}"/>`).join('');
    const months = labels.map((l, i) => `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const groups = series.map((s, n) => {
      let d = '', pen = 'M';
      s.ranks.forEach((r, i) => {
        if (r == null) { pen = 'M'; return; }
        d += `${pen}${x(i).toFixed(1)},${y(r).toFixed(1)}`;
        pen = 'L';
      });
      const dots = s.ranks.map((r, i) => r == null ? ''
        : `<circle cx="${x(i)}" cy="${y(r)}" r="4" data-tip="<b>${esc(s.name)}</b>${esc(longLabels[i])}: #${r}, ${fmt(s.monthPlays[i])} plays`
          + `<br><span class='muted'>${fmt(s.plays)} plays over the ${labels.length} months</span>"/>`).join('');
      const last = s.ranks.length - 1;
      const ends = (s.ranks[0] != null ? `<text class="end-label" x="${x(0) - 10}" y="${y(s.ranks[0])}" text-anchor="end" dominant-baseline="middle">${name(s)} #${s.ranks[0]}</text>` : '')
        + (s.ranks[last] != null ? `<text class="end-label" x="${x(last) + 10}" y="${y(s.ranks[last])}" dominant-baseline="middle">#${s.ranks[last]} ${name(s)}</text>` : '');
      return `<g class="bump" data-n="${n}">${d ? `<path d="${d}"/>` : ''}${dots}${ends}</g>`;
    }).join('');

    container.innerHTML = `
      <svg class="bump-chart" viewBox="0 0 ${width} ${height}" height="${height}" style="--hi:${personColor(slot)}" role="img" aria-label="Rank of the top artists each month">
        <g class="grid">${grid}</g><g class="axis">${months}</g>${groups}
      </svg>
      <div class="tooltip" hidden></div>`;

    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.tooltip');
    const highlight = n => svg.querySelectorAll('.bump').forEach(g => g.classList.toggle('lit', g.dataset.n === n));
    svg.addEventListener('pointerover', e => {
      highlight(e.target.closest('.bump')?.dataset.n);
      const dot = e.target.closest('[data-tip]');
      if (dot) placeTooltip(tooltip, container, dot.getBoundingClientRect(), dot.dataset.tip);
      else tooltip.hidden = true;
    });
    svg.addEventListener('pointerleave', () => { highlight(null); tooltip.hidden = true; });
    svg.addEventListener('click', e => {
      const group = e.target.closest('.bump');
      if (group) onPick(series[+group.dataset.n]);
    });
  });
}
