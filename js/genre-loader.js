// Keeps artist tags in memory once loaded (from IndexedDB or Last.fm), so genre maths can look them up
// synchronously. Loading goes through the shared request queue in api.js.

import { artistTags } from './history.js';
import { nameKey } from './analyze.js';

const loaded = new Map();   // artist name key -> [{ name, count }]

export const tagsFor = name => loaded.get(nameKey(name));

// onProgress(done, total) for the artists that weren't loaded yet.
export async function loadTags(names, onProgress = () => {}) {
  const missing = [...new Set(names.filter(name => !loaded.has(nameKey(name))))];
  let done = 0;
  if (missing.length) onProgress(0, missing.length);
  await Promise.all(missing.map(async name => {
    loaded.set(nameKey(name), await artistTags(name));
    onProgress(++done, missing.length);
  }));
}
