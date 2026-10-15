import { api, MODELS, loadSettings, saveSettings } from '../settings.js';

const form = document.getElementById('form');
const result = document.getElementById('result');

for (const [id, label] of Object.entries(MODELS)) form.model.add(new Option(label, id));

function showBackend() {
  const backend = form.backend.value;
  document.getElementById('browser').hidden = backend !== 'browser';
  document.getElementById('ollama').hidden = backend !== 'ollama';
}

function read() {
  return {
    backend: form.backend.value,
    model: form.model.value,
    ollamaUrl: form.ollamaUrl.value.trim().replace(/\/$/, '') || 'http://localhost:11434',
    ollamaModel: form.ollamaModel.value.trim(),
    autoOnSelect: form.autoOnSelect.checked,
    showUnrelated: form.showUnrelated.checked,
    minChars: Math.max(1, Number(form.minChars.value) || 20),
  };
}

async function save() {
  const values = read();
  if (values.backend === 'ollama') {
    // Must run inside the click that submitted the form.
    const origins = [`${new URL(values.ollamaUrl).origin}/*`];
    if (!(await api.permissions.request({ origins }))) {
      result.textContent = 'Not saved: the browser needs permission to reach the Ollama server.';
      return false;
    }
  }
  await saveSettings(values);
  result.textContent = 'Saved.';
  return true;
}

form.addEventListener('change', showBackend);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  save();
});

document.getElementById('test').addEventListener('click', async () => {
  if (!(await save())) return;
  result.textContent = 'Embedding two sentences (the first run downloads the model)…';
  const started = performance.now();
  const res = await api.runtime.sendMessage({
    type: 'embed',
    texts: ['The cat sat on the mat.', 'A kitten was resting on the rug.'],
  });
  const ms = Math.round(performance.now() - started);
  if (!res?.ok) {
    result.textContent = `Failed: ${res?.error ?? 'no answer'}`;
    return;
  }
  const a = res.data.slice(0, res.dims);
  const b = res.data.slice(res.dims);
  const sim = a.reduce((s, x, i) => s + x * b[i], 0);
  result.textContent = `Works: ${res.dims} dimensions, similarity of two paraphrases ${sim.toFixed(2)}, ${ms} ms.`;
});

loadSettings().then((s) => {
  form.backend.value = s.backend;
  form.model.value = s.model;
  form.ollamaUrl.value = s.ollamaUrl;
  form.ollamaModel.value = s.ollamaModel;
  form.autoOnSelect.checked = s.autoOnSelect;
  form.showUnrelated.checked = s.showUnrelated;
  form.minChars.value = s.minChars;
  showBackend();
});
