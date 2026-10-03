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

// ---------- Taste scatter: one dot per shared item, a's plays across, b's plays up, both on log scales

const hashJitter = key => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h % 1000) / 1000) * 0.08 - 0.04; };

// points: from pair.js tastePoints; ratio: b's scrobbles / a's scrobbles (the "same share" line)
export function scatterChart(container, { points, a, b, ratio, noun, onPick }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const size = Math.min(width, 520);
    const m = { top: 14, right: 16, bottom: 40, left: 52 };
    const plotW = width - m.left - m.right, plotH = size - m.top - m.bottom;
    const max = Math.max(10, ...points.flatMap(p => [p.x, p.y]));
    const top = Math.log10(max * 1.3);
    const LOW = Math.log10(0.6);   // a little room below 1 play, so those dots sit clear of the axes
    const sx = v => m.left + ((Math.log10(v) - LOW) / (top - LOW)) * plotW;
    const sy = v => m.top + plotH - ((Math.log10(v) - LOW) / (top - LOW)) * plotH;
    const ticks = [1, 10, 100, 1000, 10000, 100000].filter(t => Math.log10(t) <= top);
    const grid = ticks.map(t => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${m.top}" y2="${m.top + plotH}"/><line x1="${m.left}" x2="${m.left + plotW}" y1="${sy(t)}" y2="${sy(t)}"/>
      <text x="${sx(t)}" y="${m.top + plotH + 16}" text-anchor="middle">${fmtTick(t)}</text><text x="${m.left - 8}" y="${sy(t)}" text-anchor="end" dominant-baseline="middle">${fmtTick(t)}</text>`).join('');
    // "same share" line: y = x * ratio, clipped to the plot
    const edge = 10 ** top;
    const low = 10 ** LOW;
    const x1 = Math.max(low, low / ratio), x2 = Math.min(edge, edge / ratio);
    const dots = points.map((p, i) => {
      const jx = 10 ** hashJitter(p.key), jy = 10 ** hashJitter(p.key + '~');
      const slot = p.lean > 0 ? b.slot : a.slot;
      return `<circle class="dot" data-i="${i}" cx="${sx(p.x * jx).toFixed(1)}" cy="${sy(p.y * jy).toFixed(1)}" r="4.5" fill="var(--person-${slot})"/>`;
    }).join('');
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${size}" height="${size}" role="img" aria-label="Plays of each shared ${noun}: ${esc(a.profile.name)} across, ${esc(b.profile.name)} up">
        <g class="grid axis">${grid}</g>
        <line class="same-share" x1="${sx(x1)}" y1="${sy(x1 * ratio)}" x2="${sx(x2)}" y2="${sy(x2 * ratio)}"/>
        <text class="corner" x="${m.left + 8}" y="${m.top + 14}">more ${esc(b.profile.name)}</text>
        <text class="corner" x="${m.left + plotW - 8}" y="${m.top + plotH - 8}" text-anchor="end">more ${esc(a.profile.name)}</text>
        <g class="dots">${dots}</g>
        <text class="axis-title" x="${m.left + plotW / 2}" y="${size - 4}" text-anchor="middle">${esc(a.profile.name)}'s plays →</text>
        <text class="axis-title" transform="translate(12 ${m.top + plotH / 2}) rotate(-90)" text-anchor="middle">${esc(b.profile.name)}'s plays →</text>
      </svg>
      <div class="tooltip" hidden></div>`;
    const tooltip = container.querySelector('.tooltip');
    const svg = container.querySelector('svg');
    svg.querySelectorAll('.dot').forEach(dot => {
      const p = points[+dot.dataset.i];
      dot.addEventListener('pointerenter', () => {
        const times = Math.exp(Math.abs(p.lean));
        const who = p.lean > 0 ? b : a;
        tooltip.innerHTML = `<b>${esc(p.name)}</b>${p.artist ? `<div class="muted">${esc(p.artist)}</div>` : ''}
          <div><span>${esc(a.profile.name)}</span><span>${fmt(p.x)}</span></div><div><span>${esc(b.profile.name)}</span><span>${fmt(p.y)}</span></div>
          <div class="total"><span>${times < 1.1 ? 'About the same share' : `${times.toFixed(1)}× bigger share for ${esc(who.profile.name)}`}</span><span></span></div>`;
        tooltip.hidden = false;
        const box = svg.getBoundingClientRect(), r = dot.getBoundingClientRect();
        const left = r.right - box.left + 8;
        tooltip.style.left = `${left + tooltip.offsetWidth > box.width ? r.left - box.left - tooltip.offsetWidth - 8 : left}px`;
        tooltip.style.top = `${Math.max(0, r.top - box.top - 10)}px`;
      });
      dot.addEventListener('click', () => onPick?.(p));
    });
    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  });
}

