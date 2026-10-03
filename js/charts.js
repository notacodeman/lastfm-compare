// Hand-drawn SVG charts: the Venn diagram, the overlap matrix, "shared by how many" bars and the timeline.
// People always keep their own colour (--person-N), whatever else is on screen.

import { esc, fmt } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';
const color = slot => `var(--person-${slot})`;

// ---------- Venn (2 or 3 people). Circles are a fixed layout, not sized to the counts.

const VENN_LAYOUTS = {
  2: {
    viewBox: '0 0 380 230',
    circles: [[140, 125], [240, 125]], r: 92,
    names: [[110, 18], [270, 18]],
    // region bitmask -> label position
    labels: { 0b01: [95, 125], 0b10: [285, 125], 0b11: [190, 125] },
  },
  3: {
    viewBox: '0 0 380 330',
    circles: [[148, 125], [232, 125], [190, 198]], r: 88,
    names: [[90, 20], [290, 20], [190, 318]],
    labels: { 0b001: [110, 105], 0b010: [270, 105], 0b100: [190, 240], 0b011: [190, 92], 0b101: [148, 178], 0b110: [232, 178], 0b111: [190, 150] },
  },
};

export function vennSvg(people, regions, noun) {
  const layout = VENN_LAYOUTS[people.length];
  const circles = layout.circles.map(([cx, cy], i) =>
    `<circle cx="${cx}" cy="${cy}" r="${layout.r}" fill="${color(people[i].slot)}" fill-opacity=".16" stroke="${color(people[i].slot)}" stroke-width="2"/>`).join('');
  const names = layout.names.map(([x, y], i) =>
    `<text class="venn-name" x="${x}" y="${y}">${esc(people[i].profile.name)}</text>`).join('');
  const labels = Object.entries(layout.labels).map(([mask, [x, y]]) => {
    const who = people.filter((_, i) => mask & (1 << i)).map(p => p.profile.name);
    const count = regions.get(+mask) || 0;
    const title = who.length === 1 ? `Only ${who[0]}` : who.length === people.length && people.length > 2 ? 'Everyone' : who.join(' and ');
    return `<text x="${x}" y="${y}"><title>${esc(title)}: ${fmt(count)} ${noun}</title>${fmt(count)}</text>`;
  }).join('');
  return `<svg class="venn" viewBox="${layout.viewBox}" role="img" aria-label="Venn diagram of ${noun} each person has">${circles}${names}${labels}</svg>`;
}

// ---------- "Shared by how many people" bars (4+ people, where a Venn stops being readable)

export function sharedByBars(people, regions, noun) {
  const counts = people.map(() => 0);
  for (const [mask, count] of regions) {
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    counts[bits - 1] += count;
  }
  const max = Math.max(1, ...counts);
  const label = k => k === 1 ? 'Only one person' : k === people.length ? 'Everyone' : `${k} people`;
  const rows = counts.map((count, i) => `
    <div class="bar-row"><span>${label(i + 1)}</span>
     <div class="bar">${count ? `<span style="width:${(count / max) * 100}%"></span>` : ""}</div>
     <span class="value">${fmt(count)}</span></div>`).reverse().join('');
  return `<h3>How many of you have each of the ${noun}</h3><div class="bar-rows">${rows}</div>`;
}

// ---------- Pairwise overlap matrix (3+ people). Neutral shading so it never reads as one person's colour.

