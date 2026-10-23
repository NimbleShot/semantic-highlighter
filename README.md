# Semantic Highlighter

A Chrome and Firefox extension. Select a passage, or type an idea into its search box, and every
sentence on the page is tinted by how close it is in **meaning**: warm for related ideas, cool
for unrelated ones. You can see where an article comes back to the same idea even when it uses
different words.

- **Private by default.** A small embedding model ([all-MiniLM-L6-v2], 23 MB) runs inside the
  browser through [transformers.js], so by default all data is processed locally; only the model
  is downloaded, once, from Hugging Face. An [Ollama] server can be used instead. See
  [Privacy](#privacy).
- **Leaves the page alone.** Colors are painted with the [CSS Custom Highlight API], so the
  page's DOM is never changed and turning it off restores the page exactly.
- **Runs only where you turn it on.** It asks only for `activeTab`: nothing is injected until
  you click the toolbar button on a tab.

## Use

1. On a page, press **Ctrl+Shift+F** (Control+Shift+F on a Mac) or click the toolbar button. The
   pill in the corner shows it reading the page, with the cursor in its search box.
2. Either **type an idea and press Enter**, or **select a sentence or a passage** on the page.
   Related sentences turn yellow → orange → red; unrelated ones stay faint blue. A selection is
   purple and underlined, and its text lands in the search box, where it can be edited and run
   again with Enter.
3. The strip on the right edge marks where the related sentences are; click a mark to jump.
   **▲ ▼** in the pill step through them best match first.
4. **Esc** clears the colors. The button, **✕**, or Ctrl+Shift+F pressed in the search box turn
   it off.

| Way in | What it does |
|---|---|
| **Ctrl+Shift+F** (Mac: Control+Shift+F) | Jumps to the search box, turning it on first if needed; pressed in the box, turns it off |
| Toolbar button | Turns it on (cursor in the search box) or off. No default key; you can assign one |
| Select text | Searches for the selection (while it is on) |
| Right-click a selection → *Highlight sentences related to "…"* | Turns it on and searches for the selection in one step |

Shortcuts can be changed at `chrome://extensions/shortcuts`, or in Firefox under
`about:addons` → ⚙ → *Manage Extension Shortcuts*; the tooltips and the options page show
whatever is bound. Keys typed in the search box don't reach the page's own shortcuts.

**Why not Alt:** in Firefox on Windows and Linux, Alt+letter opens the menu bar (Alt+H is Help,
Alt+F is File), and in Chrome Alt+F opens its menu. Ctrl+Shift+F is free in both browsers
(checked against Firefox 157's built-in key table and Chrome's shortcut list); on a Mac,
Cmd+Shift+F is taken, hence Control+Shift+F. A browser only applies a default shortcut when the
extension is first installed: an install that already had the old Alt keys keeps them until it
is removed and added again, or the keys are changed on the shortcuts page.

Options (right-click the button → Options): in-browser model or Ollama, an English or
multilingual model (the multilingual one, 118 MB, also matches Hebrew to English), whether every
selection re-colors, whether unrelated sentences are tinted, and the shortest sentence counted.

## Install

```sh
npm ci
npm run build          # → dist/chrome and dist/firefox
```

The same two commands work in bash, PowerShell and cmd; Node 20 or newer.

`npm ci` reports **3 high severity vulnerabilities**. All three are one advisory in `node-forge`
([GHSA-86w9-cpqp-85rv], no patched version exists), reached only through `web-ext` → `adbkit`,
`web-ext`'s code for running add-ons on Android, which this project never uses. `web-ext` is a
development tool for linting and packaging; none of it is in the built extension, and
`npm audit --omit=dev` finds nothing. Don't run `npm audit fix --force`: it "fixes" this by
downgrading `web-ext` to a 2021 release. (`shell-quote`, the other `web-ext` advisory, is fixed by
the override in `package.json`.)

[GHSA-86w9-cpqp-85rv]: https://github.com/advisories/GHSA-86w9-cpqp-85rv

- **Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → *Load unpacked* →
  `dist/chrome`.
- **Firefox (142+):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
  `dist/firefox/manifest.json`. A temporary add-on is removed when Firefox restarts. To keep it,
  either sign it through addons.mozilla.org (`web-ext sign`, self-distributed, needs an AMO API
  key) or use Developer Edition / Nightly with `xpinstall.signatures.required` set to `false` and
  install `web-ext-artifacts/semantic-highlighter-<version>-firefox.zip` from `npm run package`.

`dist/firefox-test` is a build for the automated test only (it injects itself on 127.0.0.1).
Never install it.

## Releasing

1. Raise `version` in `package.json` (`npm version <x.y.z> --no-git-tag-version`); the stores
   refuse a version they have already seen. Update `release_notes` and `approval_notes` in
   `store/amo-metadata.json`.
2. Commit, then `npm ci && npm run build && npm run package`. That writes
   `web-ext-artifacts/semantic-highlighter-<version>-{firefox,chrome,source}.zip`; the source zip
   is the last commit, so commit first.
3. **Firefox** (listed on AMO as `semantic-highlighter@nimbleshot`), with an API key from
   <https://addons.mozilla.org/developers/addon/api/key/>:

   ```sh
   npx web-ext sign --channel=listed --source-dir dist/firefox \
     --amo-metadata store/amo-metadata.json \
     --upload-source-code web-ext-artifacts/semantic-highlighter-<version>-source.zip \
     --approval-timeout 0 --api-key <issuer> --api-secret <secret>
   ```

   For an existing add-on this submits the new version with its release and reviewer notes,
   updates the listing's summary and description from the same file, and attaches the source.
   The version then waits for review (`--approval-timeout 0` returns without waiting for it).
   Screenshots are uploaded by hand on the listing page. Without an API key: Developer
   Hub → the add-on → *Upload New Version*, the `-firefox.zip`, then the `-source.zip` and the
   notes from `store/amo-metadata.json`.
4. **Chrome:** see `store/chrome-listing.md`.
5. Tag it: `git tag v<version> && git push --tags`.

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
npm run test:e2e          # real Chrome, headless: 16 checks on test/fixtures/article.html
npm run test:e2e:firefox  # real Firefox over WebDriver BiDi: 8 checks
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
default the snap's `/snap/bin/firefox`); `.puppeteerrc.cjs` stops `npm ci` from downloading
Puppeteer's own browsers.

## Privacy

**By default, all data is processed locally, in your browser.** Semantic Highlighter collects
no data: it has no analytics, no accounts and no server of its own.

- **Processed locally.** The extension reads a page only on a tab where you turn it on. Its
  sentences, and the text you select or search for, are turned into embeddings by the model
  running inside your browser, and kept in memory for that tab until you turn it off or close
  the tab. The extension does not store them or send them anywhere.
- **One download.** The model is downloaded once from Hugging Face (`huggingface.co`) and kept
  in the browser's cache. That is the only request the extension makes on its own, and it
  carries none of your data.
- **Ollama, only if you choose it.** If you pick an Ollama server in the options instead of the
  built-in model, the page's sentences and your queries are sent to the address you enter,
  normally a server on your own computer. The browser asks your permission first.
- **Settings** are stored in the browser's extension storage on your computer.
- **The page you are on.** The search box is shown inside the web page, so, as with anything you
  type into a page, that page's own scripts may be able to see what you type there.

## Known limits

- Text inside iframes, shadow DOM and canvas-rendered pages (Google Docs) is not read.
- Very long pages are capped at 5,000 sentences.
- Firefox runs the model on one thread, so a long page takes roughly three times as long to
  index as in Chrome.

[all-MiniLM-L6-v2]: https://huggingface.co/Xenova/all-MiniLM-L6-v2
[transformers.js]: https://huggingface.co/docs/transformers.js
[Ollama]: https://ollama.com
[CSS Custom Highlight API]: https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API