// ---------- Rank comparison: a's top items on the left, b's on the right, lines joining items on both lists

export function slopeChart(container, { left, right, a, b, onPick }) {
  drawResponsive(container, () => {
    const width = container.clientWidth;
    const ROW = 24, TOP = 30;
    const rows = Math.max(left.length, right.length);
    const height = TOP + rows * ROW + 6;
    const col = Math.min(250, Math.max(130, width * 0.36));
    const chars = Math.floor((col - 34) / 7.2);
    const clip = s => s.length > chars ? `${s.slice(0, chars - 1)}…` : s;
    const y = i => TOP + i * ROW + ROW / 2;
    const rightIndex = new Map(right.map((item, i) => [item.key, i]));
    const lines = left.map((item, i) => rightIndex.has(item.key)
      ? `<line class="link" data-key="${esc(item.key)}" x1="${col + 6}" y1="${y(i)}" x2="${width - col - 6}" y2="${y(rightIndex.get(item.key))}"/>` : '').join('');
    const leftKeys = new Set(left.map(item => item.key));
    const label = (item, i, side) => {
      // not on the other list: show where it ranks for the other person instead of a line
      const onOther = side === 'left' ? rightIndex.has(item.key) : leftKeys.has(item.key);
      const extra = onOther ? '' : ` <tspan class="off">${item.otherRank ? `#${item.otherRank}` : '–'}</tspan>`;
      const x = side === 'left' ? col : width - col;
      const anchor = side === 'left' ? 'end' : 'start';
      const rank = side === 'left' ? `<text class="rank" x="4" y="${y(i)}">${item.rank}</text>` : `<text class="rank" x="${width - 4}" y="${y(i)}" text-anchor="end">${item.rank}</text>`;
      return `${rank}<text class="item" data-key="${esc(item.key)}" x="${x}" y="${y(i)}" text-anchor="${anchor}">${esc(clip(item.name))}${extra}<title>${esc(item.name)}${item.artist ? ` – ${esc(item.artist)}` : ''}: #${item.rank} for ${esc((side === 'left' ? a : b).profile.name)}, ${item.otherRank ? `#${item.otherRank}` : 'not played'} for ${esc((side === 'left' ? b : a).profile.name)}</title></text>`;
    };
    container.innerHTML = `
      <svg class="slope" viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Top lists side by side">
        <text class="head" x="${col}" y="14" text-anchor="end" fill="var(--person-${a.slot})">${esc(a.profile.name)}</text>
        <text class="head" x="${width - col}" y="14" fill="var(--person-${b.slot})">${esc(b.profile.name)}</text>
        <g>${lines}</g>
        ${left.map((item, i) => label(item, i, 'left')).join('')}
        ${right.map((item, i) => label(item, i, 'right')).join('')}
      </svg>`;
    const svg = container.querySelector('svg');
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
    const m = { top: 14, right: Math.min(170, width * 0.32), bottom: 26, left: 34 };
    const ROW = 26;
    const height = m.top + depth * ROW + m.bottom;
    const plotW = width - m.left - m.right;
    const x = i => m.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
    const y = r => m.top + (r - 0.5) * ROW;
    const chars = Math.floor((m.right - 14) / 7);
    const clip = s => s.length > chars ? `${s.slice(0, chars - 1)}…` : s;
    const grid = Array.from({ length: depth }, (_, r) => `<text x="${m.left - 12}" y="${y(r + 1)}" text-anchor="end" dominant-baseline="middle">${r + 1}</text>`).join('');
    const xLabels = labels.map((l, i) => `<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const groups = series.map((s, n) => {
      let d = '', pen = 'M';
      s.ranks.forEach((r, i) => { if (r == null) { pen = 'M'; return; } d += `${pen}${x(i).toFixed(1)},${y(r).toFixed(1)}`; pen = 'L'; });
      const dots = s.ranks.map((r, i) => r == null ? '' : `<circle cx="${x(i)}" cy="${y(r)}" r="4" data-tip="<b>${esc(s.name)}</b>${esc(longLabels[i])}: #${r}"/>`).join('');
      const lastIndex = s.ranks.findLastIndex(r => r != null);
      const label = lastIndex === labels.length - 1
        ? `<text class="end-label" x="${x(lastIndex) + 10}" y="${y(s.ranks[lastIndex])}" dominant-baseline="middle">${esc(clip(s.name))}</text>` : '';
      return `<g class="bump" data-n="${n}">${d ? `<path d="${d}"/>` : ''}${dots}${label}</g>`;
    }).join('');
    container.innerHTML = `
      <svg class="bump-chart" viewBox="0 0 ${width} ${height}" height="${height}" style="--hi:var(--person-${slot})" role="img" aria-label="Rank of top artists each month">
        <g class="axis">${grid}${xLabels}</g>${groups}
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
