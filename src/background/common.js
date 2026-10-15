// Background logic shared by Chrome and Firefox. Each browser supplies `embedTexts`,
// which runs the model where that browser allows it.

import { api, loadSettings, modelKey } from '../settings.js';

const MENU_ID = 'semhl-related';

async function ensureInjected(tabId) {
  try {
    await api.tabs.sendMessage(tabId, { type: 'ping' });
  } catch {
    await api.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function sendToTab(tabId, message) {
  try {
    await ensureInjected(tabId);
    await api.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Pages such as chrome:// and the web stores can't be scripted.
    console.warn('Semantic highlighter cannot run on this page:', err.message);
  }
}

function setBadge(tabId, active) {
  api.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
  api.action.setBadgeBackgroundColor({ tabId, color: '#d9480f' });
}

export function setup(embedTexts) {
  api.runtime.onInstalled.addListener(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: 'Highlight sentences related to "%s"',
      contexts: ['selection'],
    });
  });

  api.action.onClicked.addListener((tab) => sendToTab(tab.id, { type: 'toggle' }));

  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) sendToTab(tab.id, { type: 'highlight-selection' });
  });

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target === 'offscreen') return false;
    if (msg.type === 'state' && sender.tab) {
      setBadge(sender.tab.id, msg.active);
      return false;
    }
    if (msg.type === 'embed') {
      const tabId = sender.tab?.id;
      const onProgress = (percent) => {
        if (tabId !== undefined) api.tabs.sendMessage(tabId, { type: 'model-progress', percent }).catch(() => {});
      };
      loadSettings()
        .then(async (settings) => {
          const result = await embedTexts(settings, msg.texts, onProgress);
          sendResponse({ ok: true, key: modelKey(settings), ...result });
        })
        .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }
    return false;
  });

  // Lets the end-to-end test drive the extension without a toolbar to click.
  globalThis.semhlToggle = (tabId) => sendToTab(tabId, { type: 'toggle' });
}