export function overlapMatrix(people, matrix) {
  const max = Math.max(0.01, ...matrix.flatMap((row, i) => row.filter((_, j) => j !== i)));
  const head = people.map(p => `<th scope="col"><span class="swatch" style="--color:${color(p.slot)}"></span>${esc(p.profile.name)}</th>`).join('');
  const body = people.map((p, i) => `<tr><th scope="row">${esc(p.profile.name)}<span class="swatch" style="--color:${color(p.slot)};margin:0 0 0 6px"></span></th>${
    matrix[i].map((value, j) => i === j ? '<td class="self">—</td>'
      : `<td style="background:color-mix(in oklab, #ffffff ${Math.round(4 + 26 * value / max)}%, var(--panel2))" title="${esc(p.profile.name)} and ${esc(people[j].profile.name)}: ${Math.round(value * 100)}% overlap">${Math.round(value * 100)}%</td>`).join('')
  }</tr>`).join('');
  return `<div class="hscroll"><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Timeline: one line per person, with a crosshair tooltip listing everyone and the total

const MARGIN = { top: 12, right: 14, bottom: 28, left: 52 };
const HEIGHT = 270;

function niceStep(rough) {
  const pow = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 2.5, 5, 10].map(m => m * pow).find(step => step >= rough);
}

// series: [{ name, slot, values }] where null means "not scrobbling yet" (no line drawn),
// keys: bucket keys, labelFor(key, short) -> text
// Options: format(value) for axis and tooltip numbers, showTotal (default true), max (fixed top of the axis).
// A series can set `color` instead of a person `slot`.
export function lineChart(container, { keys, series, labelFor, isYearStart, format = fmt, showTotal = true, max: fixedMax }) {
  const stroke = s => s.color || color(s.slot);
  const width = container.clientWidth;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = fixedMax ?? Math.max(1, ...series.flatMap(s => s.values).filter(v => v != null));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = i => MARGIN.left + (keys.length === 1 ? plotW / 2 : (i / (keys.length - 1)) * plotW);
  const y = v => MARGIN.top + plotH - (v / top) * plotH;

  const grid = [];
  for (let v = 0; v <= top + step / 1000; v += step) {
    grid.push(`<line x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y(v)}" y2="${y(v)}"/>`);
    grid.push(`<text x="${MARGIN.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${format(v)}</text>`);
  }

  // x labels: on long monthly charts, a year at each January (skipping years if they'd crowd);
  // otherwise evenly spaced, at least ~70px apart
  const xLabels = [];
  const label = i => xLabels.push(`<text x="${x(i)}" y="${HEIGHT - 8}" text-anchor="middle">${esc(labelFor(keys[i], true))}</text>`);
  if (isYearStart && keys.length > 30) {
    const pxPerYear = plotW / (keys.length / 12);
    const yearStep = Math.max(1, Math.ceil(50 / pxPerYear));
    keys.forEach((key, i) => { if (isYearStart(key) && +key.slice(0, 4) % yearStep === 0) label(i); });
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

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${HEIGHT}" height="${HEIGHT}" role="img" aria-label="Scrobbles over time">
      <g class="grid axis">${grid.join('')}</g>
      <g class="axis">${xLabels.join('')}</g>
      ${lines}
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}"/>
        ${series.map(s => `<circle r="4.5" fill="${stroke(s)}" stroke="var(--panel)" stroke-width="2"/>`).join('')}
      </g>
      <rect class="hit" x="${MARGIN.left - 6}" y="0" width="${plotW + 12}" height="${HEIGHT}" fill="transparent"/>
    </svg>
    <div class="tooltip" hidden></div>`;

  const svg = container.querySelector('svg');
  const hover = svg.querySelector('.hover');
  const crosshair = hover.querySelector('line');
  const dots = hover.querySelectorAll('circle');
  const tooltip = container.querySelector('.tooltip');

  const show = event => {
    const box = svg.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    const i = Math.max(0, Math.min(keys.length - 1, Math.round(((px - MARGIN.left) / plotW) * (keys.length - 1))));
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    series.forEach((s, n) => {
      dots[n].setAttribute('visibility', s.values[i] == null ? 'hidden' : 'inherit');
      dots[n].setAttribute('cx', x(i));
      dots[n].setAttribute('cy', y(s.values[i] ?? 0));
    });
    hover.setAttribute('visibility', 'visible');

    const total = series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    tooltip.innerHTML = `<b>${esc(labelFor(keys[i], false))}</b>${
      series.map(s => `<div><span><span class="swatch" style="--color:${stroke(s)}"></span>${esc(s.name)}</span><span>${s.values[i] == null ? '–' : format(s.values[i])}</span></div>`).join('')
    }${showTotal ? `<div class="total"><span>Total</span><span>${format(total)}</span></div>` : ''}`;
    tooltip.hidden = false;
    const left = (x(i) / width) * box.width;
    const flip = left + tooltip.offsetWidth + 16 > box.width;
    tooltip.style.left = `${flip ? left - tooltip.offsetWidth - 12 : left + 12}px`;
    tooltip.style.top = `${MARGIN.top}px`;
  };
  const hide = () => { hover.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// ---------- Shared bits for the column charts below

// Redraw a chart when (and only when) its container's width changes.
const drawers = new WeakMap();
const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const item = drawers.get(entry.target);
    const width = Math.round(entry.contentRect.width);
    if (item && width && width !== item.width) { item.width = width; item.draw(); }
  }
});
export function drawResponsive(container, draw) {
  const known = drawers.get(container);
  drawers.set(container, { draw, width: known?.width || 0 });
  if (!known) resizeObserver.observe(container);
  if (container.clientWidth) { drawers.get(container).width = Math.round(container.clientWidth); draw(); }
}

function yAxis(max, y, left, right) {
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step || step;
  const lines = [];
  for (let v = 0; v <= top + 1e-9; v += step) lines.push(v);
  return { top, svg: lines.map(v => `<line x1="${left}" x2="${right}" y1="${y(v, top)}" y2="${y(v, top)}"/><text x="${left - 8}" y="${y(v, top)}" text-anchor="end" dominant-baseline="middle">${fmtTick(v)}</text>`).join('') };
}
const fmtTick = v => v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmt(v);

// A bar whose top corners are rounded, anchored flat on the baseline.
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function attachTooltip(container, svg, bands, html) {
  const tooltip = container.querySelector('.tooltip');
  const highlight = svg.querySelector('.band-highlight');
  svg.querySelectorAll('.band').forEach((band, i) => {
    const show = () => {
      highlight.setAttribute('x', bands[i].x);
      highlight.setAttribute('width', bands[i].w);
      highlight.setAttribute('visibility', 'visible');
      tooltip.innerHTML = html(i);
      tooltip.hidden = false;
      const box = svg.getBoundingClientRect();
      const scale = box.width / svg.viewBox.baseVal.width;
      const left = (bands[i].x + bands[i].w) * scale;
      const flip = left + tooltip.offsetWidth + 12 > box.width;
      tooltip.style.left = `${flip ? bands[i].x * scale - tooltip.offsetWidth - 8 : left + 8}px`;
      tooltip.style.top = '8px';
    };
    band.addEventListener('pointerenter', show);
    band.addEventListener('pointerdown', show);
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; highlight.setAttribute('visibility', 'hidden'); });
}

function xLabels(labels, bands, height, minGap) {
  const every = Math.max(1, Math.ceil(minGap / (bands[0]?.w || minGap)));
  return labels.map((label, i) => i % every ? '' :
    `<text x="${bands[i].x + bands[i].w / 2}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`).join('');
}

