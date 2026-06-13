// Parcel lookahead search — pure ranking for the glossary autocomplete.
//
// Given the set of graphable parcels and a typed query, return the best
// matches ordered so that the things a user most likely meant float to the
// top. No DOM, no Three.js — the shell owns input handling and rendering of
// the results; this module only decides *what* matches and *in what order*.
//
// Ranking (lower rank = better match):
//   0  exact label match
//   1  label starts with the query
//   2  a word inside the label starts with the query ("front" → "Frontal …")
//   3  query appears somewhere in the label
//   4  query appears in the parcel id (e.g. "ifg", "dk.lh-…")
// Ties break alphabetically by label. Non-matches are dropped.

const WORD_SPLIT = /[^a-z0-9]+/i;

function rankParcel(parcel, q) {
  const label = (parcel.label ?? '').toLowerCase();
  const id = (parcel.id ?? '').toLowerCase();
  if (!label && !id) return null;

  if (label === q) return 0;
  if (label.startsWith(q)) return 1;

  const words = label.split(WORD_SPLIT);
  for (const w of words) {
    if (w && w.startsWith(q)) return 2;
  }

  if (label.includes(q)) return 3;
  if (id.includes(q)) return 4;
  return null;
}

/**
 * @param {Array<{id:string,label?:string,group?:string}>} parcels
 * @param {string} query
 * @param {{limit?:number}} [opts]
 * @returns {Array} matching parcels in ranked order (capped at opts.limit)
 */
export function searchParcels(parcels, query, { limit = 8 } = {}) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [];
  if (!Array.isArray(parcels)) return [];

  const scored = [];
  for (const parcel of parcels) {
    if (!parcel) continue;
    const rank = rankParcel(parcel, q);
    if (rank === null) continue;
    scored.push({ parcel, rank });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.parcel.label ?? '').localeCompare(b.parcel.label ?? '');
  });

  const out = scored.map((s) => s.parcel);
  return limit > 0 ? out.slice(0, limit) : out;
}
