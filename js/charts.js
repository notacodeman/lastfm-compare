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
export function lineChart(container, { keys, series, labelFor, isYearStart }) {
  const width = container.clientWidth;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = i => MARGIN.left + (keys.length === 1 ? plotW / 2 : (i / (keys.length - 1)) * plotW);
  const y = v => MARGIN.top + plotH - (v / top) * plotH;

  const grid = [];
  for (let v = 0; v <= top; v += step) {
    grid.push(`<line x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y(v)}" y2="${y(v)}"/>`);
    grid.push(`<text x="${MARGIN.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${fmt(v)}</text>`);
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
    return `<path class="series" d="${d}" stroke="${color(s.slot)}"/>`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${HEIGHT}" height="${HEIGHT}" role="img" aria-label="Scrobbles over time">
      <g class="grid axis">${grid.join('')}</g>
      <g class="axis">${xLabels.join('')}</g>
      ${lines}
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}"/>
        ${series.map(s => `<circle r="4.5" fill="${color(s.slot)}" stroke="var(--panel)" stroke-width="2"/>`).join('')}
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
      series.map(s => `<div><span><span class="swatch" style="--color:${color(s.slot)}"></span>${esc(s.name)}</span><span>${s.values[i] == null ? '–' : fmt(s.values[i])}</span></div>`).join('')
    }<div class="total"><span>Total</span><span>${fmt(total)}</span></div>`;
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
