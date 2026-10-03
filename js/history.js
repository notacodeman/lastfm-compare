// Downloads a user's full scrobble history and keeps it up to date.
//
// A saved record is { key, rows, watermark, pending }:
//   rows       every scrobble as [unix time, artist, track, album], oldest first
//   watermark  the time up to which rows are complete; the next update asks for scrobbles after it
//   pending    a download in progress: { from, to, totalPages, pages: { pageNumber: rows } }
// The `to` time is fixed when a download starts, so its pages don't shift as new scrobbles arrive,
// and an interrupted download can pick up the pages it's missing.

import { call, LastfmError } from './api.js';
import { PAGE_SIZE, SAVE_EVERY_PAGES } from './config.js';
import { HISTORY, TAGS, load, save } from './store.js';
import { nowSec } from './util.js';

export async function fetchProfile(username, signal) {
  try {
    const { user } = await call('user.getinfo', { user: username }, signal);
    const image = (user.image || []).find(i => i.size === 'large')?.['#text'] || '';
    return {
      name: user.name,
      url: user.url,
      image,
      registered: +user.registered?.unixtime || null,
      playcount: +user.playcount || 0,
    };
  } catch (err) {
    if (err.code === 6) throw new LastfmError(`There's no Last.fm user called "${username}".`, 6);
    throw err;
  }
}

// onProgress({ pagesDone, totalPages, scrobbles }) is called as pages arrive.
export async function fetchHistory(username, { signal, onProgress = () => {} } = {}) {
  const key = username.toLowerCase();
  const record = (await load(HISTORY, key)) || { key, rows: [], watermark: 0 };
  const report = (done, total, extra) => onProgress({ pagesDone: done, totalPages: total, scrobbles: record.rows.length + extra });
  report(0, 0, 0);

  // Finish an interrupted download first, then fetch anything newer.
  if (record.pending) await finishPending(username, record, signal, report);
  record.pending = { from: record.watermark ? record.watermark + 1 : 0, to: nowSec(), totalPages: null, pages: {} };
  await finishPending(username, record, signal, report);
  return record.rows;
}

async function finishPending(username, record, signal, report) {
  const job = record.pending;
  const params = { user: username, limit: PAGE_SIZE, to: job.to };
  if (job.from) params.from = job.from;

  const fetchPage = async page => {
    try {
      return parsePage(await call('user.getrecenttracks', { ...params, page }, signal));
    } catch (err) {
      if (err.code === 17) throw new LastfmError(`${username} hides their recent listening on Last.fm, so it can't be compared.`, 17);
      throw err;
    }
  };

  let sinceSave = 0;
  const countRows = () => Object.values(job.pages).reduce((n, rows) => n + rows.length, 0);
  const progress = () => report(Object.keys(job.pages).length, job.totalPages || 0, countRows());

  if (job.totalPages == null) {
    const first = await fetchPage(1);
    job.totalPages = first.totalPages;
    if (job.totalPages) job.pages[1] = first.rows;
    await save(HISTORY, record);
    progress();
  }

  const missing = [];
  for (let page = 1; page <= job.totalPages; page++) if (!job.pages[page]) missing.push(page);
  progress();

  await Promise.all(missing.map(async page => {
    job.pages[page] = (await fetchPage(page)).rows;
    progress();
    if (++sinceSave % SAVE_EVERY_PAGES === 0) await save(HISTORY, record);
  })).catch(async err => {
    await save(HISTORY, record);   // keep what arrived, so a retry resumes
    throw err;
  });

  const fresh = Object.values(job.pages).flat().sort((a, b) => a[0] - b[0]);
  record.rows = record.rows.concat(fresh);
  record.watermark = job.to;
  delete record.pending;
  await save(HISTORY, record);
  report(job.totalPages, job.totalPages, 0);
}

function parsePage(data) {
  const list = data.recenttracks || {};
  const attr = list['@attr'] || {};
  const tracks = [].concat(list.track || []);   // a single track comes back as an object, not an array
  const rows = [];
  for (const t of tracks) {
    if (t['@attr']?.nowplaying || !t.date) continue;   // "now playing" isn't a scrobble yet
    rows.push([+t.date.uts, t.artist?.['#text'] ?? t.artist?.name ?? '', t.name || '', t.album?.['#text'] || '']);
  }
  return { rows, totalPages: +attr.totalPages || 0 };
}

// Top tags for an artist, saved so each artist is only asked about once.
export async function artistTags(artist, signal) {
  const key = artist.toLowerCase();
  const saved = await load(TAGS, key);
  if (saved) return saved.tags;
  let tags = [];
  try {
    const data = await call('artist.gettoptags', { artist, autocorrect: 1 }, signal);
    tags = [].concat(data.toptags?.tag || []).slice(0, 10).map(t => ({ name: t.name.toLowerCase(), count: +t.count || 0 }));
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];   // tags are a nice-to-have; don't fail the comparison over them
  }
  await save(TAGS, { key, tags });
  return tags;
}
