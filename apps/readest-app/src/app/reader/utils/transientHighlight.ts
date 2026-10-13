import type { FoliateView } from '@/types/view';
import { Overlayer } from 'foliate-js/overlayer.js';
import { SENTENCE_CONTAINER, getSentenceBounds } from '@/utils/sentence';

// resolveNavigation's anchor is typed as returning a Range, but for hash
// hrefs foliate resolves to the target Element (and 0 for section-only
// hrefs) — widen it so href targets typecheck.
type TransientHighlightView = Pick<FoliateView, 'renderer'> & {
  resolveNavigation: (target: string | number) => {
    index: number;
    anchor?: (doc: Document) => Range | Element | number | null;
  };
};
type TransientHighlightOverlayer = {
  add: (
    key: string,
    range: Range,
    draw: typeof Overlayer.highlight,
    options: { color: string },
  ) => void;
  remove: (key: string) => void;
};

const HIGHLIGHT_KEY = 'transient-highlight';
const HIGHLIGHT_COLOR = '#808080';

const getRenderedContent = async (view: TransientHighlightView, index: number) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const content = view.renderer.getContents().find((item) => item.index === index);
    if (content?.doc && content.overlayer) return content;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return null;
};

const getTextPosition = (root: Element, offset: number) => {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, showText);
  let node = walker.nextNode();
  let consumed = 0;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= consumed + length) return { node, offset: offset - consumed };
    consumed += length;
    node = walker.nextNode();
  }
  return null;
};

// Footnote ids often sit on an empty inline marker (<a id="fn1"/>); the
// enclosing block is what the reader needs to see highlighted.
const getBlockRange = (doc: Document, el: Element) => {
  let root: Element | null = el.closest(SENTENCE_CONTAINER) ?? el;
  if (!root.textContent?.trim()) {
    const parent = root.parentElement;
    if (parent && parent !== doc.body) {
      root = parent;
    } else {
      // Never widen to the whole section: books converted from MOBI mark each
      // target with an empty <p> right under <body>, and painting the body of a
      // multi-megabyte section froze the reader. Take the block that follows.
      do root = root.nextElementSibling;
      while (root && !root.textContent?.trim());
    }
  }
  if (!root) return null;
  const range = doc.createRange();
  range.selectNodeContents(root);
  return range;
};

const getTargetHighlight = async (view: TransientHighlightView, target: string) => {
  try {
    const { index, anchor } = view.resolveNavigation(target);
    const content = await getRenderedContent(view, index);
    const doc = content?.doc;
    const overlayer = content?.overlayer as TransientHighlightOverlayer | undefined;
    if (!anchor || !doc || !overlayer) return null;
    const resolved = anchor(doc);
    if (!resolved || typeof resolved === 'number') return null;
    if (!('startContainer' in resolved)) {
      const range = getBlockRange(doc, resolved);
      return range ? { overlayer, range } : null;
    }
    const range = resolved;
    const bounds = getSentenceBounds(range);
    if (!bounds) return { overlayer, range };

    const { root, start: sentenceStart, end: sentenceEnd } = bounds;
    const start = getTextPosition(root, sentenceStart);
    const end = getTextPosition(root, sentenceEnd);
    if (!start || !end) return { overlayer, range };
    const sentence = doc.createRange();
    sentence.setStart(start.node, start.offset);
    sentence.setEnd(end.node, end.offset);
    return { overlayer, range: sentence };
  } catch {
    return null;
  }
};

export const showTransientHighlight = async (view: TransientHighlightView, target: string) => {
  const highlight = await getTargetHighlight(view, target);
  if (!highlight) return null;
  const { overlayer, range } = highlight;
  overlayer.remove(HIGHLIGHT_KEY);
  overlayer.add(HIGHLIGHT_KEY, range, Overlayer.highlight, { color: HIGHLIGHT_COLOR });
  return setTimeout(() => overlayer.remove(HIGHLIGHT_KEY), 4000);
};
