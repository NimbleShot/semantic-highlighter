// The on-page controls: a status pill and a minimap strip, isolated in a shadow root.

export const HOST_ID = 'semhl-host';

const STYLE = `
:host { all: initial; }
.strip {
  position: fixed; top: 0; right: 0; bottom: 0; width: 12px; z-index: 2147483646;
  background: rgba(127, 127, 127, 0.12); pointer-events: none;
}
.tick {
  position: absolute; left: 1px; right: 1px; height: 4px; margin-top: -2px; border-radius: 2px;
  pointer-events: auto; cursor: pointer;
}
.tick:hover { left: -4px; height: 6px; margin-top: -3px; }
.pill {
  position: fixed; right: 20px; bottom: 16px; z-index: 2147483647;
  display: flex; align-items: center; gap: 6px; max-width: min(560px, calc(100vw - 40px));
  padding: 6px 8px 6px 12px; border-radius: 999px;
  font: 13px/1.3 system-ui, sans-serif; color: #f8f8f8; background: rgba(24, 24, 27, 0.92);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: linear-gradient(135deg, rgb(59, 130, 246), rgb(220, 38, 38)); }
.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: #d4d4d8; }
.query {
  all: unset; box-sizing: border-box; width: 240px; flex: 0 1 240px; min-width: 120px;
  padding: 3px 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.12);
  font: 13px/1.3 system-ui, sans-serif; color: #fafafa; cursor: text;
}
.query::placeholder { color: #a1a1aa; }
.query::-webkit-search-cancel-button { display: none; } /* Esc clears; one ✕ in the pill is enough */
.query:focus { background: rgba(255, 255, 255, 0.2); box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.7); }
button {
  all: unset; cursor: pointer; padding: 2px 7px; border-radius: 999px; color: #f8f8f8;
  font: 13px/1.3 system-ui, sans-serif;
}
button:hover { background: rgba(255, 255, 255, 0.15); }
button[hidden] { display: none; }
`;

export function mountUi({ onQuery, onPrev, onNext, onClose, onTick }) {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
  const pill = el('div', 'pill');
  const input = el('input', 'query', {
    type: 'search',
    placeholder: 'Search by meaning, or select text',
    title: 'Type an idea and press Enter (Alt+Shift+F)',
    spellcheck: false,
    autocomplete: 'off',
  });
  input.setAttribute('aria-label', 'Search this page by meaning');
  pill.append(
    el('span', 'dot'),
    input,
    el('span', 'status', { role: 'status' }),
    el('button', 'prev', { title: 'Previous related sentence', textContent: '▲', hidden: true }),
    el('button', 'next', { title: 'Next related sentence', textContent: '▼', hidden: true }),
    el('button', 'close', { title: 'Turn off (Alt+Shift+H)', textContent: '✕' }),
  );
  root.append(el('div', 'strip'), pill);
  try {
    // A constructed sheet is not subject to the page's Content-Security-Policy.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.prepend(el('style', '', { textContent: STYLE }));
  }
  document.documentElement.append(host);

  const $ = (sel) => root.querySelector(sel);
  $('.prev').addEventListener('click', onPrev);
  $('.next').addEventListener('click', onNext);
  $('.close').addEventListener('click', onClose);
  $('.strip').addEventListener('click', (e) => {
    if (e.target.dataset.index) onTick(Number(e.target.dataset.index));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onQuery(input.value);
    } else if (e.key === 'Escape') {
      input.blur();
    }
  });
  // Typing in the box must not reach the page's own keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) input.addEventListener(type, (e) => e.stopPropagation());

  return {
    host,
    focusQuery() {
      input.focus();
      input.select();
    },
    // Shows what is being searched for, e.g. after a selection, so it can be edited.
    setQuery(text) {
      if (root.activeElement !== input) input.value = text;
    },
    setStatus(text, showNav) {
      $('.status').textContent = text;
      $('.prev').hidden = $('.next').hidden = !showNav;
    },
    // ticks: [{ fraction, color, index, title }]
    setTicks(ticks) {
      $('.strip').replaceChildren(
        ...ticks.map((t) => {
          const el = document.createElement('div');
          el.className = 'tick';
          el.style.top = `${(t.fraction * 100).toFixed(2)}%`;
          el.style.background = t.color;
          el.title = t.title;
          if (t.index !== undefined) el.dataset.index = t.index;
          return el;
        }),
      );
    },
    remove() {
      host.remove();
    },
  };
}
