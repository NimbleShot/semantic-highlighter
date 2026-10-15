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
    // CPU-only runtime: a 14 MB WASM file instead of 27 MB with WebGPU.
    alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm' },
    legalComments: 'none',
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
  await cp('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', `${out}/ort/ort-wasm-simd-threaded.wasm`);
  for (const [from, to] of t.copy) await cp(from, `${out}/${to}`);
  console.log(`built ${out}`);
}
