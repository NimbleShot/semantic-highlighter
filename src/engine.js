// Turns text into normalized embedding vectors, in the browser or through Ollama.
// Runs in a document context: Chrome's offscreen document, Firefox's background page.

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useWasmCache = false;
// The WASM runtime ships inside the extension; extension pages may not load remote code.
const ort = (file) => globalThis.chrome.runtime.getURL(`ort/${file}`);
env.backends.onnx.wasm.wasmPaths = { mjs: ort('ort-wasm-simd-threaded.mjs'), wasm: ort('ort-wasm-simd-threaded.wasm') };
// Threads need cross-origin isolation (Chrome's offscreen document has it; Firefox's background doesn't).
env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated
  ? Math.min(4, Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)))
  : 1;

const extractors = new Map();

function getExtractor(model, onProgress) {
  if (!extractors.has(model)) {
    const loading = pipeline('feature-extraction', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress?.(Math.round(p.progress));
      },
    });
    loading.catch(() => extractors.delete(model));
    extractors.set(model, loading);
  }
  return extractors.get(model);
}

async function embedInBrowser(model, texts, onProgress) {
  const extractor = await getExtractor(model, onProgress);
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const [, dims] = output.dims;
  return { dims, data: Array.from(output.data) };
}

async function embedWithOllama(url, model, texts) {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts, truncate: true }),
  });
  if (res.status === 403) {
    throw new Error('Ollama refused the extension. Start it with OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*');
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { embeddings } = await res.json();
  const dims = embeddings[0].length;
  const data = new Array(embeddings.length * dims);
  embeddings.forEach((vec, i) => {
    const norm = Math.hypot(...vec) || 1;
    for (let d = 0; d < dims; d++) data[i * dims + d] = vec[d] / norm;
  });
  return { dims, data };
}

// Returns { dims, data } where data is the row-major flat array of unit vectors.
export function embed(settings, texts, onProgress) {
  return settings.backend === 'ollama'
    ? embedWithOllama(settings.ollamaUrl, settings.ollamaModel, texts)
    : embedInBrowser(settings.model, texts, onProgress);
}
