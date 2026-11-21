import type { DictionaryProvider } from '@/services/dictionaries/types';

// The dictionary entry Sync puts on a Readest Anki card (#7728): what the
// reader's chosen dictionary renders, cleaned down to formatting Anki shows.

/** Longest entry HTML kept on a card; longer ones stop at a block boundary. */
export const MAX_ENTRY_LENGTH = 8000;

// Formatting kept as is (without attributes).
const KEEP = new Set([
  'P',
  'DIV',
  'BR',
  'HR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'SUP',
  'SUB',
  'SMALL',
  'OL',
  'UL',
  'LI',
  'DL',
  'DT',
  'DD',
  'BLOCKQUOTE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
]);

// Dropped with their content: code, styles, media (blob: URLs die with the
// popup) and controls. Anything else, links included, keeps only its content.
const DROP = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'TEMPLATE',
  'NOSCRIPT',
  'IMG',
  'PICTURE',
  'SVG',
  'AUDIO',
  'VIDEO',
  'SOURCE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
]);

// Headings become bold lines: a dictionary's <h1> would dwarf the card's own hint.
const HEADING = /^H[1-6]$/;

const clean = (node: Node, into: Node) => {
  // An MDict entry renders into an open shadow root.
  const children = node instanceof Element && node.shadowRoot ? node.shadowRoot : node;
  for (const child of children.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(document.createTextNode(child.textContent ?? ''));
    } else if (child instanceof Element) {
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (HEADING.test(tag)) {
        const line = document.createElement('p');
        clean(child, line.appendChild(document.createElement('b')));
        into.appendChild(line);
      } else if (KEEP.has(tag)) {
        const el = document.createElement(tag.toLowerCase());
        clean(child, el);
        into.appendChild(el);
      } else {
        clean(child, into);
      }
    }
  }
};

const html = (node: Node) =>
  node instanceof Element ? node.outerHTML : new XMLSerializer().serializeToString(node);

// The nodes' HTML up to `budget` characters: whole nodes, then the start of
// the first one that doesn't fit, if any of it does.
const capped = (nodes: NodeListOf<ChildNode>, budget: number): string => {
  let out = '';
  for (const node of nodes) {
    const whole = html(node);
    if (out.length + whole.length <= budget) {
      out += whole;
      continue;
    }
    if (node instanceof Element && !node.matches('br, hr')) {
      const tag = node.tagName.toLowerCase();
      const wrap = `<${tag}></${tag}>`.length;
      const inner = capped(node.childNodes, budget - out.length - wrap);
      if (inner) out += `<${tag}>${inner}</${tag}>`;
    }
    break;
  }
  return out;
};

/** A rendered entry as card HTML: formatting only, at most MAX_ENTRY_LENGTH long. */
export const entryHtml = (container: Element): string => {
  const out = document.createElement('div');
  clean(container, out);
  if (!out.textContent?.trim()) return '';
  return capped(out.childNodes, MAX_ENTRY_LENGTH);
};

/** The word's entry in `provider`, cleaned for a card; empty when it has none. */
export const lookupEntry = async (
  word: string,
  lang: string,
  provider: DictionaryProvider,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> => {
  const container = document.createElement('div');
  try {
    await provider.init?.();
    const outcome = await provider.lookup(word, { lang, signal, container });
    return outcome.ok ? entryHtml(container) : '';
  } catch (err) {
    console.warn('[vocabulary] Anki entry lookup failed', provider.id, err);
    return '';
  }
};
