// Similarity scores → heat bins. Pure functions, unit-tested in Node.

export const BINS = 8;
export const RELATED_FROM = 4; // bins at or above this (yellow and warmer) count as "related": minimap, jumping

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Scores are relative to the page: the less similar half shares the two cool bins, and
// the more similar half is spread over the warm ones up to the best match. `minSpan`
// keeps a page with nothing truly related from painting its best weak match deep red.
export function toBins(sims, { minSpan = 0.15 } = {}) {
  const valid = sims.filter((s) => s !== null);
  if (!valid.length) return sims.map(() => null);
  const sorted = [...valid].sort((x, y) => x - y);
  const min = sorted[0];
  const median = quantile(sorted, 0.5);
  const max = sorted[sorted.length - 1];
  const span = Math.max(max - median, minSpan);
  const warm = BINS - 2;
  return sims.map((s) => {
    if (s === null) return null;
    if (s <= median) return median > min && (s - min) / (median - min) >= 0.5 ? 1 : 0;
    return 2 + Math.min(warm - 1, Math.floor(((s - median) / span) * warm));
  });
}
