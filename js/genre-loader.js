// Keeps artist tags in memory once loaded (from IndexedDB or Last.fm), so genre maths can look them up
// synchronously. Loading goes through the shared request queue in api.js.

import { artistTags } from './history.js';
import { nameKey } from './analyze.js';

const loaded = new Map();    // artist name key -> [{ name, count }]
const loading = new Map();   // artist name key -> promise, so two views asking at once share one request

export const tagsFor = name => loaded.get(nameKey(name));

// onProgress(done, total) counts the artists that weren't loaded yet.
export async function loadTags(names, onProgress = () => {}) {
  const missing = new Map();   // key -> the name as scrobbled, which is what Last.fm is asked about
  for (const name of names) if (!loaded.has(nameKey(name))) missing.set(nameKey(name), name);
  let done = 0;
  if (missing.size) onProgress(0, missing.size);
  await Promise.all([...missing].map(async ([key, name]) => {
    if (!loading.has(key)) loading.set(key, artistTags(name).then(tags => { loaded.set(key, tags); loading.delete(key); }));
    await loading.get(key);
    onProgress(++done, missing.size);
  }));
}
