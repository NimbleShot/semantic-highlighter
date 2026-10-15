// Splits the visible text of a page into sentences and maps each one back to a DOM Range.

const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'button',
  'svg', 'canvas', 'iframe', 'object', 'math', 'head', 'pre', 'code', 'kbd', 'samp',
]);
const MAX_CHARS = 400; // longer runs (lists without punctuation, tables) are cut into chunks
const MAX_SENTENCES = 5000;

function isInlineDisplay(display) {
  return display === 'inline' || display === 'contents' || display === 'ruby';
}

// Text of one block-level element, with the text nodes it came from.
class Block {
  constructor() {
    this.text = '';
    this.parts = []; // { node, start } in text order; node text spans [start, start + node.length)
  }

  add(node) {
    this.parts.push({ node, start: this.text.length });
    this.text += node.data;
  }

  addBreak() {
    if (this.text && !this.text.endsWith('\n')) this.text += '\n';
  }

  // Whitespace between inline elements still separates words and sentences.
  addSpace() {
    if (this.text && !/\s$/.test(this.text)) this.text += ' ';
  }

  // DOM position for a character offset. `isEnd` prefers the end of the previous node.
  locate(offset, isEnd) {
    let lo = 0;
    let hi = this.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.parts[mid].start <= offset - (isEnd ? 1 : 0)) lo = mid;
      else hi = mid - 1;
    }
    const { node, start } = this.parts[lo];
    return { node, offset: Math.max(0, Math.min(offset - start, node.length)) };
  }

  range(from, to) {
    const a = this.locate(from, false);
    const b = this.locate(to, true);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  }
}

export function collectBlocks(root, isExcluded) {
  const blocks = new Map();
  const blockOfEl = new Map();
  let lastBlock = null;

  const blockFor = (el) => {
    const chain = [];
    let e = el;
    let found = root;
    while (e && e !== root) {
      if (blockOfEl.has(e)) {
        found = blockOfEl.get(e);
        break;
      }
      chain.push(e);
      if (!isInlineDisplay(getComputedStyle(e).display)) {
        found = e;
        break;
      }
      e = e.parentElement;
    }
    for (const c of chain) blockOfEl.set(c, found);
    if (!blocks.has(found)) blocks.set(found, new Block());
    return blocks.get(found);
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (SKIP.has(n.localName) || isExcluded(n)) return NodeFilter.FILTER_REJECT;
        if (n.getAttribute('aria-hidden') === 'true' || !n.checkVisibility()) return NodeFilter.FILTER_REJECT;
        return n.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      blockFor(n.parentElement).addBreak();
      continue;
    }
    if (!/\S/.test(n.data)) {
      if (n.parentElement) blockFor(n.parentElement).addSpace();
      continue;
    }
    const block = blockFor(n.parentElement);
    // Coming back to a block after a nested one: don't glue "Intro" and "tail" together.
    if (lastBlock && block !== lastBlock && block.parts.length) block.addBreak();
    block.add(n);
    lastBlock = block;
  }
  return [...blocks.values()].filter((b) => b.parts.length);
}

function* chunks(text, start, end) {
  while (end - start > MAX_CHARS) {
    let cut = text.lastIndexOf(' ', start + MAX_CHARS * 0.75);
    if (cut <= start) cut = start + MAX_CHARS;
    yield [start, cut];
    start = cut + 1;
  }
  yield [start, end];
}

// Returns [{ text, range }] in document order.
export function collectSentences(root, { minChars, isExcluded = () => false }) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const sentences = [];
  for (const block of collectBlocks(root, isExcluded)) {
    for (const seg of segmenter.segment(block.text)) {
      const lead = seg.segment.length - seg.segment.trimStart().length;
      const trail = seg.segment.length - seg.segment.trimEnd().length;
      const start = seg.index + lead;
      const end = seg.index + seg.segment.length - trail;
      for (const [a, b] of chunks(block.text, start, end)) {
        const text = block.text.slice(a, b).replace(/\s+/g, ' ').trim();
        if (text.length < minChars || !/\p{L}/u.test(text)) continue;
        sentences.push({ text, range: block.range(a, b) });
        if (sentences.length >= MAX_SENTENCES) return sentences;
      }
    }
  }
  return sentences;
}

export function rangesOverlap(a, b) {
  return a.compareBoundaryPoints(Range.START_TO_END, b) > 0 && a.compareBoundaryPoints(Range.END_TO_START, b) < 0;
}
