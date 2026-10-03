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

// ---------- Timeline: one line per person, with a crosshair tooltip listing everyone and the total

const MARGIN = { top: 12, right: 14, bottom: 28, left: 52 };
const HEIGHT = 270;

function niceStep(rough) {
  const pow = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 2.5, 5, 10].map(m => m * pow).find(step => step >= rough);
}

// series: [{ name, slot, values }] where null means "not scrobbling yet" (no line drawn),
// keys: bucket keys, labelFor(key, short) -> text
// Options: format(value) for axis and tooltip numbers, showTotal (default true), max (fixed top of the axis),
// details (default true): each line's peak and latest value labelled, year gridlines, and an average line
// when there's only one series. A series can set `color` instead of a person `slot`.
export function lineChart(container, { keys, series, labelFor, isYearStart, format = fmt, showTotal = true, max: fixedMax, details = true }) {
  const stroke = s => s.color || color(s.slot);
  const width = container.clientWidth;
  const labelled = details && series.length <= 4;
  const M = { ...MARGIN, right: labelled ? 62 : MARGIN.right };
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const all = series.flatMap(s => s.values).filter(v => v != null);
  const max = fixedMax ?? Math.max(1, ...all) * (labelled ? 1.12 : 1);   // headroom for peak labels
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = i => M.left + (keys.length === 1 ? plotW / 2 : (i / (keys.length - 1)) * plotW);
  const y = v => M.top + plotH - (v / top) * plotH;

  const grid = [];
  for (let v = 0; v <= top + step / 1000; v += step) {
    grid.push(`<line x1="${M.left}" x2="${width - M.right}" y1="${y(v)}" y2="${y(v)}"/>`);
    grid.push(`<text x="${M.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${format(v)}</text>`);
  }

  // x labels: on long monthly charts, a year at each January (skipping years if they'd crowd);
  // otherwise evenly spaced, at least ~70px apart
  const xLabels = [], yearLines = [];
  const label = i => xLabels.push(`<text x="${x(i)}" y="${HEIGHT - 8}" text-anchor="middle">${esc(labelFor(keys[i], true))}</text>`);
  if (isYearStart && keys.length > 30) {
    const pxPerYear = plotW / (keys.length / 12);
    const yearStep = Math.max(1, Math.ceil(50 / pxPerYear));
    keys.forEach((key, i) => {
      if (!isYearStart(key)) return;
      if (details) yearLines.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${M.top}" y2="${M.top + plotH}"/>`);
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

  // Details: peak of each line, latest value at the right edge, average for a single line
  let marks = '';
  if (labelled) {
    const placed = [];
    series.forEach(s => {
      let peak = -1;
      s.values.forEach((v, i) => { if (v != null && (peak < 0 || v > s.values[peak])) peak = i; });
      if (peak < 0 || !s.values[peak]) return;
      const px = x(peak), py = y(s.values[peak]);
      let ly = py - 9;
      while (placed.some(p => Math.abs(p.x - px) < 110 && Math.abs(p.y - ly) < 13)) ly -= 13;   // stack clashing labels
      placed.push({ x: px, y: ly });
      const anchor = px > M.left + plotW - 60 ? 'end' : px < M.left + 60 ? 'start' : 'middle';
      marks += `<circle class="peak" cx="${px}" cy="${py}" r="3.5" fill="${stroke(s)}"/>
        <text class="mark-label" x="${px}" y="${Math.max(10, ly)}" text-anchor="${anchor}">${series.length > 1 ? `${esc(s.name)} ` : ''}peak ${format(s.values[peak])} · ${esc(labelFor(keys[peak], false))}</text>`;
    });
    const ends = series.map(s => {
      const i = s.values.findLastIndex(v => v != null);
      return i < 0 ? null : { s, i, y: y(s.values[i]) };
    }).filter(Boolean).sort((p, q) => p.y - q.y);
    for (let n = 1; n < ends.length; n++) ends[n].y = Math.max(ends[n].y, ends[n - 1].y + 13);   // keep end labels apart
    marks += ends.map(e => `<text class="end-value" x="${width - M.right + 8}" y="${e.y}" dominant-baseline="middle"><tspan fill="${stroke(e.s)}">●</tspan> ${format(e.s.values[e.i])}</text>`).join('');
    if (series.length === 1 && all.length > 2) {
      const avg = all.reduce((a, b) => a + b, 0) / all.length;
      marks += `<line class="average" x1="${M.left}" x2="${width - M.right}" y1="${y(avg)}" y2="${y(avg)}"/>
        <text class="mark-label" x="${M.left + 6}" y="${y(avg) - 5}">average ${format(avg)}</text>`;
    }
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${HEIGHT}" height="${HEIGHT}" role="img" aria-label="Line chart">
      <g class="grid axis">${grid.join('')}${yearLines.join('')}</g>
      <g class="axis">${xLabels.join('')}</g>
      ${lines}
      ${marks}
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${M.top}" y2="${M.top + plotH}"/>
        ${series.map(s => `<circle r="4.5" fill="${stroke(s)}" stroke="var(--panel)" stroke-width="2"/>`).join('')}
      </g>
      <rect class="hit" x="${M.left - 6}" y="0" width="${plotW + 12}" height="${HEIGHT}" fill="transparent"/>
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
    const i = Math.max(0, Math.min(keys.length - 1, Math.round(((px - M.left) / plotW) * (keys.length - 1))));
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
    tooltip.style.top = `${M.top}px`;
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
// Also draws a dashed average line, and each bar's value on top when the bars are wide enough to fit it.
export function columnChart(container, { labels, values, previous, slot, tooltip, height = 230, minLabelGap = 30, averageLabel = 'average' }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const m = { top: 10, right: 8, bottom: 26, left: 44 };
    const plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    const max = Math.max(1, ...values, ...(previous || []).filter(v => v != null)) * 1.1;   // room for value labels
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
    const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const average = avg > 0 ? `<line class="average" x1="${m.left}" x2="${width - m.right}" y1="${y(avg, axis.top)}" y2="${y(avg, axis.top)}"/>
      <text class="mark-label" x="${width - m.right}" y="${y(avg, axis.top) - 5}" text-anchor="end">${averageLabel} ${avg >= 10 ? fmt(avg) : avg.toFixed(1)}</text>` : '';
    const valueLabels = barW >= 22 ? values.map((v, i) => v ? `<text class="bar-value" x="${bands[i].x + band / 2}" y="${y(v, axis.top) - 5}" text-anchor="middle">${fmtTick(v)}</text>` : '').join('') : '';
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">
        <g class="grid axis">${axis.svg}</g>
        <rect class="band-highlight" y="${m.top}" height="${plotH}" visibility="hidden"/>
        <path d="${bars}" fill="var(--person-${slot})"/>
        <g>${marks}</g>
        ${average}
        ${valueLabels}
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
      if (h <= 0) return '';
      const rx = bands[i].x + (band - barW) / 2, ry = y(below + v) + GAP / 2;
      const text = h >= 16 && barW >= 28 ? `<text class="segment-value" x="${rx + barW / 2}" y="${ry + h / 2}" text-anchor="middle" dominant-baseline="middle">${Math.round(v * 100)}</text>` : '';
      return `<rect x="${rx}" y="${ry}" width="${barW}" height="${h}" rx="2"/>${text}`;
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

// ---------- Rank comparison: a's top items on the left, b's on the right, lines joining items on both lists

// The names sit above the scroll box, so they stay put while the rows scroll.
export function slopeChart(container, { left, right, a, b, visibleRows, onPick }) {
  const ROW = 24;
  drawResponsive(container, () => {
    const scrolled = container.querySelector('.slope-scroll')?.scrollTop || 0;   // keep the place on redraws
    const width = container.clientWidth;
    const rows = Math.max(left.length, right.length);
    const height = rows * ROW + 4;
    const col = Math.min(250, Math.max(130, width * 0.36));
    // SVG text can't ellipsis itself: estimate ~7.6px a character and leave room for the rank and any "#123"
    const clip = (s, suffix) => {
      const chars = Math.floor((col - 34 - (suffix ? suffix.length * 6.5 + 4 : 0)) / 7.6);
      return s.length > chars ? `${s.slice(0, chars - 1)}…` : s;
    };
    const y = i => i * ROW + ROW / 2;
    const rightIndex = new Map(right.map((item, i) => [item.key, i]));
    const leftKeys = new Set(left.map(item => item.key));
    const lines = left.map((item, i) => rightIndex.has(item.key)
      ? `<line class="link" data-key="${esc(item.key)}" x1="${col + 6}" y1="${y(i)}" x2="${width - col - 6}" y2="${y(rightIndex.get(item.key))}"/>` : '').join('');
    const label = (item, i, side) => {
      // not on the other list: show where it ranks for the other person instead of a line
      const onOther = side === 'left' ? rightIndex.has(item.key) : leftKeys.has(item.key);
      const suffix = onOther ? '' : item.otherRank ? `#${item.otherRank}` : '–';
      const extra = suffix ? ` <tspan class="off">${suffix}</tspan>` : '';
      const x = side === 'left' ? col : width - col;
      const anchor = side === 'left' ? 'end' : 'start';
      const rank = side === 'left' ? `<text class="rank" x="4" y="${y(i)}">${item.rank}</text>` : `<text class="rank" x="${width - 4}" y="${y(i)}" text-anchor="end">${item.rank}</text>`;
      return `${rank}<text class="item" data-key="${esc(item.key)}" x="${x}" y="${y(i)}" text-anchor="${anchor}">${esc(clip(item.name, suffix))}${extra}<title>${esc(item.name)}${item.artist ? ` – ${esc(item.artist)}` : ''}: ${fmt(item.plays)} plays, #${item.rank} for ${esc((side === 'left' ? a : b).profile.name)}, ${item.otherRank ? `#${item.otherRank}` : 'not played'} for ${esc((side === 'left' ? b : a).profile.name)}</title></text>`;
    };
    container.innerHTML = `
      <div class="slope-head" style="--col:${col}px">
        <span style="color:var(--person-${a.slot})">${esc(a.profile.name)}</span>
        <span style="color:var(--person-${b.slot})">${esc(b.profile.name)}</span>
      </div>
      <div class="slope-scroll">
        <svg class="slope" viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Top lists side by side">
          <g>${lines}</g>
          ${left.map((item, i) => label(item, i, 'left')).join('')}
          ${right.map((item, i) => label(item, i, 'right')).join('')}
        </svg>
      </div>`;
    const box = container.querySelector('.slope-scroll');
    box.style.maxHeight = rows > visibleRows ? `${Math.min(ROW * (visibleRows + 0.5), window.innerHeight * 0.8)}px` : '';
    box.scrollTop = scrolled;
    const svg = box.querySelector('svg');
    const all = [...left, ...right];
    const highlight = key => svg.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('lit', !!key && el.dataset.key === key));
    svg.addEventListener('pointerover', e => highlight(e.target.closest('[data-key]')?.dataset.key));
    svg.addEventListener('pointerleave', () => highlight(null));
    svg.addEventListener('click', e => {
      const key = e.target.closest('.item')?.dataset.key;
      const item = key && all.find(i => i.key === key);
      if (item) onPick?.(item);
    });
  });
}

// ---------- Bump chart: rank of the top artists in each month; hover one to follow it

export function bumpChart(container, { series, labels, longLabels, depth, slot, onPick }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const side = Math.min(170, width * 0.24);
    const m = { top: 14, right: side, bottom: 26, left: side };
    const ROW = 26;
    const height = m.top + depth * ROW + m.bottom;
    const plotW = width - m.left - m.right;
    const x = i => m.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
    const y = r => m.top + (r - 0.5) * ROW;
    const chars = Math.floor((side - 40) / 7);
    const clip = s => s.length > chars ? `${s.slice(0, chars - 1)}…` : s;
    const grid = Array.from({ length: depth }, (_, r) => `<line x1="${m.left}" x2="${width - m.right}" y1="${y(r + 1)}" y2="${y(r + 1)}"/>`).join('');
    const xLabels = labels.map((l, i) => `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const groups = series.map((s, n) => {
      let d = '', pen = 'M';
      s.ranks.forEach((r, i) => { if (r == null) { pen = 'M'; return; } d += `${pen}${x(i).toFixed(1)},${y(r).toFixed(1)}`; pen = 'L'; });
      const dots = s.ranks.map((r, i) => r == null ? '' : `<circle cx="${x(i)}" cy="${y(r)}" r="4" data-tip="<b>${esc(s.name)}</b>${esc(longLabels[i])}: #${r}${s.monthPlays ? `, ${fmt(s.monthPlays[i])} plays` : ''}<br><span class='muted'>${fmt(s.plays)} plays over the 12 months</span>"/>`).join('');
      const lastIndex = s.ranks.findLastIndex(r => r != null);
      // names at both ends: first month on the left, last month on the right (with total plays)
      const label = (lastIndex === labels.length - 1
        ? `<text class="end-label" x="${x(lastIndex) + 10}" y="${y(s.ranks[lastIndex])}" dominant-baseline="middle">#${s.ranks[lastIndex]} ${esc(clip(s.name))}</text>` : '')
        + (s.ranks[0] != null
        ? `<text class="end-label" x="${x(0) - 10}" y="${y(s.ranks[0])}" text-anchor="end" dominant-baseline="middle">${esc(clip(s.name))} #${s.ranks[0]}</text>` : '');
      return `<g class="bump" data-n="${n}">${d ? `<path d="${d}"/>` : ''}${dots}${label}</g>`;
    }).join('');
    container.innerHTML = `
      <svg class="bump-chart" viewBox="0 0 ${width} ${height}" height="${height}" style="--hi:var(--person-${slot})" role="img" aria-label="Rank of top artists each month">
        <g class="grid">${grid}</g><g class="axis">${xLabels}</g>${groups}
      </svg>
      <div class="tooltip" hidden></div>`;
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.tooltip');
    const highlight = n => svg.querySelectorAll('.bump').forEach(g => g.classList.toggle('lit', g.dataset.n === n));
    svg.addEventListener('pointerover', e => {
      const g = e.target.closest('.bump');
      highlight(g?.dataset.n);
      const dot = e.target.closest('[data-tip]');
      if (!dot) { tooltip.hidden = true; return; }
      tooltip.innerHTML = dot.dataset.tip;
      tooltip.hidden = false;
      const box = svg.getBoundingClientRect(), r = dot.getBoundingClientRect();
      const left = r.right - box.left + 8;
      tooltip.style.left = `${left + tooltip.offsetWidth > box.width ? r.left - box.left - tooltip.offsetWidth - 8 : left}px`;
      tooltip.style.top = `${Math.max(0, r.top - box.top - 10)}px`;
    });
    svg.addEventListener('pointerleave', () => { highlight(null); tooltip.hidden = true; });
    svg.addEventListener('click', e => { const g = e.target.closest('.bump'); if (g) onPick?.(series[+g.dataset.n]); });
  });
}
