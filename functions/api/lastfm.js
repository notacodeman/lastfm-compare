// GET /api/lastfm?method=...&...: forwards a read-only call to the Last.fm API with our key added.
// The key lives in the Pages secret LASTFM_API_KEY, so it never reaches the browser.
// Only the methods and parameters below are forwarded. Successful answers are kept in Cloudflare's edge cache.

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const USER_AGENT = 'ScrobbleCompare/1.0 (+https://lastfm.codeman.club)';

// method -> parameters passed through, and how long a good answer is cached (seconds)
const ALLOWED = {
  'user.getinfo':         { params: ['user'], ttl: 600 },
  'user.getrecenttracks': { params: ['user', 'page', 'limit', 'from', 'to'], ttl: 60 },
  'artist.gettoptags':    { params: ['artist', 'autocorrect'], ttl: 7 * 86400 },
};
// A history page with a fixed `to` time never changes, so it can be kept longer (helps resumed downloads).
const SNAPSHOT_PAGE_TTL = 3600;

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.LASTFM_API_KEY) {
    return json({ error: 'config', message: 'LASTFM_API_KEY is not set. Add it in the Cloudflare Pages project under Settings → Variables and Secrets, then redeploy.' }, 500);
  }

  const url = new URL(request.url);
  const method = (url.searchParams.get('method') || '').toLowerCase();
  const rule = ALLOWED[method];
  if (!rule) return json({ error: 'method', message: `Method not allowed: ${method || '(none)'}` }, 400);

  const upstream = new URL(API_ROOT);
  upstream.searchParams.set('method', method);
  for (const name of rule.params) {
    const value = url.searchParams.get(name);
    if (value !== null) upstream.searchParams.set(name, value);
  }
  upstream.searchParams.set('format', 'json');

  // Cache key: the forwarded query without the API key.
  const cacheKey = new Request(`${url.origin}/api/lastfm-cache${upstream.search}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  upstream.searchParams.set('api_key', env.LASTFM_API_KEY);
  let res;
  try {
    res = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    return json({ error: 'upstream', message: `Could not reach Last.fm: ${err.message}` }, 502);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    return json({ error: 'upstream', message: `Last.fm answered HTTP ${res.status} without JSON` }, 502);
  }

  const ok = res.ok && !data.error;
  const ttl = method === 'user.getrecenttracks' && upstream.searchParams.has('to') ? SNAPSHOT_PAGE_TTL : rule.ttl;
  const out = new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': ok ? `public, max-age=${ttl}` : 'no-store' },
  });
  if (ok) waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
