# Semantic Highlighter

A Chrome and Firefox extension. Select a passage, and every other sentence on the page is
tinted by how close it is in **meaning**: warm for related ideas, cool for unrelated ones. You
can see where an article comes back to the same idea even when it uses different words.

- **Private by default.** A small embedding model ([all-MiniLM-L6-v2], 23 MB) runs inside the
  browser through [transformers.js]. Only the model is downloaded, once, from Hugging Face; page
  text never leaves the computer. An [Ollama] server can be used instead.
- **Leaves the page alone.** Colors are painted with the [CSS Custom Highlight API], so the
  page's DOM is never changed and turning it off restores the page exactly.
- **Runs only where you turn it on.** It asks only for `activeTab`: nothing is injected until
  you click the toolbar button on a tab.

## Use

1. On a page, click the toolbar button or press **Alt+Shift+H**. The pill in the corner shows it
   reading the page.
2. Select a sentence or a passage. Related sentences turn yellow → orange → red; unrelated ones
   stay faint blue. Your selection is purple and underlined.
3. The strip on the right edge marks where the related sentences are; click a mark to jump.
   **▲ ▼** in the pill step through them best match first.
4. **Esc** clears the colors. The button, Alt+Shift+H or **✕** turn it off.

Right-click a selection → *Highlight sentences related to "…"* does the same in one step.

Options (right-click the button → Options): in-browser model or Ollama, an English or
multilingual model (the multilingual one, 118 MB, also matches Hebrew to English), whether every
selection re-colors, whether unrelated sentences are tinted, and the shortest sentence counted.

## Install

```sh
npm ci
npm run build          # → dist/chrome and dist/firefox
```

- **Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → *Load unpacked* →
  `dist/chrome`.
- **Firefox (142+):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
  `dist/firefox/manifest.json`. A temporary add-on is removed when Firefox restarts. To keep it,
  either sign it through addons.mozilla.org (`web-ext sign`, self-distributed, needs an AMO API
  key) or use Developer Edition / Nightly with `xpinstall.signatures.required` set to `false` and
  install the zip from `npm run package:firefox`.

`dist/firefox-test` is a build for the automated test only (it injects itself on 127.0.0.1).
Never install it.

### Using Ollama

Ollama turns browser extensions away unless it is started with their origins allowed:

```sh
OLLAMA_ORIGINS='chrome-extension://*,moz-extension://*' ollama serve
# or, for a systemd unit:  Environment=OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*
```

Then pick *An Ollama server* in the options, with an embedding model such as
`qwen3-embedding:0.6b` or `nomic-embed-text`. The browser asks once for permission to reach
the server.

## How it works

| Piece | File | What it does |
|---|---|---|
| Content script | `src/content/content.js` | Indexes the page, embeds the selection, paints, minimap, keys |
| Segmentation | `src/content/segment.js` | Visible text → sentences (`Intl.Segmenter`, so Hebrew works) → DOM ranges. Skips hidden text, code, inputs, menus, headers/footers and `[1]`-style citation marks |
| Scoring | `src/content/score.js` | Cosine similarity → a robust z-score against the page's median → 8 heat bins. Relative to the page, so it works on mixed pages and single-subject pages and with any model |
| Model | `src/engine.js` | transformers.js on the ONNX WASM runtime (shipped in `ort/`, no remote code), or Ollama's `/api/embed` |
| Chrome background | `src/background/chrome.js`, `src/offscreen.js` | The service worker routes messages; the model lives in an offscreen document, which stays warm and is cross-origin isolated so the model uses 4 threads |
| Firefox background | `src/background/firefox.js` | The background page runs the model itself (one thread) |
| Options | `src/options/` | Settings in `storage.local` |

Sentence vectors are cached per tab by text, so a page that changes (infinite scroll, a
single-page app) only embeds what is new.

**Speed** on the HP laptop (Ryzen 5 5625U, CPU only), Wikipedia's *Sourdough* article, 590
sentences: indexing 4.5 s in Chrome (7.6 ms a sentence, 4 threads), painting a selection 0.4 s.

## Tests

```sh
npm test                  # unit tests for the scoring (Node)
npm run test:e2e          # real Chrome, headless: 10 checks on test/fixtures/article.html
npm run test:e2e:firefox  # real Firefox over WebDriver BiDi: 6 checks
npm run lint              # web-ext lint on the Firefox build
node test/bench.mjs https://en.wikipedia.org/wiki/Sourdough 60   # speed and matches on a real page
```

The fixture mixes sentences about sourdough and about a Mars rover, with hidden text, a code
block, a `<br>`, inline and nested elements and a Hebrew translation. The tests check that the
bread sentences rank above every Mars sentence, that hidden text is never indexed, and that the
pill and the highlights work under a strict Content-Security-Policy. Opt-in:
`OLLAMA_TEST_URL=http://127.0.0.1:11434` runs the ranking through Ollama, `E2E_MULTILINGUAL=1`
checks that the multilingual model finds the Hebrew translation of an English sentence.

The tests use the installed Google Chrome (`CHROME=` to override) and Firefox (`FIREFOX=`,
default the snap's `/snap/bin/firefox`); Puppeteer does not download browsers here
(`PUPPETEER_SKIP_DOWNLOAD=1 npm ci`).

## Known limits

- Text inside iframes, shadow DOM and canvas-rendered pages (Google Docs) is not read.
- Very long pages are capped at 5,000 sentences.
- Firefox runs the model on one thread, so a long page takes roughly three times as long to
  index as in Chrome.

[all-MiniLM-L6-v2]: https://huggingface.co/Xenova/all-MiniLM-L6-v2
[transformers.js]: https://huggingface.co/docs/transformers.js
[Ollama]: https://ollama.com
[CSS Custom Highlight API]: https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API
