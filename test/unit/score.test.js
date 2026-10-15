import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINS, COOL_BINS, toBins, zScores, dot } from '../../src/content/score.js';

test('dot of unit vectors', () => {
  assert.equal(dot([1, 0], [0, 1]), 0);
  assert.equal(dot([0.6, 0.8], [0.6, 0.8]).toFixed(6), '1.000000');
});

test('bins rise with similarity and stay in range', () => {
  const sims = Array.from({ length: 50 }, (_, i) => i / 50);
  const bins = toBins(sims);
  for (let i = 1; i < bins.length; i++) assert.ok(bins[i] >= bins[i - 1]);
  assert.ok(bins.every((b) => b >= 0 && b < BINS));
});

test('a cluster on a mixed page is warm and the rest is cool', () => {
  // Scores the English model gave the test fixture: five bread sentences, the rest about Mars.
  const bread = [0.625, 0.512, 0.341, 0.288, 0.288];
  const rest = [0.202, 0.113, 0.099, 0.093, 0.031, 0.021, 0.02, -0.006, -0.013];
  const bins = toBins([...bread, ...rest]);
  assert.ok(bins.slice(0, 5).every((b) => b >= COOL_BINS), `bread: ${bins.slice(0, 5)}`);
  assert.ok(bins.slice(5).every((b) => b < COOL_BINS), `rest: ${bins.slice(5)}`);
});

test('on a page about one subject only the outliers are warm', () => {
  // Most sentences are moderately similar; three stand out.
  const sims = [...Array.from({ length: 40 }, (_, i) => 0.4 + (i % 10) / 100), 0.7, 0.75, 0.8];
  const bins = toBins(sims);
  assert.equal(bins.filter((b) => b >= COOL_BINS).length, 3);
  assert.equal(bins[bins.length - 1], BINS - 1);
});

test('a page with nothing truly related is not painted warm', () => {
  const bins = toBins([0.2, 0.21, 0.22, 0.23, 0.25]);
  assert.ok(bins.every((b) => b < COOL_BINS), `got ${bins}`);
});

test('missing scores stay missing', () => {
  assert.deepEqual(toBins([null, null]), [null, null]);
  assert.equal(zScores([null, 0.5, 0.1])[0], null);
});
