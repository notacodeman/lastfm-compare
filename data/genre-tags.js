// Last.fm has no genre field, so genres come from artists' top tags. Tags are typed by listeners,
// so some aren't genres at all. This file lists those, and spellings that mean the same genre.

// Tags that say nothing about the music's genre. Decades and years ("80s", "2010s", "1999") are skipped in code.
export const NOT_GENRES = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'favorite artists', 'favourite artists',
  'my favorite', 'love', 'loved', 'awesome', 'beautiful', 'amazing', 'cool', 'good', 'great', 'best',
  'spotify', 'under 2000 listeners', 'all', 'albums i own', 'check out', 'cover', 'covers',
  'female vocalists', 'male vocalists', 'female vocalist', 'male vocalist', 'female', 'male',
  'singer-songwriter-ish',
  'usa', 'american', 'us', 'united states', 'uk', 'british', 'english', 'england', 'canadian', 'canada',
  'australian', 'australia', 'german', 'germany', 'french', 'france', 'swedish', 'sweden', 'japanese',
  'japan', 'korean', 'irish', 'scottish', 'dutch', 'norwegian', 'finnish', 'italian', 'spanish',
  'brazilian', 'mexican', 'russian', 'polish', 'belgian', 'danish', 'new zealand', 'nz',
  'london', 'new york', 'los angeles', 'chicago', 'detroit', 'bristol', 'manchester', 'berlin',
]);

// Different spellings of one genre -> the name shown.
export const GENRE_ALIASES = {
  'hiphop': 'hip hop', 'hip-hop': 'hip hop',
  'dnb': 'drum and bass', 'drum n bass': 'drum and bass', 'drum & bass': 'drum and bass', 'drum n\' bass': 'drum and bass', 'd&b': 'drum and bass',
  'rnb': 'r&b', 'rhythm and blues': 'r&b',
  'electronica': 'electronic', 'electro': 'electronic',
  'post rock': 'post-rock', 'post punk': 'post-punk', 'synth pop': 'synthpop', 'synth-pop': 'synthpop',
  'lo-fi': 'lofi', 'lo fi': 'lofi', 'trip hop': 'trip-hop', 'alt rock': 'alternative rock',
  'alternative': 'alternative rock', 'soundtracks': 'soundtrack', 'ost': 'soundtrack',
};
