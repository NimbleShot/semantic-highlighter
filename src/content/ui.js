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
  display: flex; align-items: center; gap: 6px; max-width: min(420px, calc(100vw - 40px));
  padding: 6px 8px 6px 12px; border-radius: 999px;
  font: 13px/1.3 system-ui, sans-serif; color: #f8f8f8; background: rgba(24, 24, 27, 0.92);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: linear-gradient(135deg, rgb(59, 130, 246), rgb(220, 38, 38)); }
.status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button {
  all: unset; cursor: pointer; padding: 2px 7px; border-radius: 999px; color: #f8f8f8;
  font: 13px/1.3 system-ui, sans-serif;
}
button:hover { background: rgba(255, 255, 255, 0.15); }
button[hidden] { display: none; }
`;

export function mountUi({ onPrev, onNext, onClose, onTick }) {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const el = (tag, className, props = {}) => Object.assign(document.createElement(tag), { className, ...props });
  const pill = el('div', 'pill', { role: 'status' });
  pill.append(
    el('span', 'dot'),
    el('span', 'status'),
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

  return {
    host,
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
