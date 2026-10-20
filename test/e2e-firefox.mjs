// End-to-end test in real Firefox (WebDriver BiDi). Firefox's automation can't click the toolbar
// button, so this installs dist/firefox-test, which injects itself on 127.0.0.1 and is toggled
// by a DOM event; everything after that (the model in the background page, the WASM runtime,
// the Highlight API, the pill) is the same code as the real Firefox build.
//
//   npm run build && npm run test:e2e:firefox
//
// FIREFOX=/path/to/firefox overrides the binary (default: the snap's /snap/bin/firefox).

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import {
  boxFocused, checker, describeRanking, indexed, selectFirstSentence, serveFixtures, topicsOf, typeQuery, waitFor,
} from './helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test/artifacts');
// The snap can only read and write non-hidden folders under $HOME, which this path is.
const profile = join(artifacts, 'firefox-profile');
await mkdir(profile, { recursive: true });
const { server, base } = await serveFixtures(root);
const { check, finish } = checker();

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: process.env.FIREFOX ?? '/snap/bin/firefox',
  headless: true,
  userDataDir: profile, // keeps the model cache between runs
});

const toggle = (page) => page.evaluate(() => window.dispatchEvent(new Event('semhl-test-toggle')));

try {
  await browser.installExtension(join(root, 'dist/firefox-test'));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  await page.goto(`${base}/article.html`);
  await page.waitForFunction(() => document.readyState === 'complete');

  let index;
  await check('it turns on and the page gets indexed by the model in the background page', async () => {
    const started = Date.now();
    await toggle(page);
    index = await indexed(page);
    console.log(`     ${index.sentences.length} sentences in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    assert.equal(index.sentences.length, 15);
  });

  let painted;
  await check('selecting a sentence ranks the same-topic sentences first', async () => {
    painted = await selectFirstSentence(page);
    console.log(`     ranking: ${await describeRanking(page, painted)}`);
    const topics = await topicsOf(page, painted.related);
    assert.deepEqual(topics.slice(0, 5), ['bread', 'bread', 'bread', 'bread', 'bread']);
    assert.ok(!topics.includes('mars'));
  });

  await check('the highlights are registered from the content script', async () => {
    const counts = await page.evaluate(() =>
      Object.fromEntries([...CSS.highlights.entries()].map(([name, h]) => [name, h.size])),
    );
    console.log(`     ${JSON.stringify(counts)}`);
    assert.equal(counts['semhl-source'], 1);
    const warm = [3, 4, 5, 6, 7].reduce((n, b) => n + counts[`semhl-${b}`], 0);
    assert.equal(warm, painted.related.length);
  });

  await check('the pill is styled and its next button works', async () => {
    const result = await page.evaluate(() => {
      const shadow = document.getElementById('semhl-host').shadowRoot;
      shadow.querySelector('.next').click();
      return {
        position: getComputedStyle(shadow.querySelector('.pill')).position,
        status: shadow.querySelector('.status').textContent,
        focused: CSS.highlights.get('semhl-focus').size,
      };
    });
    assert.equal(result.position, 'fixed');
    assert.match(result.status, /^1\/\d+ related/);
    assert.equal(result.focused, 1);
  });

  await page.screenshot({ path: join(artifacts, 'firefox-painted.png') });

  await check('the search box takes a typed idea, and the page never sees the keys', async () => {
    await page.evaluate(() => document.getElementById('semhl-host').shadowRoot.activeElement?.blur());
    await page.evaluate(() => window.dispatchEvent(new Event('semhl-test-focus-box')));
    await page.waitForFunction(() => document.getElementById('semhl-host').shadowRoot.activeElement, { timeout: 5_000 });
    assert.equal(await boxFocused(page), true);
    const keysBefore = await page.evaluate(() => window.pageKeys);
    const typed = await typeQuery(page, 'kneading and baking a loaf');
    console.log(`     ranking: ${await describeRanking(page, typed)}`);
    const topics = await topicsOf(page, typed.related);
    assert.deepEqual(topics.slice(0, 3), ['bread', 'bread', 'bread']);
    assert.ok(!topics.includes('mars'));
    assert.equal(await page.evaluate(() => window.pageKeys), keysBefore, 'keys typed in the box reached the page');
    await page.screenshot({ path: join(artifacts, 'firefox-typed-query.png') });
  });

  await check('it turns off again', async () => {
    await toggle(page);
    await page.waitForFunction(() => !document.getElementById('semhl-host'), { timeout: 5_000 });
    assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
  });

  await check('under a strict Content-Security-Policy the pill is styled and the page still paints', async () => {
    const strictPage = await browser.newPage();
    await strictPage.goto(`${base}/strict/article.html`);
    await strictPage.waitForFunction(() => document.readyState === 'complete');
    await toggle(strictPage);
    await indexed(strictPage, 60_000);
    const s = await selectFirstSentence(strictPage);
    assert.ok(s.related.length >= 2);
    const position = await strictPage.evaluate(
      () => getComputedStyle(document.getElementById('semhl-host').shadowRoot.querySelector('.pill')).position,
    );
    assert.equal(position, 'fixed');
    await waitFor(strictPage, 'still on', (st) => st.active, 1_000);
    await strictPage.screenshot({ path: join(artifacts, 'firefox-strict-csp.png') });
    await strictPage.close();
  });
} finally {
  await browser.close();
  server.close();
}

finish();
