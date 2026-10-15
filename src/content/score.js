// Similarity scores → heat bins. Pure functions, unit-tested in Node.
//
// Scores are judged against the rest of the page, not on an absolute scale: each one becomes a
// robust z-score, (score − median) / (1.4826 · MAD), so it says how unusually close a sentence
// is compared with a typical sentence on this page. That works the same on a page mixing two
// subjects (the matching subject stands out from the median) and on a page about one subject
// (only the sentences closest to the selection stand out). It is also model-independent: MiniLM
// and Qwen produce very differently spread scores.

export const BINS = 8;
export const COOL_BINS = 3; // bins 0–2 are shades of "unrelated"; warm bins from here on are "related"
export const RELATED_FROM = COOL_BINS;

const WARM_FROM_Z = 1; // a sentence this many deviations above typical starts to count as related
const Z_PER_WARM_BIN = 0.75;
const MIN_SIGMA = 0.05; // when all scores are nearly equal, small differences mean nothing

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function zScores(sims) {
  const valid = sims.filter((s) => s !== null).sort((x, y) => x - y);
  if (!valid.length) return sims.map(() => null);
  const med = median(valid);
  const mad = median(valid.map((s) => Math.abs(s - med)).sort((x, y) => x - y));
  const sigma = Math.max(1.4826 * mad, MIN_SIGMA);
  return sims.map((s) => (s === null ? null : (s - med) / sigma));
}

export function toBins(sims) {
  return zScores(sims).map((z) => {
    if (z === null) return null;
    if (z < -0.5) return 0;
    if (z < 0.5) return 1;
    if (z < WARM_FROM_Z) return 2;
    return Math.min(BINS - 1, COOL_BINS + Math.floor((z - WARM_FROM_Z) / Z_PER_WARM_BIN));
  });
}
