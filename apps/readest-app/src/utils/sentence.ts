export const SENTENCE_CONTAINER = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6';

/**
 * Locate the sentence(s) covering `range` inside its enclosing block element.
 * `start`/`end` are trimmed offsets into `root.textContent`; null when the
 * range spans several blocks or segmentation finds no sentence.
 */
export const getSentenceBounds = (range: Range) => {
  const startElement =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const root = startElement?.closest(SENTENCE_CONTAINER) ?? startElement;
  if (!root?.contains(range.endContainer)) return null;

  const doc = root.ownerDocument;
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
  if (!startSegment || !endSegment) return null;

  const rawStart = startSegment.index;
  const rawEnd = endSegment.index + endSegment.segment.length;
  const selectedText = text.slice(rawStart, rawEnd);
  return {
    root,
    start: rawStart + selectedText.search(/\S|$/),
    end: rawEnd - (selectedText.length - selectedText.trimEnd().length),
  };
};
