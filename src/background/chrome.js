// Chrome: the service worker can't run the model (no dynamic import, and it is stopped
// when idle), so the model lives in an offscreen document that stays warm.

import { setup } from './common.js';

let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url, reasons: ['WORKERS'], justification: 'Runs the local embedding model.' })
    .finally(() => (creating = null));
  await creating;
}

const progressListeners = new Map();
let nextRequest = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'offscreen-progress') progressListeners.get(msg.requestId)?.(msg.percent);
  return false;
});

async function embedTexts(settings, texts, onProgress) {
  await ensureOffscreen();
  const requestId = nextRequest++;
  progressListeners.set(requestId, onProgress);
  try {
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'embed', requestId, settings, texts });
    if (!res?.ok) throw new Error(res?.error ?? 'The model page did not answer.');
    return { dims: res.dims, data: res.data };
  } finally {
    progressListeners.delete(requestId);
  }
}

setup(embedTexts);
