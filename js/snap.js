// Gentle section snapping: after the user stops scrolling, if a main section header is within
// SNAP_DISTANCE_PX of the top, ease onto it. Only after the user's own input, never after scripted scrolls.

import { SNAP_DISTANCE_PX } from './config.js';

const SETTLE_MS = 150;
const INPUT_WINDOW_MS = 1000;
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);

export function enableSectionSnap(headerSelector) {
  let lastInput = 0, timer;
  const userInput = () => { lastInput = Date.now(); };
  addEventListener('wheel', userInput, { passive: true });
  addEventListener('touchmove', userInput, { passive: true });
  addEventListener('keydown', e => {
    if (SCROLL_KEYS.has(e.key) && !e.target.closest('input, select, textarea, button')) userInput();
  });

  addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Date.now() - lastInput > INPUT_WINDOW_MS) return;
      const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      for (const header of document.querySelectorAll(headerSelector)) {
        if (!header.offsetParent) continue;
        const offset = header.getBoundingClientRect().top - padding;
        if (Math.abs(offset) <= SNAP_DISTANCE_PX && Math.abs(offset) > 1) {
          lastInput = 0;
          scrollBy({ top: offset, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          return;
        }
      }
    }, SETTLE_MS);
  }, { passive: true });
}