// ---------- Columns: one value per bucket, with an optional previous-period marker on each

// values: numbers; previous: numbers or null per bucket; slot: the person's colour
export function columnChart(container, { labels, values, previous, slot, tooltip, height = 230, minLabelGap = 30 }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const m = { top: 10, right: 8, bottom: 26, left: 44 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const max = Math.max(1, ...values, ...(previous || []).filter(v => v != null));
    const y = (v, top) => m.top + plotH - (v / top) * plotH;
    const axis = yAxis(max, y, m.left, width - m.right);
    const band = plotW / values.length;
    const bands = values.map((_, i) => ({ x: m.left + i * band, w: band }));
    const barW = Math.max(2, Math.min(band - 2, band * 0.72));
    const bars = values.map((v, i) => {
      const x = bands[i].x + (band - barW) / 2;
      return barPath(x, y(v, axis.top), barW, m.top + plotH - y(v, axis.top));
    }).join('');
    const marks = (previous || []).map((v, i) => v == null ? '' : (() => {
      const x = bands[i].x + (band - barW) / 2 - 1;
      return `<line class="previous" x1="${x}" x2="${x + barW + 2}" y1="${y(v, axis.top)}" y2="${y(v, axis.top)}"/>`;
    })()).join('');
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">
        <g class="grid axis">${axis.svg}</g>
        <rect class="band-highlight" y="${m.top}" height="${plotH}" visibility="hidden"/>
        <path d="${bars}" fill="var(--person-${slot})"/>
        <g>${marks}</g>
        <g class="axis">${xLabels(labels, bands, height, minLabelGap)}</g>
        ${bands.map(b => `<rect class="band" x="${b.x}" y="0" width="${b.w}" height="${height}" fill="transparent"/>`).join('')}
      </svg>
      <div class="tooltip" hidden></div>`;
    attachTooltip(container, container.querySelector('svg'), bands, tooltip);
  });
}

// ---------- 100% stacked columns: each bucket split into shares (genres month by month)

// series: [{ name, color, values: shares 0..1 }], drawn bottom-up in order
export function stackedShareChart(container, { labels, series, tooltip, height = 260 }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const m = { top: 10, right: 8, bottom: 26, left: 44 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const y = v => m.top + plotH - v * plotH;
    const band = plotW / labels.length;
    const bands = labels.map((_, i) => ({ x: m.left + i * band, w: band }));
    const barW = Math.max(4, Math.min(band - 4, band * 0.7));
    const GAP = 2;   // surface-coloured gap between stacked segments
    const segments = series.map(s => `<g fill="${s.color}">${labels.map((_, i) => {
      const below = series.slice(0, series.indexOf(s)).reduce((sum, t) => sum + (t.values[i] || 0), 0);
      const v = s.values[i] || 0;
      const h = v * plotH - GAP;
      return h > 0 ? `<rect x="${bands[i].x + (band - barW) / 2}" y="${y(below + v) + GAP / 2}" width="${barW}" height="${h}" rx="2"/>` : '';
    }).join('')}</g>`).join('');
    const grid = [0, .25, .5, .75, 1].map(v => `<line x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v * 100}%</text>`).join('');
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">
        <g class="grid axis">${grid}</g>
        <rect class="band-highlight" y="${m.top}" height="${plotH}" visibility="hidden"/>
        ${segments}
        <g class="axis">${xLabels(labels, bands, height, 34)}</g>
        ${bands.map(b => `<rect class="band" x="${b.x}" y="0" width="${b.w}" height="${height}" fill="transparent"/>`).join('')}
      </svg>
      <div class="tooltip" hidden></div>`;
    attachTooltip(container, container.querySelector('svg'), bands, tooltip);
  });
}

