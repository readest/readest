import type { FoliateView } from '@/types/view';
import { Overlayer } from 'foliate-js/overlayer.js';

type SearchHighlightView = Pick<FoliateView, 'resolveNavigation' | 'renderer'>;
type SearchHighlightOverlayer = {
  add: (
    key: string,
    range: Range,
    draw: typeof Overlayer.highlight,
    options: { color: string },
  ) => void;
  remove: (key: string) => void;
};

const SENTENCE_CONTAINER = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6';
const HIGHLIGHT_KEY = 'library-search-highlight';
const HIGHLIGHT_COLOR = '#808080';

const getRenderedContent = async (view: SearchHighlightView, index: number) => {
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

const getSentenceHighlight = async (view: SearchHighlightView, cfi: string) => {
  try {
    const { index, anchor } = await view.resolveNavigation(cfi);
    const content = await getRenderedContent(view, index);
    const doc = content?.doc;
    const overlayer = content?.overlayer as SearchHighlightOverlayer | undefined;
    if (!anchor || !doc || !overlayer) return null;
    const range = anchor(doc);
    if (!range) return null;
    const startElement =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const root = startElement?.closest(SENTENCE_CONTAINER) ?? startElement;
    if (!root?.contains(range.endContainer)) return { overlayer, range };

    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const matchStart = before.toString().length;
    const matchEnd = matchStart + range.toString().length;
    const text = root.textContent ?? '';
    const segmentationText = text.replace(/\s/g, ' ');
    const locale = doc.documentElement.lang || undefined;
    const segments = Array.from(
      new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(segmentationText),
    );
    const startSegment = segments.find(
      ({ index: start, segment }) => start <= matchStart && matchStart < start + segment.length,
    );
    const endOffset = Math.max(matchStart, matchEnd - 1);
    const endSegment = segments.find(
      ({ index: start, segment }) => start <= endOffset && endOffset < start + segment.length,
    );
    if (!startSegment || !endSegment) return { overlayer, range };

    const rawStart = startSegment.index;
    const rawEnd = endSegment.index + endSegment.segment.length;
    const selectedText = text.slice(rawStart, rawEnd);
    const sentenceStart = rawStart + selectedText.search(/\S|$/);
    const sentenceEnd = rawEnd - (selectedText.length - selectedText.trimEnd().length);
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

export const showTransientSearchHighlight = async (view: SearchHighlightView, cfi: string) => {
  const highlight = await getSentenceHighlight(view, cfi);
  if (!highlight) return null;
  const { overlayer, range } = highlight;
  overlayer.remove(HIGHLIGHT_KEY);
  overlayer.add(HIGHLIGHT_KEY, range, Overlayer.highlight, { color: HIGHLIGHT_COLOR });
  return setTimeout(() => overlayer.remove(HIGHLIGHT_KEY), 4000);
};
