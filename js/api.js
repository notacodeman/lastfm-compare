// Calls Last.fm through our proxy (functions/api/lastfm.js), which adds the API key.
// All requests from the page share one queue so several downloads together stay under Last.fm's rate limit.

import { MAX_CONCURRENT_REQUESTS, MIN_REQUEST_GAP_MS, MAX_RETRIES, RATE_LIMIT_WAIT_MS } from './config.js';
import { sleep } from './util.js';

const PROXY = 'api/lastfm';

// Last.fm error codes that are worth retrying: operation failed, service offline, temporary error, rate limit.
const RETRY_CODES = new Set([8, 11, 16, 29]);
const RATE_LIMITED = 29;

export class LastfmError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ---------- Request queue: at most MAX_CONCURRENT_REQUESTS at once, starts spaced MIN_REQUEST_GAP_MS apart

const waiting = [];
let running = 0;
let nextStart = 0;

function pump() {
  while (running < MAX_CONCURRENT_REQUESTS && waiting.length) {
    const start = Math.max(Date.now(), nextStart);
    nextStart = start + MIN_REQUEST_GAP_MS;
    running++;
    setTimeout(waiting.shift(), start - Date.now());
  }
}
const acquire = () => new Promise(resolve => { waiting.push(resolve); pump(); });
const release = () => { running--; pump(); };

// ---------- Calls

// Retries temporary failures (backing off, longer after a rate limit); other errors are thrown as LastfmError.

export async function call(method, params = {}, signal) {
  const query = new URLSearchParams({ method, ...params });
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquire();
    let res, data;
    try {
      signal?.throwIfAborted();
      res = await fetch(`${PROXY}?${query}`, { signal });
      data = await res.json().catch(() => null);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = new LastfmError(`Network error: ${err.message}`);
    } finally {
      release();
    }

    if (data && !data.error && res.ok) return data;

    if (res) {
      if (res.status === 404 && !data) {
        throw new LastfmError('The /api/lastfm function is missing. Deploy the functions/ folder with the site (Cloudflare Pages does this from the repo).');
      }
      const code = data?.error;
      lastError = new LastfmError(data?.message || `HTTP ${res.status}`, code);
      const retry = RETRY_CODES.has(code) || (res.status >= 500 && typeof code !== 'string');
      if (!retry) throw lastError;
    }
    const wait = lastError.code === RATE_LIMITED ? RATE_LIMIT_WAIT_MS * (attempt + 1) : 1000 * 2 ** attempt;
    await sleep(wait, signal);
  }
  throw lastError;
}
