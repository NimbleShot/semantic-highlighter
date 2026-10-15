// Settings shared by the background, the options page and the engine.

export const api = globalThis.browser ?? globalThis.chrome;

export const MODELS = {
  'Xenova/all-MiniLM-L6-v2': 'English, small (23 MB)',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': 'Multilingual incl. Hebrew (118 MB)',
};

export const DEFAULTS = {
  backend: 'browser', // 'browser' runs the model in the extension; 'ollama' calls an Ollama server
  model: 'Xenova/all-MiniLM-L6-v2',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3-embedding:0.6b',
  autoOnSelect: true, // while on, every selection re-colors the page
  showUnrelated: true, // color the unrelated half of the page in faint blue
  minChars: 20, // shorter sentences are ignored
};

export async function loadSettings() {
  const stored = await api.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(values) {
  return api.storage.local.set(values);
}

// Identifies the embedding space; vectors from different keys are not comparable.
export function modelKey(s) {
  return s.backend === 'ollama' ? `ollama:${s.ollamaUrl}:${s.ollamaModel}` : `browser:${s.model}`;
}
