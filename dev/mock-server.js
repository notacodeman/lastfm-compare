// Local preview without a Last.fm key: serves the site and answers /api/lastfm with made-up listening data.
//   node dev/mock-server.js          then open http://localhost:8788/?u=alice,bob,cara
// Any username works and always gets the same fake history. "private" acts like a hidden profile,
// "nobody" like a user that doesn't exist. FLAKY=1 makes 5% of requests fail, to exercise retries.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = +process.env.PORT || 8788;
const FLAKY = process.env.FLAKY === '1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

// ---------- fake data

const WORDS = ['Velvet', 'Neon', 'Paper', 'Silver', 'Hollow', 'Glass', 'Static', 'Wild', 'Lunar', 'Quiet', 'Golden', 'Broken',
  'Electric', 'Midnight', 'Crystal', 'Northern', 'Sunday', 'Feral', 'Copper', 'Ghost', 'Ocean', 'Cherry', 'Desert', 'Velour'];
const NOUNS = ['Owls', 'Machines', 'Rivers', 'Hearts', 'Lights', 'Wolves', 'Parade', 'Season', 'Garden', 'Signals', 'Orchestra',
  'Tapes', 'Choir', 'Saints', 'Engines', 'Tides', 'Satellites', 'Pilots', 'Dreamers', 'Arcade'];
const TAGS = ['indie', 'rock', 'electronic', 'shoegaze', 'pop', 'post-punk', 'ambient', 'hip-hop', 'folk', 'jazz', 'synthpop', 'metal'];

function rng(seed) {   // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

const ARTISTS = [];
{
  const r = rng(42);
  while (ARTISTS.length < 600) {
    const name = `${r() < 0.4 ? 'The ' : ''}${WORDS[Math.floor(r() * WORDS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]}`;
    if (!ARTISTS.includes(name)) ARTISTS.push(name);
  }
}

const histories = new Map();
function historyFor(name) {
  const key = name.toLowerCase();
  if (histories.has(key)) return histories.get(key);
  const r = rng(hash(key));
  const now = Math.floor(Date.now() / 1000);
  const start = now - Math.floor((2 + r() * 10) * 365 * 86400);
  const count = 2000 + Math.floor(r() * 30000);
  // Everyone draws from the same pool, each with their own favourites and a long tail.
  const favourites = Array.from({ length: 120 }, () => Math.floor(Math.pow(r(), 1.6) * ARTISTS.length));
  const rows = [];
  for (let i = 0; i < count; i++) {
    const artist = ARTISTS[favourites[Math.floor(Math.pow(r(), 2.2) * favourites.length)]];
    const a = hash(artist);
    const album = `${WORDS[a % WORDS.length]} ${['Sessions', 'Songs', 'Nights'][Math.floor(r() * 3)]}`;
    const track = `${WORDS[(a + Math.floor(r() * 9)) % WORDS.length]} ${NOUNS[(a >>> 3) % NOUNS.length].replace(/s$/, '')} ${1 + Math.floor(r() * 4)}`;
    rows.push({ uts: start + Math.floor(Math.pow(r(), 0.8) * (now - start)), artist, track, album });
  }
  rows.sort((x, y) => y.uts - x.uts);   // newest first, like Last.fm
  const user = { name, rows, registered: start - 86400 * 30 };
  histories.set(key, user);
  return user;
}

// ---------- API

function api(q) {
  const method = q.get('method');
  const user = q.get('user') || '';
  if (FLAKY && Math.random() < 0.05) return Math.random() < 0.5 ? [500, { error: 8, message: 'Operation failed' }] : [429, { error: 29, message: 'Rate limit exceeded' }];
  if (user.toLowerCase() === 'nobody') return [404, { error: 6, message: 'User not found' }];

  if (method === 'user.getinfo') {
    const h = historyFor(user);
    return [200, { user: { name: h.name, url: `https://www.last.fm/user/${h.name}`, image: [], playcount: String(h.rows.length), registered: { unixtime: String(h.registered) } } }];
  }
  if (method === 'user.getrecenttracks') {
    if (user.toLowerCase() === 'private') return [403, { error: 17, message: 'Login: User required to be logged in' }];
    const h = historyFor(user);
    const from = +q.get('from') || 0, to = +q.get('to') || Infinity;
    const limit = Math.min(200, +q.get('limit') || 50), page = Math.max(1, +q.get('page') || 1);
    const matching = h.rows.filter(r => r.uts >= from && r.uts <= to);
    const slice = matching.slice((page - 1) * limit, page * limit).map(r => ({
      artist: { '#text': r.artist }, name: r.track, album: { '#text': r.album }, date: { uts: String(r.uts) },
    }));
    if (page === 1) slice.unshift({ artist: { '#text': h.rows[0].artist }, name: h.rows[0].track, album: { '#text': '' }, '@attr': { nowplaying: 'true' } });
    return [200, { recenttracks: { track: slice, '@attr': { user: h.name, page: String(page), perPage: String(limit), totalPages: String(Math.ceil(matching.length / limit)), total: String(matching.length) } } }];
  }
  if (method === 'artist.gettoptags') {
    const a = hash(q.get('artist') || '');
    const tag = Array.from({ length: 5 }, (_, i) => ({ name: TAGS[(a >>> (i * 3)) % TAGS.length], count: 100 - i * 20 }));
    return [200, { toptags: { tag } }];
  }
  return [400, { error: 'method', message: `Method not allowed: ${method}` }];
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/lastfm') {
    const [status, body] = api(url.searchParams);
    setTimeout(() => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }, 40);
    return;
  }
  const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`Mock site on http://localhost:${PORT}/?u=alice,bob`));
