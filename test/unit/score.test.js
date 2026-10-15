import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINS, toBins, dot } from '../../src/content/score.js';

test('dot of unit vectors', () => {
  assert.equal(dot([1, 0], [0, 1]), 0);
  assert.equal(dot([0.6, 0.8], [0.6, 0.8]).toFixed(6), '1.000000');
});

test('the best match gets the warmest bin, the worst the coolest', () => {
  const bins = toBins([0.1, 0.2, 0.3, 0.4, 0.9]);
  assert.equal(bins[4], BINS - 1);
  assert.equal(bins[0], 0);
  assert.ok(bins.every((b) => b >= 0 && b < BINS));
});

test('bins rise with similarity', () => {
  const sims = Array.from({ length: 50 }, (_, i) => i / 50);
  const bins = toBins(sims);
  for (let i = 1; i < bins.length; i++) assert.ok(bins[i] >= bins[i - 1]);
});

test('the less similar half stays in the two cool bins', () => {
  const sims = Array.from({ length: 101 }, (_, i) => i / 100);
  const bins = toBins(sims);
  assert.ok(bins.slice(0, 51).every((b) => b <= 1));
  assert.ok(bins.slice(51).every((b) => b >= 2));
});

test('a page with nothing truly related is not painted deep red', () => {
  // Everything within 0.05 of the median: the best match stays mid-scale.
  const bins = toBins([0.2, 0.21, 0.22, 0.23, 0.25]);
  assert.ok(bins[4] < BINS - 2, `got ${bins[4]}`);
});

test('missing scores stay missing', () => {
  assert.deepEqual(toBins([null, null]), [null, null]);
  const bins = toBins([null, 0.5, 0.1]);
  assert.equal(bins[0], null);
});
