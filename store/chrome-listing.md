# Chrome Web Store listing

Upload `web-ext-artifacts/semantic-highlighter-<version>-chrome.zip`, made by `npm run build && npm run package`.

## Store listing

- **Category:** Tools
- **Language:** English
- **Screenshots** (1280×800): `store/screenshots/search-box.png` (the search box, from `node tools/store-screenshot.mjs`), `store/screenshots/sourdough.png` (a selection)
- **Homepage:** https://github.com/NimbleShot/semantic-highlighter
- **Support:** https://github.com/NimbleShot/semantic-highlighter/issues

**Description:** the `description` text in `store/amo-metadata.json`, with the Firefox-only
parts left as they are (they apply to Chrome too).

## Privacy practices

**Single purpose:** Colors the sentences on the current page by how similar in meaning they
are to the text the user selects.

**Permission justifications:**

- `activeTab`: the highlighter runs only on the tab where the user clicks the toolbar button,
  presses the shortcut or uses the context menu.
- `scripting`: injects the content script into that tab, to read its sentences and paint the
  colors.
- `contextMenus`: adds "Highlight sentences related to …" to the right-click menu on a selection.
- `storage`: keeps the user's settings (model choice, thresholds).
- `offscreen`: the embedding model runs in an offscreen document, because a service worker
  cannot keep a WebAssembly model loaded or use threads.
- Optional host permissions (`http://*/*`, `https://*/*`): requested only if the user chooses
  an Ollama server in the options, to reach the address they enter. Not requested otherwise.

**Remote code:** No. All JavaScript and WebAssembly ship in the package. The model weights
(ONNX and tokenizer JSON) are data downloaded from huggingface.co.

**Data usage:** tick nothing. Page text is processed on the device and never collected or
transmitted (except to the user's own Ollama server, if they configure one). Certify all three
statements (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/NimbleShot/semantic-highlighter#privacy