// ---------- Heatmaps (calendar and hour-by-weekday): one hue, darker = less, in five steps

const HEAT_STEPS = [22, 40, 58, 78, 100];   // % of the person's colour mixed into the empty-cell colour

// Thresholds from the non-zero counts' quantiles, so one huge day doesn't wash out the rest.
function heatLevels(counts) {
  const sorted = counts.filter(c => c > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => -1;
  const cuts = [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.floor(q * (sorted.length - 1))]);
  return count => count <= 0 ? -1 : cuts.filter(c => count > c).length;
}
const heatFill = (slot, level) => level < 0 ? 'var(--panel2)' : `color-mix(in oklab, var(--person-${slot}) ${HEAT_STEPS[level]}%, var(--panel2))`;

export function heatLegend(slot) {
  return `<span class="heat-legend">Less ${HEAT_STEPS.map((_, i) => `<i style="background:${heatFill(slot, i)}"></i>`).join('')} More</span>`;
}

// Shows the tooltip for any [data-tip] element under the pointer.
function attachTips(container) {
  const tooltip = container.querySelector('.tooltip');
  container.addEventListener('pointerover', event => {
    const cell = event.target.closest('[data-tip]');
    if (!cell) { tooltip.hidden = true; return; }
    tooltip.innerHTML = cell.dataset.tip;
    tooltip.hidden = false;
    const box = container.getBoundingClientRect(), r = cell.getBoundingClientRect();
    const left = r.right - box.left + 6;
    tooltip.style.left = `${left + tooltip.offsetWidth > box.width ? r.left - box.left - tooltip.offsetWidth - 6 : left}px`;
    tooltip.style.top = `${Math.max(0, r.top - box.top - 8)}px`;
  });
  container.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

// days: Map 'YYYY-MM-DD' -> count. Weeks run Monday to Sunday, top to bottom.
export function calendarHeatmap(container, { year, days, slot }) {
  const CELL = 13, GAP = 3, LEFT = 30, TOP = 18;
  const start = new Date(year, 0, 1);
  const offset = (start.getDay() + 6) % 7;
  const cells = [], months = [];
  const counts = [];
  for (const d = new Date(start); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const index = offset + Math.round((d - start) / 86400000);
    const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = days.get(key) || 0;
    counts.push(count);
    cells.push({ week: Math.floor(index / 7), weekday: index % 7, count, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) });
    if (d.getDate() === 1) months.push({ week: Math.floor(index / 7), name: d.toLocaleDateString('en-US', { month: 'short' }) });
  }
  const level = heatLevels(counts);
  const weeks = cells.at(-1).week + 1;
  const width = LEFT + weeks * (CELL + GAP), height = TOP + 7 * (CELL + GAP);
  container.innerHTML = `
    <svg class="calendar-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Scrobbles per day in ${year}">
      ${months.map(m => `<text x="${LEFT + m.week * (CELL + GAP)}" y="11">${m.name}</text>`).join('')}
      ${['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => d ? `<text x="0" y="${TOP + i * (CELL + GAP) + CELL - 2}">${d}</text>` : '').join('')}
      ${cells.map(c => `<rect x="${LEFT + c.week * (CELL + GAP)}" y="${TOP + c.weekday * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="3" fill="${heatFill(slot, level(c.count))}" data-tip="<b>${c.label}</b>${fmt(c.count)} scrobbles"/>`).join('')}
    </svg>
    <div class="tooltip" hidden></div>`;
  attachTips(container);
}

// grid: 7 x 24 counts, Monday first.
export function weekHourHeatmap(container, { grid, slot }) {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hour = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  const level = heatLevels(grid.flat());
  container.innerHTML = `
    <div class="week-hour">
      <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="wh-hour">${h % 3 ? '' : hour(h)}</span>`).join('')}
      ${grid.map((row, d) => `<span class="wh-day">${DAYS[d]}</span>${row.map((count, h) =>
        `<i style="background:${heatFill(slot, level(count))}" data-tip="<b>${DAYS[d]} ${hour(h)}–${hour((h + 1) % 24)}</b>${fmt(count)} scrobbles"></i>`).join('')}`).join('')}
    </div>
    <div class="tooltip" hidden></div>`;
  attachTips(container);
}
