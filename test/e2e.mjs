// End-to-end test in real Chrome: installs dist/chrome, clicks the toolbar action on a fixture
// page, selects a sentence and checks what gets highlighted.
//
//   npm run build && npm run test:e2e
//
// The first run downloads the English model (23 MB) into test/artifacts/chrome-profile.
// Opt-in extras:
//   OLLAMA_TEST_URL=http://127.0.0.1:11434  the same ranking through an Ollama server
//                                            (started with OLLAMA_ORIGINS=chrome-extension://*)
//   E2E_MULTILINGUAL=1                       the multilingual model (118 MB) matches Hebrew to English

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import {
  checker, describeRanking, indexed, installExtension, selectFirstSentence, serveFixtures, setSettings, topicsOf, waitFor,
} from './helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test/artifacts');
await mkdir(artifacts, { recursive: true });
const { server, base } = await serveFixtures(root);
const { check, finish } = checker();

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: true, // branded Chrome ignores --load-extension; installExtension below
  userDataDir: join(artifacts, 'chrome-profile'), // keeps the model cache between runs
  args: ['--no-first-run', '--window-size=1280,1600'],
});
let extension;

async function turnOnAndIndex(page, timeout) {
  await page.triggerExtensionAction(extension);
  return indexed(page, timeout);
}

try {
  extension = await installExtension(browser, join(root, 'dist/chrome'));
  await setSettings(browser, extension, null);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  await page.goto(`${base}/article.html`);

  let index;
  await check('the toolbar action turns it on and the page gets indexed', async () => {
    const started = Date.now();
    index = await turnOnAndIndex(page);
    console.log(`     ${index.sentences.length} sentences in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  });

  await check('hidden text, code blocks and short lines are left out', async () => {
    assert.equal(index.sentences.length, 15, `got:\n       ${index.sentences.join('\n       ')}`);
  });

  let painted;
  await check('selecting a sentence paints the related ones', async () => {
    painted = await selectFirstSentence(page);
    assert.ok(painted.related.length > 0);
  });

  await check('the closest matches are about the same topic', async () => {
    console.log(`     ranking: ${await describeRanking(page, painted)}`);
    const topics = await topicsOf(page, painted.related);
    assert.ok(!topics.includes('hidden'), 'a hidden sentence was highlighted');
    // The five other bread sentences come first, and count as related.
    assert.deepEqual(topics.slice(0, 5), ['bread', 'bread', 'bread', 'bread', 'bread']);
    assert.ok(!topics.includes('mars'), 'a Mars sentence counted as related');
  });

  await check('highlights are registered and the selected sentence is not among the related', async () => {
    const counts = await page.evaluate(() =>
      Object.fromEntries([...CSS.highlights.entries()].map(([name, h]) => [name, h.size])),
    );
    console.log(`     ${JSON.stringify(counts)}`);
    assert.equal(counts['semhl-source'], 1);
    const warm = [3, 4, 5, 6, 7].reduce((n, b) => n + counts[`semhl-${b}`], 0);
    assert.equal(warm, painted.related.length, 'every related sentence is painted in a warm color');
    assert.ok(!painted.related.some((t) => t.startsWith('A sourdough starter')));
  });

  await page.screenshot({ path: join(artifacts, 'chrome-painted.png') });

  await check('the next button focuses the best match, and the minimap marks the related ones', async () => {
    const result = await page.evaluate(() => {
      const shadow = document.getElementById('semhl-host').shadowRoot;
      shadow.querySelector('.next').click();
      return {
        status: shadow.querySelector('.status').textContent,
        focused: CSS.highlights.get('semhl-focus').size,
        ticks: shadow.querySelectorAll('.tick').length,
      };
    });
    assert.equal(result.focused, 1);
    assert.match(result.status, /^1\/\d+ related/);
    assert.equal(result.ticks, painted.related.length + 1); // + the selection's own tick
  });

  await check('Escape clears the colors but leaves it on', async () => {
    await page.keyboard.press('Escape');
    const s = await waitFor(page, 'clearing', (st) => !st.query, 5_000);
    assert.equal(s.active, true);
    const sizes = await page.evaluate(() => [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0));
    assert.equal(sizes, 0);
  });

  await check('the toolbar action turns it off again', async () => {
    await page.triggerExtensionAction(extension);
    await page.waitForFunction(() => !document.getElementById('semhl-host'), { timeout: 5_000 });
    assert.deepEqual(await page.evaluate(() => [...CSS.highlights.keys()]), []);
  });

  await check('under a strict Content-Security-Policy the pill is styled and the page still paints', async () => {
    const strictPage = await browser.newPage();
    await strictPage.goto(`${base}/strict/article.html`);
    await turnOnAndIndex(strictPage, 30_000);
    const position = await strictPage.evaluate(
      () => getComputedStyle(document.getElementById('semhl-host').shadowRoot.querySelector('.pill')).position,
    );
    assert.equal(position, 'fixed');
    const s = await selectFirstSentence(strictPage);
    // The CSP also blocks the fixture's inline style="display:none", so one more bread sentence
    // is visible here and the relative scale shifts; only check that painting works.
    assert.ok(s.related.length >= 2, JSON.stringify({ related: s.related, sims: s.sims }));
    const bg = await strictPage.evaluate(() => getComputedStyle(document.body, '::highlight(semhl-7)').backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'the highlight colors did not load');
    await strictPage.screenshot({ path: join(artifacts, 'chrome-strict-csp.png') });
    await strictPage.close();
  });

  await check('the options page loads the settings and its model test works', async () => {
    const options = await browser.newPage();
    await options.setViewport({ width: 900, height: 1000 });
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await options.waitForFunction(() => document.querySelector('input[name=backend]:checked')?.value === 'browser');
    await options.click('#test');
    await options.waitForFunction(() => /^(Works|Failed|Not saved)/.test(document.getElementById('result').textContent), {
      timeout: 60_000,
    });
    const result = await options.$eval('#result', (el) => el.textContent);
    console.log(`     ${result}`);
    assert.match(result, /^Works: 384 dimensions/);
    await options.screenshot({ path: join(artifacts, 'chrome-options.png') });
    await options.close();
  });

  if (process.env.OLLAMA_TEST_URL) {
    await check(`through Ollama (${process.env.OLLAMA_TEST_URL}) the bread sentences still rank first`, async () => {
      await setSettings(browser, extension, {
        backend: 'ollama',
        ollamaUrl: process.env.OLLAMA_TEST_URL,
        ollamaModel: 'qwen3-embedding:0.6b',
      });
      const p = await browser.newPage();
      await p.goto(`${base}/article.html`);
      await turnOnAndIndex(p, 120_000);
      const s = await selectFirstSentence(p);
      console.log(`     ranking: ${await describeRanking(p, s)}`);
      assert.deepEqual((await topicsOf(p, s.related)).slice(0, 3), ['bread', 'bread', 'bread']);
      await p.close();
    });
  }

  if (process.env.E2E_MULTILINGUAL) {
    await check('the multilingual model finds the Hebrew translation of the selected sentence', async () => {
      await setSettings(browser, extension, { backend: 'browser', model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' });
      const p = await browser.newPage();
      await p.goto(`${base}/article.html`);
      await turnOnAndIndex(p, 600_000);
      const s = await selectFirstSentence(p);
      console.log(`     ranking: ${await describeRanking(p, s)}`);
      assert.match(s.related[0], /^מחמצת/);
      await p.close();
    });
  }
} finally {
  // The profile is reused between runs; leave it on the defaults.
  if (extension) await setSettings(browser, extension, null).catch(() => {});
  await browser.close();
  server.close();
}

finish();
