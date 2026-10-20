// Injected into a tab when the highlighter is turned on there. Indexes the page's sentences,
// embeds each selection and paints the page by similarity with the CSS Highlight API, which
// leaves the page's DOM untouched.

import { api, loadSettings, modelKey } from '../settings.js';
import { collectSentences, rangesOverlap } from './segment.js';
import { BINS, COOL_BINS, RELATED_FROM, dot, toBins } from './score.js';
import { HEAT, SOURCE, rgba } from './colors.js';
import { HOST_ID, mountUi } from './ui.js';

const BATCH = 16;
const NAMES = [...Array(BINS).keys()].map((i) => `semhl-${i}`).concat('semhl-source', 'semhl-focus');

let settings = null;
let active = false;
let ui = null;
let observer = null;

let sentences = []; // [{ text, range }]
const vectors = new Map(); // sentence text → Float32Array
let vectorKey = null; // which model made `vectors`
let query = null; // { text, range, vec }
let related = []; // indexes into `sentences`, best match first
let lastSims = [];
let cursor = -1;

let indexing = false;
let reindexWanted = false;
let progress = { done: 0, total: 0 };
let modelPercent = null;
let error = null;

const highlights = NAMES.map(() => new Highlight());
const [sourceHl, focusHl] = highlights.slice(BINS);
sourceHl.priority = 1;
focusHl.priority = 2;

// ---- embedding -------------------------------------------------------------------------

async function embed(texts) {
  const res = await api.runtime.sendMessage({ type: 'embed', texts });
  if (!res?.ok) throw new Error(res?.error ?? 'The extension did not answer.');
  if (res.key !== vectorKey) {
    // The model changed in the options: old vectors are in another space.
    if (vectors.size) reindexWanted = true;
    vectors.clear();
    vectorKey = res.key;
  }
  modelPercent = null;
  return texts.map((_, i) => Float32Array.from(res.data.slice(i * res.dims, (i + 1) * res.dims)));
}

async function index() {
  if (indexing) {
    reindexWanted = true;
    return;
  }
  indexing = true;
  try {
    do {
      reindexWanted = false;
      sentences = collectSentences(document.body, {
        minChars: settings.minChars,
        isExcluded: (el) => el.id === HOST_ID,
      });
      const texts = [...new Set(sentences.map((s) => s.text))];
      const todo = texts.filter((t) => !vectors.has(t));
      progress = { done: texts.length - todo.length, total: texts.length };
      updateStatus();
      for (let i = 0; i < todo.length && active && !reindexWanted; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const vecs = await embed(batch);
        batch.forEach((t, j) => vectors.set(t, vecs[j]));
        progress.done += batch.length;
        if (query?.vec) scheduleRender();
        updateStatus();
      }
    } while (reindexWanted && active);
    error = null;
    if (query?.vec) render();
  } catch (err) {
    error = err.message;
  } finally {
    indexing = false;
    updateStatus();
  }
}

// ---- painting --------------------------------------------------------------------------

function clearPaint() {
  highlights.forEach((h) => h.clear());
  related = [];
  cursor = -1;
  ui?.setTicks([]);
}

let renderTimer = null;
function scheduleRender() {
  renderTimer ??= setTimeout(() => {
    renderTimer = null;
    render();
  }, 400);
}

function render() {
  clearPaint();
  if (!query?.vec) return updateStatus();
  const sims = sentences.map((s) => {
    if (query.range && rangesOverlap(s.range, query.range)) {
      sourceHl.add(s.range);
      return null;
    }
    const v = vectors.get(s.text);
    return v ? dot(v, query.vec) : null;
  });
  lastSims = sims;
  const bins = toBins(sims);
  bins.forEach((bin, i) => {
    if (bin === null || (bin < COOL_BINS && !settings.showUnrelated)) return;
    highlights[bin].add(sentences[i].range);
  });
  related = bins
    .map((bin, i) => (bin >= RELATED_FROM ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => sims[b] - sims[a]);
  drawMinimap(bins, sims);
  updateStatus();
}

function drawMinimap(bins, sims) {
  const height = Math.max(document.documentElement.scrollHeight, 1);
  const fraction = (range) => {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return Math.min(1, Math.max(0, (rect.top + scrollY) / height));
  };
  const ticks = [];
  related.forEach((i) => {
    const f = fraction(sentences[i].range);
    if (f !== null) {
      ticks.push({ fraction: f, color: rgba(HEAT[bins[i]], 1), index: i, title: `${sims[i].toFixed(2)} · ${sentences[i].text}` });
    }
  });
  const f = query.range && fraction(query.range);
  if (f !== null && f !== undefined) ticks.push({ fraction: f, color: rgba(SOURCE, 1), title: 'Your selection' });
  ui.setTicks(ticks);
}

function focusSentence(i) {
  focusHl.clear();
  const { range } = sentences[i];
  focusHl.add(range);
  const el = range.startContainer.parentElement;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function step(delta) {
  if (!related.length) return;
  cursor = (cursor + delta + related.length) % related.length;
  focusSentence(related[cursor]);
  updateStatus();
}

// ---- status ----------------------------------------------------------------------------

function updateStatus() {
  if (!ui) return;
  let text;
  let nav = false;
  if (error) text = `⚠ ${error}`;
  else if (modelPercent !== null) text = `Downloading the model… ${modelPercent}%`;
  else if (query && !query.vec) text = 'Reading your query…';
  else if (indexing && !query) text = `Reading the page… ${progress.done}/${progress.total}`;
  else if (!query) text = '';
  else {
    const reading = indexing ? ` · reading ${progress.done}/${progress.total}` : '';
    nav = related.length > 0;
    text = nav
      ? `${cursor >= 0 ? `${cursor + 1}/` : ''}${related.length} related${reading}`
      : `Nothing closely related${reading}`;
  }
  ui.setStatus(text, nav);
  // Read by the end-to-end test; cheap enough to keep.
  ui.host.dataset.state = JSON.stringify({
    active,
    indexing,
    progress,
    error,
    sentences: sentences.map((s) => s.text),
    query: query?.text ?? null,
    related: related.map((i) => sentences[i].text),
    sims: related.map((i) => Number(lastSims[i].toFixed(3))),
    allSims: lastSims.map((x) => (x === null ? null : Number(x.toFixed(3)))),
  });
}

// ---- selection -------------------------------------------------------------------------

function selectionInsideUs(sel) {
  const node = sel.anchorNode;
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return !el || el.closest(`#${HOST_ID}`) || el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
}

function highlightSelection() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || selectionInsideUs(sel)) return;
  return runQuery(sel.toString(), sel.getRangeAt(0).cloneRange());
}

