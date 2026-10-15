// Chrome's offscreen document: hosts the model for the service worker.

import { embed } from './engine.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen' || msg.type !== 'embed') return false;
  const onProgress = (percent) =>
    chrome.runtime.sendMessage({ type: 'offscreen-progress', requestId: msg.requestId, percent }).catch(() => {});
  embed(msg.settings, msg.texts, onProgress)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});
