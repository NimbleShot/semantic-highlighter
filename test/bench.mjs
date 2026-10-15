// Measures the highlighter on a real page: how many sentences, how long indexing takes,
// and what the best matches for one of its sentences are.
// `node test/bench.mjs <url> [sentence index to select, default 10]`

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [url, pick = '10'] = process.argv.slice(2);
if (!url) {
  console.error('usage: node test/bench.mjs <url> [sentence index]');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test/artifacts');
await mkdir(artifacts, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: join(artifacts, 'chrome-profile'),
  args: ['--no-first-run'],
});
const state = (page) => page.evaluate(() => JSON.parse(document.getElementById('semhl-host')?.dataset.state ?? 'null'));
async function until(page, predicate) {
  for (;;) {
    const s = await state(page);
    if (s?.error) throw new Error(s.error);
    if (s && predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
}

try {
  const extension = (await browser.extensions()).get(await browser.installExtension(join(root, 'dist/chrome')));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2' });

  let started = Date.now();
  await page.triggerExtensionAction(extension);
  const indexed = await until(page, (s) => !s.indexing && s.progress.total > 0 && s.progress.done === s.progress.total);
  const indexSeconds = (Date.now() - started) / 1000;
  console.log(`${indexed.sentences.length} sentences (${indexed.progress.total} unique) indexed in ${indexSeconds.toFixed(1)} s` +
    ` = ${((indexSeconds * 1000) / indexed.progress.total).toFixed(1)} ms each`);

  const target = indexed.sentences[Number(pick)];
  console.log(`\nselecting #${pick}: ${target}\n`);
  started = Date.now();
  await page.evaluate((text) => {
    // Find the sentence's text in the page and select it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const head = text.slice(0, 30);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.data.replace(/\s+/g, ' ').indexOf(head);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(n, n.data.indexOf(head.split(' ')[0]));
        range.setEnd(n, n.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        break;
      }
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, target);
  const painted = await until(page, (s) => s.query && (s.related.length > 0 || s.allSims?.length));
  console.log(`painted in ${((Date.now() - started) / 1000).toFixed(2)} s; ${painted.related.length} related:`);
  painted.related.slice(0, 8).forEach((t, i) => console.log(`  ${painted.sims[i].toFixed(2)}  ${t.slice(0, 110)}`));
  await page.screenshot({ path: join(artifacts, 'bench.png') });
  console.log(`\nscreenshot: ${join(artifacts, 'bench.png')}`);
} finally {
  await browser.close();
}
