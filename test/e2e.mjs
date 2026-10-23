// End-to-end test in real Chrome: installs dist/chrome, clicks the toolbar action on a fixture
// page, selects a sentence and checks what gets highlighted.
//
//   npm run build && npm run test:e2e
//
// Each run installs the extension fresh, so it downloads the English model (23 MB) again.
// Opt-in extras:
//   OLLAMA_TEST_URL=http://127.0.0.1:11434  the same ranking through an Ollama server
//                                            (started with OLLAMA_ORIGINS=chrome-extension://*)
//   E2E_MULTILINGUAL=1                       the multilingual model (118 MB) matches Hebrew to English

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import {
  backgroundWorker, boxFocused, checker, describeRanking, indexed, installExtension, selectFirstSentence, serveFixtures, setSettings,
  topicsOf, typeQuery, waitFor,
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
  userDataDir: join(artifacts, 'chrome-profile'),
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

  // Puppeteer's key events go to the page, not to the browser's shortcut handling, so a shortcut
  // is "pressed" by calling the handler the browser calls for it.
  const pressSearchShortcut = async () => {
    const worker = await backgroundWorker(browser, extension);
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await globalThis.semhlCommand('search-by-meaning', tab.id);
    }, `${base}/article.html`);
  };

  await check('Chrome bound the search shortcut to Ctrl+Shift+F, and nothing uses Alt', async () => {
    const worker = await backgroundWorker(browser, extension);
    const { commands, title } = await worker.evaluate(async () => ({
      commands: await chrome.commands.getAll(),
      title: await chrome.action.getTitle({}),
    }));
    const keys = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
    console.log(`     ${JSON.stringify(keys)} · toolbar tooltip "${title}"`);
    assert.equal(keys['search-by-meaning'], 'Ctrl+Shift+F');
    assert.ok(Object.values(keys).every((k) => !/Alt/.test(k)), 'a shortcut uses Alt');
    assert.match(title, /Ctrl\+Shift\+F/);
  });

  let index;
  await check('the toolbar action turns it on and the page gets indexed', async () => {
    const started = Date.now();
    index = await turnOnAndIndex(page);
    console.log(`     ${index.sentences.length} sentences in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  });

  await check('the toolbar action leaves the cursor in the search box', async () => {
    assert.equal(await boxFocused(page), true);
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

  await check('the search hotkey focuses the box, and a typed idea paints the page', async () => {
    await page.evaluate(() => document.getElementById('semhl-host').shadowRoot.activeElement?.blur());
    assert.equal(await boxFocused(page), false);
    await pressSearchShortcut();
    await page.waitForFunction(() => document.getElementById('semhl-host').shadowRoot.activeElement, { timeout: 5_000 });
    assert.equal(await boxFocused(page), true);

    const keysBefore = await page.evaluate(() => window.pageKeys);
    const typed = await typeQuery(page, 'kneading and baking a loaf');
    console.log(`     ranking: ${await describeRanking(page, typed)}`);
    const topics = await topicsOf(page, typed.related);
    assert.deepEqual(topics.slice(0, 3), ['bread', 'bread', 'bread']);
    assert.ok(!topics.includes('mars'), 'a Mars sentence counted as related');
    const result = await page.evaluate(() => ({
      source: CSS.highlights.get('semhl-source').size,
      ticks: document.getElementById('semhl-host').shadowRoot.querySelectorAll('.tick').length,
      keys: window.pageKeys,
    }));
    assert.equal(result.source, 0, 'a typed query has no place on the page to mark');
    assert.equal(result.ticks, typed.related.length);
    assert.equal(result.keys, keysBefore, 'keys typed in the box reached the page');
    await page.screenshot({ path: join(artifacts, 'chrome-typed-query.png') });
  });

  await check('a selection shows up in the box, ready to edit', async () => {
    await page.evaluate(() => document.getElementById('semhl-host').shadowRoot.activeElement?.blur());
    await selectFirstSentence(page);
    const value = await page.evaluate(() => document.getElementById('semhl-host').shadowRoot.querySelector('.query').value);
    assert.match(value, /^A sourdough starter is a living culture/);
  });

  await check('the search shortcut, pressed again in the box, turns it off', async () => {
    await pressSearchShortcut();
    await page.waitForFunction(() => document.getElementById('semhl-host').shadowRoot.activeElement, { timeout: 5_000 });
    await pressSearchShortcut();
    await page.waitForFunction(() => !document.getElementById('semhl-host'), { timeout: 5_000 });
    assert.deepEqual(await page.evaluate(() => [...CSS.highlights.keys()]), []);
  });

  await check('the toolbar action turns it on and off again', async () => {
    await page.triggerExtensionAction(extension);
    await page.waitForFunction(() => document.getElementById('semhl-host'), { timeout: 5_000 });
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
