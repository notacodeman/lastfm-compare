# Scrobble Compare

Compare two to six Last.fm users' full scrobble histories (each person's card also has a CSV download): head-to-head stats, genres, shared and unique artists, albums and tracks, how much your listening overlaps, and scrobbles over time.

The **Compare** tab also has:

- **Compatibility over time**: the same "listening in common" measure for each calendar year, per pair.
- **Genres**: a butterfly chart for two people (one person's shares to the left, the other's to the right), grouped bars for more.
- **Side by side** (two people at a time): both top 100s next to each other in a scrolling chart, with lines joining what's on both lists, and lists of the shared artists/albums/tracks that lean most to each person.
- **Who played it first**: across everyone's whole history, who scrobbled each shared item first when they were ahead by 30+ days, with the biggest head starts. It shows who got there first, not who introduced whom.
- **When you listen**: hour-of-day and day-of-week lines per person, as shares of each person's scrobbles.
- **Listening over time** can show a running total instead of per month.

Line charts label each line's peak and latest value (and an average when there's one line); column charts show an average line and bar values when there's room; the genre chart prints each share inside its segment.

Names already saved in this browser are listed under the username box, so you can add them with a click (an index of saved histories lives in the IndexedDB `people` store).

Reports also have **Top artists month by month**: a bump chart of the 10 most played artists' rank in each of the 12 months.

Click any **artist name** to open the artist page: plays, rank, first and last play, biggest day, peak month and longest streak for everyone you've added, plays by month as a line per person, and each person's top tracks and albums.

Reports have a **Save as image** button that draws a 1080 × 1350 PNG summary.

The **Reports** tab gives any one person a week, month or year report for any period in their history (Last.fm only does this for past periods with Pro): totals against the period before, scrobbles by day, top artists/albums/tracks, music that was new to them, top genres and genres month by month, a month-by-month table, the hours and weekdays they listen, and a listening fingerprint (consistency, discovery, concentration, replay rate, genre variety) next to everyone else added.

Live at [lastfm.codeman.club](https://lastfm.codeman.club). Not affiliated with Last.fm.

## How it works

- The page downloads each person's whole history with `user.getRecentTracks` (200 scrobbles per request) and saves it in the browser's IndexedDB. Later visits only ask for scrobbles newer than the saved ones. An interrupted download resumes from the pages it already has.
- Requests go through a Cloudflare Pages Function (`functions/api/lastfm.js`) that adds the API key, so the key never reaches the browser. It only forwards three read-only methods and caches good answers at the edge.
- All the comparing happens in the browser. Comparisons and reports are shareable: the URL holds the people, period and settings (`?u=alice,bob&k=albums&p=2024&m=3`, `?u=alice&v=report&ru=year&rk=2024`, `?u=alice,bob&v=artist&a=Radiohead`).

"Listening in common" for a pair is the sum, over every artist (or album or track), of the smaller of the two people's play shares. 100% would mean identical proportions, 0% nothing in common.

Genres come from Last.fm's top tags for each person's most played artists (Last.fm has no genre field). Tags that aren't genres (countries, "seen live", decades) are dropped and spellings merged, using `data/genre-tags.js`. Each artist's plays are split across its tags by tag weight. "Genre variety" is the number of equally played genres the spread matches (e to the power of the Shannon entropy of the shares).

A report for a period still under way is compared with the previous period up to the same point (Oct 1–2 against Sep 1–2).

## Files

| File | Job |
| --- | --- |
| `index.html` | Page markup: intro, Compare tab, Reports tab, artist page |
| `css/style.css` | All styles, colours at the top (`--person-0` … `--person-5` are the six people's colours) |
| `data/genre-tags.js` | Tags that aren't genres, and genre spellings to merge |
| **Data** | |
| `js/config.js` | Tunables: rate limit, page size, rows before lists scroll, list and chart sizes |
| `js/api.js` | Calls the proxy through one shared queue (about 4.5 requests a second), retries temporary errors and rate limits |
| `js/store.js` | IndexedDB: saved histories, an index of who's saved, artist tags |
| `js/history.js` | Profile lookup, full/incremental history download with resume, artist tags, the saved-people list |
| `js/genre-loader.js` | Loads artist tags (IndexedDB, then Last.fm) once and keeps them in memory |
| `js/summaries.js` | Each person's summaries (per period, per year, all time, first plays), worked out once and cached |
| **Maths (no DOM, tested in Node)** | |
| `js/analyze.js` | Per-period play counts, shared/unique items, overlap, timeline buckets |
| `js/report.js` | Weeks/months/years, first plays, new music, listening clock, fingerprint, month rows |
| `js/pair.js` | Leans, top lists side by side, who played it first, clocks, monthly ranks |
| `js/genres.js` | Genre shares and variety from artist tags |
| `js/artist.js` | One artist's history for one person, and the CSV export |
| **Drawing** | |
| `js/util.js` | Escaping, number and date formats, list rows, `fitRows` for scroll boxes, file downloads |
| `js/charts.js` | SVG Venn diagram, "shared by how many" bars, line, column, stacked-share, slope and bump charts, all with hover tooltips |
| `js/people.js` | The people cards and the saved-in-this-browser list |
| `js/compare-view.js` | Compare tab tables and lists: head to head, overlap, genres, shared items, only one of you |
| `js/compare-charts.js` | Compare tab charts: listening over time, compatibility over time, side by side, who played it first, when you listen |
| `js/report-view.js` | The Reports tab |
| `js/artist-view.js` | The artist page |
| `js/share-card.js` | Draws a report as a PNG image |
| `js/snap.js` | Gentle snapping onto section headers after the user scrolls |
| `js/app.js` | State, URL, events, and the order things are drawn in |
| **Elsewhere** | |
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
