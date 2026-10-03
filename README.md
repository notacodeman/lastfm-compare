# Scrobble Compare

Compare two to six Last.fm users' full scrobble histories: head-to-head stats, genres, shared and unique artists, albums and tracks, how much your listening overlaps, and scrobbles over time.

The **Reports** tab gives any one person a week, month or year report for any period in their history (Last.fm only does this for past periods with Pro): totals against the period before, scrobbles by day, top artists/albums/tracks, music that was new to them, top genres and genres month by month, a month-by-month table, the hours and weekdays they listen, and a listening fingerprint (consistency, discovery, concentration, replay rate, genre variety) next to everyone else added.

Live at [lastfm.codeman.club](https://lastfm.codeman.club). Not affiliated with Last.fm.

## How it works

- The page downloads each person's whole history with `user.getRecentTracks` (200 scrobbles per request) and saves it in the browser's IndexedDB. Later visits only ask for scrobbles newer than the saved ones. An interrupted download resumes from the pages it already has.
- Requests go through a Cloudflare Pages Function (`functions/api/lastfm.js`) that adds the API key, so the key never reaches the browser. It only forwards three read-only methods and caches good answers at the edge.
- All the comparing happens in the browser. Comparisons and reports are shareable: the URL holds the people, period and settings (`?u=alice,bob&k=albums&p=2024&m=3`, `?u=alice&v=report&ru=year&rk=2024`).

"Listening in common" for a pair is the sum, over every artist (or album or track), of the smaller of the two people's play shares. 100% would mean identical proportions, 0% nothing in common.

Genres come from Last.fm's top tags for each person's most played artists (Last.fm has no genre field). Tags that aren't genres (countries, "seen live", decades) are dropped and spellings merged, using `data/genre-tags.js`. Each artist's plays are split across its tags by tag weight. "Genre variety" is the number of equally played genres the spread matches (e to the power of the Shannon entropy of the shares).

A report for a period still under way is compared with the previous period up to the same point (Oct 1–2 against Sep 1–2).

## Files

| File | Job |
| --- | --- |
| `index.html` | Page markup |
| `css/style.css` | All styles, colours at the top (`--person-0` … `--person-5` are the six people's colours) |
| `js/config.js` | Tunables: rate limit, page size, rows before lists scroll |
| `js/util.js` | Shared helpers: escaping, number and date formats, `fitRows` for scroll boxes |
| `js/api.js` | Calls the proxy through one shared queue (about 4.5 requests a second), retries temporary errors and rate limits |
| `js/store.js` | IndexedDB: saved histories and artist tags |
| `js/history.js` | Profile lookup, full/incremental history download with resume, artist tags |
| `js/analyze.js` | The comparison maths (no DOM): per-period play counts, shared/unique, overlap, timeline buckets |
| `js/report.js` | The report maths (no DOM): weeks/months/years, first plays, new music, clock, fingerprint, month rows |
| `js/genres.js` | Genre shares and variety from artist tags (no DOM) |
| `js/genre-loader.js` | Loads artist tags (IndexedDB, then Last.fm) and keeps them in memory |
| `js/report-view.js` | HTML and charts for the Reports tab |
| `data/genre-tags.js` | Tags that aren't genres, and genre spellings to merge |
| `js/charts.js` | SVG Venn diagram, "shared by how many" bars, overlap matrix, timeline, column and stacked-share charts with hover tooltips |
| `js/render.js` | HTML for the people cards, stats table, overlap, shared table and unique lists |
| `js/snap.js` | Gentle snapping onto section headers after the user scrolls |
| `js/app.js` | State, events, URL state, and the order things run in |
| `functions/api/lastfm.js` | The Last.fm proxy (Cloudflare Pages Function) |
| `dev/mock-server.js` | Local preview with made-up data, no key needed |
| `tests/` | Tests for the maths files |

No build step.

## Run it locally

With fake data (no Last.fm key needed):

```
node dev/mock-server.js
```

then open http://localhost:8788/?u=alice,bob,cara. Any name works. `nobody` acts like a missing user and `private` like a hidden profile. `FLAKY=1 node dev/mock-server.js` makes 5% of requests fail, to watch the retries.

With real Last.fm data: copy `.dev.vars.example` to `.dev.vars`, put your key in it, and run `npx wrangler pages dev .`

Tests: `node --test tests/*.test.js`

## Deploy (Cloudflare Pages)

1. Get an API key at https://www.last.fm/api/account/create (only the key is used, not the shared secret).
2. Create a Pages project from this repo. Framework preset: None, build command empty, output directory `/`.
3. Settings → Variables and Secrets: add `LASTFM_API_KEY` as a secret (Production and Preview), then redeploy.
4. Custom domains: add `lastfm.codeman.club`.
