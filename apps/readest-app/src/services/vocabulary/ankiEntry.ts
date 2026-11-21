import type { DictionaryProvider } from '@/services/dictionaries/types';

// The dictionary entry Sync puts on a Readest Anki card (#7728): what the
// reader's chosen dictionary renders, cleaned down to formatting Anki shows.

/** Longest entry HTML kept on a card; longer ones stop at a block boundary. */
export const MAX_ENTRY_LENGTH = 8000;

/** A lookup that takes longer gives no entry, so a stalled dictionary can't hold up Sync. */
const LOOKUP_TIMEOUT_MS = 15_000;

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

// The longest start of `text` whose escaped HTML fits in `budget` characters.
const cappedText = (text: string, budget: number): string => {
  if (budget <= 0) return '';
  let n = Math.min(text.length, budget);
  let part = html(document.createTextNode(text.slice(0, n)));
  while (part.length > budget) {
    n -= Math.max(1, Math.ceil((part.length - budget) / 5));
    part = html(document.createTextNode(text.slice(0, n)));
  }
  return part;
};

// The nodes' HTML up to `budget` characters: whole nodes, then the start of
// the first one that doesn't fit, cut at a child boundary. Text is cut only
// when nothing is kept before it (`kept`), so an entry ends between blocks
// unless its first block alone is too long.
const capped = (nodes: NodeListOf<ChildNode>, budget: number, kept = false): string => {
  let out = '';
  if (budget <= 0) return out;
  for (const node of nodes) {
    const whole = html(node);
    if (out.length + whole.length <= budget) {
      out += whole;
      continue;
    }
    // Whitespace between tags isn't content kept.
    const keptHere = kept || !!out.trim();
    if (node.nodeType === Node.TEXT_NODE) {
      if (!keptHere) out += cappedText(node.textContent ?? '', budget - out.length);
    } else if (node instanceof Element && !node.matches('br, hr')) {
      const tag = node.tagName.toLowerCase();
      const wrap = `<${tag}></${tag}>`.length;
      const inner = capped(node.childNodes, budget - out.length - wrap, keptHere);
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

/**
 * The word's entry in `provider`, cleaned for a card; empty when it has none,
 * fails, or takes longer than LOOKUP_TIMEOUT_MS (the request is then aborted).
 */
export const lookupEntry = async (
  word: string,
  lang: string,
  provider: DictionaryProvider,
): Promise<string> => {
  const container = document.createElement('div');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timed out'));
    }, LOOKUP_TIMEOUT_MS);
  });
  try {
    const lookup = (async () => {
      await provider.init?.();
      return provider.lookup(word, { lang, signal: controller.signal, container });
    })();
    const outcome = await Promise.race([lookup, timeout]);
    return outcome.ok ? entryHtml(container) : '';
  } catch (err) {
    console.warn('[vocabulary] Anki entry lookup failed', provider.id, err);
    return '';
  } finally {
    clearTimeout(timer);
  }
};
