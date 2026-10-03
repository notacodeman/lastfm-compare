// Genre breakdown from Last.fm artist tags (see data/genre-tags.js for why tags, and the clean-up list).
// Each artist's plays are split across its genre tags in proportion to the tags' weights, so genre shares
// add up to 100% of the plays we could tag.

import { NOT_GENRES, GENRE_ALIASES } from '../data/genre-tags.js';

const YEAR_OR_DECADE = /^(\d{2}|\d{4})s?$|^(19|20)\d0s$/;

export function genreName(tag) {
  const name = tag.toLowerCase().trim();
  if (NOT_GENRES.has(name) || YEAR_OR_DECADE.test(name)) return null;
  return GENRE_ALIASES[name] || name;
}

// artists: [{ name, plays }]; tagsFor(name) -> [{ name, count }] or undefined when not loaded
export function genreShares(artists, tagsFor) {
  const weights = new Map();
  let tagged = 0, total = 0;
  for (const artist of artists) {
    total += artist.plays;
    const tags = new Map();   // a cleaned-up name can appear twice ("hip-hop" and "hip hop"): add them up
    for (const tag of tagsFor(artist.name) || []) {
      const name = genreName(tag.name);
      if (name && tag.count > 0) tags.set(name, (tags.get(name) || 0) + tag.count);
    }
    const sum = [...tags.values()].reduce((a, b) => a + b, 0);
    if (!sum) continue;
    tagged += artist.plays;
    for (const [name, count] of tags) weights.set(name, (weights.get(name) || 0) + artist.plays * count / sum);
  }
  const shares = [...weights]
    .map(([name, plays]) => ({ name, plays, share: plays / tagged }))
    .sort((a, b) => b.plays - a.plays);
  return { shares, tagged, total, coverage: total ? tagged / total : 0 };
}

// "Effective number of genres": e to the power of the Shannon entropy of the shares.
// 1 = everything in one genre; 10 = as spread out as ten equally played genres.
export function genreVariety(shares) {
  let entropy = 0;
  for (const { share } of shares) if (share > 0) entropy -= share * Math.log(share);
  return shares.length ? Math.exp(entropy) : 0;
}

// The artists worth asking Last.fm about: the most played ones, up to `limit`.
export function topArtists(summary, limit) {
  return [...summary.artists.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}
