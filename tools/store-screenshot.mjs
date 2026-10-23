// Takes the store screenshot of the search box: Wikipedia's Sourdough article at 1280×800, a
// typed query, scrolled to its best match. Needs `npm run build` and the installed Chrome.
//   node tools/store-screenshot.mjs [query]

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { indexed, installExtension, typeQuery } from '../test/helpers.mjs';

const query = process.argv[2] ?? 'how often should I feed my starter';
const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test/artifacts');
await mkdir(artifacts, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: join(artifacts, 'chrome-profile'),
  args: ['--no-first-run', '--hide-scrollbars'],
});
try {
  const extension = await installExtension(browser, join(root, 'dist/chrome'));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://en.wikipedia.org/wiki/Sourdough', { waitUntil: 'networkidle2' });
  await page.triggerExtensionAction(extension);
  await indexed(page);
  const painted = await typeQuery(page, query);
  console.log(`${painted.related.length} related; best: ${painted.related[0]}`);
  // Jump to the best match, then give the smooth scroll time to settle.
  await page.evaluate(() => document.getElementById('semhl-host').shadowRoot.querySelector('.next').click());
  await new Promise((r) => setTimeout(r, 1500));
  const file = join(root, 'store/screenshots/search-box.png');
  await page.screenshot({ path: file });
  console.log(file);
} finally {
  await browser.close();
}
