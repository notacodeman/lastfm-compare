// Saves downloaded histories and artist tags in IndexedDB, so a second visit only fetches new scrobbles.
// If IndexedDB is unavailable (private windows, blocked storage) everything still works, just without saving.

const DB_NAME = 'scrobble-compare';
const DB_VERSION = 1;
export const HISTORY = 'history';   // { key: username lowercased, rows, watermark, pending? }
export const TAGS = 'tags';         // { key: artist name lowercased, tags: [names] }

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of [HISTORY, TAGS]) req.result.createObjectStore(name, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbPromise;
}

function run(storeName, mode, action) {
  return open().then(db => db && new Promise(resolve => {
    try {
      const req = action(db.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  })).catch(() => undefined);
}

export const load = (storeName, key) => run(storeName, 'readonly', s => s.get(key));
export const save = (storeName, value) => run(storeName, 'readwrite', s => s.put(value));
export const remove = (storeName, key) => run(storeName, 'readwrite', s => s.delete(key));
export const clearAll = () => Promise.all([HISTORY, TAGS].map(name => run(name, 'readwrite', s => s.clear())));
export const keys = storeName => run(storeName, 'readonly', s => s.getAllKeys());
