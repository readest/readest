import type { FoliateView } from '@/types/view';

type SearchHighlightView = Pick<
  FoliateView,
  'search' | 'clearSearch' | 'resolveNavigation' | 'getCFI' | 'renderer'
>;

const SENTENCE_CONTAINER = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6';

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

const getSentenceCfi = async (view: SearchHighlightView, cfi: string) => {
  try {
    const { index, anchor } = await view.resolveNavigation(cfi);
    const doc = view.renderer.getContents().find((content) => content.index === index)?.doc;
    if (!anchor || !doc) return cfi;
    const range = anchor(doc);
    const startElement =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const root = startElement?.closest(SENTENCE_CONTAINER) ?? startElement;
    if (!root?.contains(range.endContainer)) return cfi;

    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const matchStart = before.toString().length;
    const matchEnd = matchStart + range.toString().length;
    const text = root.textContent ?? '';
    const locale = doc.documentElement.lang || undefined;
    const segments = Array.from(
      new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text),
    );
    const startSegment = segments.find(
      ({ index: start, segment }) => start <= matchStart && matchStart < start + segment.length,
    );
    const endOffset = Math.max(matchStart, matchEnd - 1);
    const endSegment = segments.find(
      ({ index: start, segment }) => start <= endOffset && endOffset < start + segment.length,
    );
    if (!startSegment || !endSegment) return cfi;

    const rawStart = startSegment.index;
    const rawEnd = endSegment.index + endSegment.segment.length;
    const selectedText = text.slice(rawStart, rawEnd);
    const sentenceStart = rawStart + selectedText.search(/\S|$/);
    const sentenceEnd = rawEnd - (selectedText.length - selectedText.trimEnd().length);
    const start = getTextPosition(root, sentenceStart);
    const end = getTextPosition(root, sentenceEnd);
    if (!start || !end) return cfi;
    const sentence = doc.createRange();
    sentence.setStart(start.node, start.offset);
    sentence.setEnd(end.node, end.offset);
    return view.getCFI(index, sentence);
  } catch {
    return cfi;
  }
};

export const showTransientSearchHighlight = async (view: SearchHighlightView, cfi: string) => {
  const highlightCfi = await getSentenceCfi(view, cfi);
  const results = view.search({
    scope: 'book',
    mode: 'contains',
    matchCase: false,
    matchDiacritics: false,
    results: [{ cfi: highlightCfi, excerpt: { pre: '', match: '', post: '' } }],
  });
  for await (const _ of results) {
    // Consume the generator so Foliate installs the search annotation.
  }
  return setTimeout(() => view.clearSearch(), 4000);
};
