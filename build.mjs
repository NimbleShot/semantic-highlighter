// Builds dist/chrome and dist/firefox. `node build.mjs` (or `npm run build`).

import * as esbuild from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { highlightCss } from './src/content/colors.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

const common = {
  manifest_version: 3,
  name: 'Semantic Highlighter',
  version: pkg.version,
  description: 'Select a passage and every other sentence on the page is colored by how close it is in meaning.',
  permissions: ['activeTab', 'scripting', 'contextMenus', 'storage'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  action: {
    default_title: 'Semantic highlighter (Alt+Shift+H)',
    default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
  },
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+Shift+H' },
      description: 'Turn the highlighter on or off for this tab',
    },
  },
  options_ui: { page: 'options.html', open_in_tab: true },
  // The model runtime is WebAssembly.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};

const targets = {
  chrome: {
    manifest: {
      ...common,
      permissions: [...common.permissions, 'offscreen'],
      background: { service_worker: 'background.js', type: 'module' },
      minimum_chrome_version: '116',
      // Cross-origin isolation gives the model page SharedArrayBuffer, so it can use several threads.
      cross_origin_embedder_policy: { value: 'require-corp' },
      cross_origin_opener_policy: { value: 'same-origin' },
    },
    background: 'src/background/chrome.js',
    extra: [{ in: 'src/offscreen.js', out: 'offscreen' }],
    copy: [['static/offscreen.html', 'offscreen.html']],
  },
  firefox: {
    manifest: {
      ...common,
      background: { scripts: ['background.js'], type: 'module' },
      browser_specific_settings: {
        gecko: {
          id: 'semantic-highlighter@almog.local',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    },
    background: 'src/background/firefox.js',
    extra: [],
    copy: [],
  },
};

// Firefox's automation can't click the toolbar button or press extension shortcuts, so the
// end-to-end test uses a build that injects itself on 127.0.0.1 and is toggled by a DOM event.
// Never install it for real use.
targets['firefox-test'] = {
  ...targets.firefox,
  manifest: {
    ...targets.firefox.manifest,
    name: 'Semantic Highlighter (test build)',
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], css: ['content.css'] }],
  },
  testHooks: true,
};

const watch = process.argv.includes('--watch');

for (const [name, t] of Object.entries(targets)) {
  const out = `dist/${name}`;
  await rm(out, { recursive: true, force: true });
  await mkdir(`${out}/ort`, { recursive: true });

  const options = {
    bundle: true,
    outdir: out,
    target: ['chrome116', 'firefox142'],
    logLevel: 'warning',
    // CPU-only runtime: a 14 MB WASM file instead of 27 MB with WebGPU. The "extern" build
    // loads its loader from ort/, which lets it start worker threads from that file.
    alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm' },
    conditions: ['onnxruntime-web-use-extern-wasm'],
    legalComments: 'none',
    define: { __TEST_HOOKS__: String(Boolean(t.testHooks)) },
    minifySyntax: true, // drops the test hooks from the real builds
  };
  const builds = [
    { ...options, format: 'esm', entryPoints: [{ in: t.background, out: 'background' }, ...t.extra] },
    {
      ...options,
      format: 'iife',
      entryPoints: [
        { in: 'src/content/content.js', out: 'content' },
        { in: 'src/options/options.js', out: 'options' },
      ],
    },
  ];
  for (const b of builds) {
    if (watch) await (await esbuild.context(b)).watch();
    else await esbuild.build(b);
  }

  await writeFile(`${out}/manifest.json`, `${JSON.stringify(t.manifest, null, 2)}\n`);
  await writeFile(`${out}/content.css`, highlightCss());
  await cp('src/options/options.html', `${out}/options.html`);
  await cp('static/icons', `${out}/icons`, { recursive: true });
  for (const ext of ['wasm', 'mjs']) {
    await cp(`node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.${ext}`, `${out}/ort/ort-wasm-simd-threaded.${ext}`);
  }
  for (const [from, to] of t.copy) await cp(from, `${out}/${to}`);
  console.log(`built ${out}`);
}
