import { describe, test, expect } from 'vitest';
import { buildParagraphTtsSpeakDetail } from '@/app/reader/components/paragraph/paragraphTts';

const BOOK_KEY = 'hash123-session456';

// Build a real DOM range inside a given document so ownerDocument validation is
// exercised against an actual node (not a mock).
const makeRange = (doc: Document, text = 'paragraph'): Range => {
  const p = doc.createElement('p');
  p.textContent = text;
  doc.body.appendChild(p);
  const range = doc.createRange();
  range.selectNodeContents(p.firstChild!);
  return range;
};

describe('buildParagraphTtsSpeakDetail (#3235)', () => {
  test('focused paragraph with live range → detail with range + index (start-alignment)', () => {
    const range = makeRange(document);

    const detail = buildParagraphTtsSpeakDetail(range, 3, BOOK_KEY, document);

    expect(detail.bookKey).toBe(BOOK_KEY);
    expect(detail.index).toBe(3);
    expect(detail.range).toBe(range);
  });

  test('stale / cross-document range → detail keeps index but omits range', () => {
    // Range built in a different document than the one paragraph mode renders.
    const otherDoc = document.implementation.createHTMLDocument('other');
    const staleRange = makeRange(otherDoc);

    const detail = buildParagraphTtsSpeakDetail(staleRange, 3, BOOK_KEY, document);

    expect(detail.index).toBe(3);
    expect(detail.range).toBeUndefined();
  });

  test('no range → detail keeps index, no range', () => {
    const detail = buildParagraphTtsSpeakDetail(null, 2, BOOK_KEY, document);

    expect(detail.index).toBe(2);
    expect(detail.range).toBeUndefined();
  });

  test('no range and no docIndex → bookKey only (TTS falls back to progress)', () => {
    const detail = buildParagraphTtsSpeakDetail(null, undefined, BOOK_KEY, document);

    expect(detail.bookKey).toBe(BOOK_KEY);
    expect(detail.index).toBeUndefined();
    expect(detail.range).toBeUndefined();
  });

  test('range present but docIndex unknown → range only, no index', () => {
    const range = makeRange(document);

    const detail = buildParagraphTtsSpeakDetail(range, undefined, BOOK_KEY, document);

    expect(detail.index).toBeUndefined();
    expect(detail.range).toBe(range);
  });
});