// `range` is where the query sits on the page (a selection), or null for a typed query.
async function runQuery(raw, range) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 2 || (text === query?.text && !range === !query.range)) return;
  query = { text, range, vec: null };
  clearPaint();
  lastSims = [];
  ui?.setQuery(text);
  updateStatus();
  try {
    const [vec] = await embed([text]);
    if (query?.text !== text) return; // a newer query took over
    query.vec = vec;
    error = null;
    if (reindexWanted) index();
    render();
  } catch (err) {
    error = err.message;
    updateStatus();
  }
}

let selectTimer = null;
function onPointerOrKeyUp(e) {
  if (!active || !settings.autoOnSelect || e.composedPath().some((n) => n.id === HOST_ID)) return;
  clearTimeout(selectTimer);
  selectTimer = setTimeout(highlightSelection, 250);
}

function onKeyDown(e) {
  if (active && e.key === 'Escape' && query) {
    query = null;
    clearPaint();
    ui.setQuery('');
    updateStatus();
  }
}

// ---- on / off --------------------------------------------------------------------------

let mutationTimer = null;
function onMutations() {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(index, 1500);
}

// `focusBox` puts the cursor in the search box: the toolbar button and the search hotkey do.
async function activate({ focusBox = false } = {}) {
  if (active) {
    if (focusBox) ui.focusQuery();
    return;
  }
  settings = await loadSettings();
  active = true;
  NAMES.forEach((name, i) => CSS.highlights.set(name, highlights[i]));
  ui = mountUi({
    onQuery: (text) => runQuery(text, null),
    onPrev: () => step(-1),
    onNext: () => step(1),
    onClose: deactivate,
    onTick: (i) => {
      cursor = related.indexOf(i);
      focusSentence(i);
      updateStatus();
    },
  });
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('mouseup', onPointerOrKeyUp, true);
  document.addEventListener('keyup', onPointerOrKeyUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  api.runtime.sendMessage({ type: 'state', active: true });
  index();
  // Read a selection already on the page before focusing the box can disturb it.
  if (settings.autoOnSelect) highlightSelection();
  if (focusBox) ui.focusQuery();
}

function deactivate() {
  if (!active) return;
  active = false;
  query = null;
  clearPaint();
  NAMES.forEach((name) => CSS.highlights.delete(name));
  observer.disconnect();
  clearTimeout(mutationTimer);
  document.removeEventListener('mouseup', onPointerOrKeyUp, true);
  document.removeEventListener('keyup', onPointerOrKeyUp, true);
  document.removeEventListener('keydown', onKeyDown, true);
  ui.remove();
  ui = null;
  api.runtime.sendMessage({ type: 'state', active: false });
}

if (!globalThis.__semhlLoaded) {
  globalThis.__semhlLoaded = true;

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'ping') sendResponse({ ok: true });
    else if (msg.type === 'toggle') (active ? deactivate() : activate({ focusBox: true }));
    else if (msg.type === 'focus-box') activate({ focusBox: true });
    else if (msg.type === 'highlight-selection') activate().then(highlightSelection);
    else if (msg.type === 'model-progress') {
      modelPercent = msg.percent < 100 ? msg.percent : null;
      updateStatus();
    }
    return false;
  });

  // Only in the firefox-test build (see build.mjs); compiled out everywhere else.
  if (__TEST_HOOKS__) {
    window.addEventListener('semhl-test-toggle', () => (active ? deactivate() : activate({ focusBox: true })));
    window.addEventListener('semhl-test-focus-box', () => activate({ focusBox: true }));
  }

  api.storage.onChanged.addListener(async () => {
    if (!active) return;
    const before = settings;
    settings = await loadSettings();
    if (modelKey(before) !== modelKey(settings)) {
      // Another embedding space: re-read the page and the selection with the new model.
      const selection = query;
      vectors.clear();
      query = null;
      clearPaint();
      index();
      if (selection) {
        query = { ...selection, vec: null };
        updateStatus();
        embed([selection.text]).then(([vec]) => {
          if (query?.text === selection.text) {
            query.vec = vec;
            render();
          }
        }, (err) => {
          error = err.message;
          updateStatus();
        });
      }
    } else if (before.minChars !== settings.minChars) index();
    else render();
  });
}
