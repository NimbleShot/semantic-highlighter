// End-to-end test in real Chrome: loads dist/chrome, clicks the toolbar action on a fixture
// page, selects a sentence and checks what gets highlighted.
// `npm run build && npm run test:e2e`. The first run downloads the model (~23 MB).

import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test/artifacts');
await mkdir(artifacts, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    // /strict/… serves the same fixture under a strict Content-Security-Policy, like GitHub's.
    const strict = req.url.startsWith('/strict/');
    const file = req.url.replace(/^\/(strict\/)?/, '') || 'article.html';
    const body = await readFile(join(root, 'test/fixtures', file));
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (strict) headers['content-security-policy'] = "default-src 'self'; style-src 'self'; script-src 'self'";
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: true, // branded Chrome ignores --load-extension; installExtension below
  userDataDir: join(artifacts, 'chrome-profile'), // keeps the model cache between runs
  args: ['--no-first-run', '--window-size=1280,1600'],
});

const state = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('semhl-host');
    return host ? JSON.parse(host.dataset.state ?? 'null') : null;
  });

async function waitFor(page, what, predicate, timeout = 180_000) {
  const started = Date.now();
  for (;;) {
    const s = await state(page);
    if (s && predicate(s)) return s;
    if (s?.error) throw new Error(`${what}: extension reported "${s.error}"`);
    if (Date.now() - started > timeout) throw new Error(`${what}: timed out; last state ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

try {
  const id = await browser.installExtension(join(root, 'dist/chrome'));
  const extension = (await browser.extensions()).get(id);
  assert.ok(extension, 'extension not loaded');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  await page.goto(`${base}/article.html`);

  let indexed;
  await check('the toolbar action turns it on and the page gets indexed', async () => {
    await page.triggerExtensionAction(extension);
    const started = Date.now();
    indexed = await waitFor(page, 'indexing', (s) => !s.indexing && s.progress.total > 0 && s.progress.done === s.progress.total);
    console.log(`     ${indexed.sentences.length} sentences in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  });

  await check('hidden text, code blocks and short lines are left out', async () => {
    assert.equal(indexed.sentences.length, 15, `got:\n       ${indexed.sentences.join('\n       ')}`);
  });

  let painted;
  await check('selecting a sentence paints the related ones', async () => {
    await page.evaluate(() => {
      const text = document.getElementById('first').firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, text.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    painted = await waitFor(page, 'painting', (s) => s.query && s.related.length > 0, 30_000);
  });

  await check('the closest matches are about the same topic', async () => {
    const topics = await page.evaluate((texts) => {
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      const topicOf = (t) => {
        for (const topic of ['bread', 'mars', 'hidden']) {
          if ([...document.querySelectorAll(`.${topic}`)].some((el) => norm(el.textContent).includes(t))) return topic;
        }
        return 'other';
      };
      return texts.map(topicOf);
    }, painted.related);
    console.log(`     related, best first: ${topics.map((t, i) => `${t} ${painted.sims[i]}`).join(', ')}`);
    const all = await page.evaluate((texts) => {
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      return texts.map((t) => ['bread', 'mars', 'hidden'].find((c) => [...document.querySelectorAll(`.${c}`)].some((el) => norm(el.textContent).includes(t))) ?? 'other');
    }, painted.sentences);
    console.log('     all: ' + painted.allSims.map((x, i) => [x, all[i]]).filter(([x]) => x !== null).sort((a, b) => b[0] - a[0]).map(([x, t]) => `${t} ${x}`).join(', '));
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
    assert.ok(counts['semhl-7'] >= 1);
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
    const names = await page.evaluate(() => [...CSS.highlights.keys()]);
    assert.deepEqual(names, []);
  });

  await check('under a strict Content-Security-Policy the pill is styled and the page still paints', async () => {
    const strictPage = await browser.newPage();
    await strictPage.goto(`${base}/strict/article.html`);
    await strictPage.triggerExtensionAction(extension);
    await waitFor(strictPage, 'indexing', (s) => !s.indexing && s.progress.total > 0 && s.progress.done === s.progress.total, 30_000);
    const position = await strictPage.evaluate(
      () => getComputedStyle(document.getElementById('semhl-host').shadowRoot.querySelector('.pill')).position,
    );
    assert.equal(position, 'fixed');
    await strictPage.evaluate(() => {
      const text = document.getElementById('first').firstChild;
      getSelection().selectAllChildren(text.parentElement);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const s = await waitFor(strictPage, 'painting', (st) => st.query && st.related.length > 0, 30_000);
    // The CSP also blocks the fixture's inline style="display:none", so one more bread sentence
    // is visible here and the relative scale shifts; only check that painting works.
    assert.ok(s.related.length >= 2, JSON.stringify({ related: s.related, sims: s.sims }));
    const bg = await strictPage.evaluate(() => getComputedStyle(document.body, '::highlight(semhl-7)').backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'the highlight colors did not load');
    await strictPage.screenshot({ path: join(artifacts, 'chrome-strict-csp.png') });
    await strictPage.close();
  });
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
