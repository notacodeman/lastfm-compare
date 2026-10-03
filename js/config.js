// Tunables in one place.

export const MAX_PEOPLE = 6;                // one categorical colour each (see css --person-N)

// Last.fm asks for no more than about 5 requests a second; every download shares this limit.
export const MAX_CONCURRENT_REQUESTS = 4;
export const MIN_REQUEST_GAP_MS = 220;
export const MAX_RETRIES = 5;
export const RATE_LIMIT_WAIT_MS = 5000;     // first wait after Last.fm says "rate limit exceeded"

export const PAGE_SIZE = 200;               // the most user.getRecentTracks returns per page
export const SAVE_EVERY_PAGES = 20;         // checkpoint a download so a closed tab can resume

export const TABLE_ROWS = 15;               // shared table rows before it scrolls
export const PANEL_ROWS = 10;               // side-by-side "only one of you" lists
export const MAX_RENDERED_ROWS = 500;       // search to reach the rest
export const TAG_ARTISTS = 10;              // top artists per person used to guess their top tags
export const DAILY_CHART_UP_TO_DAYS = 120;  // longer periods are charted by month

export const SNAP_DISTANCE_PX = 80;         // section headers this close to the top get snapped to

export const GENRE_ARTISTS = 40;            // top artists per person and period whose tags make up the genres
export const GENRE_ARTISTS_PER_MONTH = 15;  // the same, per month in "genres month by month"
export const GENRES_SHOWN = 12;             // genres listed in a report / compared
export const GENRES_STACKED = 7;            // genres in the month-by-month chart; the rest is "Other"
