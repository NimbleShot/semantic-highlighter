// Shared by the end-to-end tests and the benchmark.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Serves test/fixtures. /strict/… serves the same files under a strict Content-Security-Policy.
export async function serveFixtures(root) {
  const server = createServer(async (req, res) => {
    try {
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
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const isWorkerOf = (id) => (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`);

// The extension's background service worker, as Puppeteer can evaluate in it. Chrome only.
export async function backgroundWorker(browser, extension) {
  return (await browser.waitForTarget(isWorkerOf(extension.id))).worker();
}

// Installs the unpacked extension in Chrome, fresh, and waits until Chrome lists it. The test
// profile is reused between runs, and installing over an earlier install of the same folder keeps
// running the old service worker, so any earlier install is removed first. That also clears the
// cached model: each run downloads it again.
export async function installExtension(browser, dir) {
  await browser.uninstallExtension(await browser.installExtension(dir));
  const id = await browser.installExtension(dir);
  for (let tries = 0; tries < 50; tries++) {
    const extension = (await browser.extensions()).get(id);
    if (extension) return extension;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`extension ${id} was installed but never listed`);
}

// Resets the extension's settings (or sets some) through its service worker. Chrome only.
export async function setSettings(browser, extension, values) {
  const worker = await backgroundWorker(browser, extension);
  await worker.evaluate((v) => (v ? chrome.storage.local.set(v) : chrome.storage.local.clear()), values);
}

// The content script mirrors its state into a data attribute on its host element.
export const state = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('semhl-host');
    return host ? JSON.parse(host.dataset.state ?? 'null') : null;
  });

export async function waitFor(page, what, predicate, timeout = 180_000) {
  const started = Date.now();
  for (;;) {
    const s = await state(page);
    if (s && predicate(s)) return s;
    if (s?.error) throw new Error(`${what}: extension reported "${s.error}"`);
    if (Date.now() - started > timeout) throw new Error(`${what}: timed out; last state ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export const indexed = (page, timeout) =>
  waitFor(page, 'indexing', (s) => !s.indexing && s.progress.total > 0 && s.progress.done === s.progress.total, timeout);

// Selects the fixture's first sentence the way a mouse drag would, and waits for the paint.
export async function selectFirstSentence(page) {
  await page.evaluate(() => {
    getSelection().selectAllChildren(document.getElementById('first'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  return waitFor(page, 'painting', (s) => s.query?.startsWith('A sourdough starter') && s.allSims.length > 0, 60_000);
}

// Whether the keyboard focus is in the pill's search box.
export const boxFocused = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('semhl-host');
    return document.activeElement === host && host.shadowRoot.activeElement?.className === 'query';
  });

// Types into the focused search box, presses Enter, and waits for the paint.
export async function typeQuery(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  return waitFor(page, 'painting the typed query', (s) => s.query === text && s.allSims.length > 0, 60_000);
}

// Which fixture topic each sentence belongs to: bread, mars, hidden, or other.
export const topicsOf = (page, texts) =>
  page.evaluate((list) => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const inClass = (c, t) => [...document.querySelectorAll(`.${c}`)].some((el) => norm(el.textContent).includes(t));
    return list.map((t) => ['bread', 'mars', 'hidden'].find((c) => inClass(c, t)) ?? 'other');
  }, texts);

export async function describeRanking(page, painted) {
  const topics = await topicsOf(page, painted.sentences);
  return painted.allSims
    .map((sim, i) => [sim, topics[i]])
    .filter(([sim]) => sim !== null)
    .sort((a, b) => b[0] - a[0])
    .map(([sim, topic]) => `${topic} ${sim}`)
    .join(', ');
}

// A tiny runner: prints ok/FAIL per check and keeps going.
export function checker() {
  let failures = 0;
  return {
    async check(name, fn) {
      try {
        await fn();
        console.log(`ok   ${name}`);
      } catch (err) {
        failures++;
        console.log(`FAIL ${name}\n     ${err.message}`);
      }
    },
    finish() {
      console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
      process.exit(failures ? 1 : 0);
    },
  };
}
