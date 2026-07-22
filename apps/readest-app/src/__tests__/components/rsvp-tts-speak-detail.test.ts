import { describe, test, expect } from 'vitest';
import { buildRsvpTtsSpeakDetail } from '@/app/reader/components/rsvp/rsvpTts';
import type { RsvpWord } from '@/services/rsvp';

const BOOK_KEY = 'hash123-session456';

// Build a real DOM range inside a given document so ownerDocument validation is
// exercised against an actual node (not a mock).
const makeRange = (doc: Document, text = 'word'): Range => {
  const p = doc.createElement('p');
  p.textContent = text;
  doc.body.appendChild(p);
  const range = doc.createRange();
  range.selectNodeContents(p.firstChild!);
  return range;
};

describe('buildRsvpTtsSpeakDetail (slice 7, #3235)', () => {
  test('no current word → null', () => {
    expect(buildRsvpTtsSpeakDetail(null, BOOK_KEY, document)).toBeNull();
    expect(buildRsvpTtsSpeakDetail(undefined, BOOK_KEY, document)).toBeNull();
  });

  test('valid word with live range → detail with range + index (start-alignment)', () => {
    const range = makeRange(document);
    const word: RsvpWord = { text: 'word', orpIndex: 1, pauseMultiplier: 1, range, docIndex: 3 };

    const detail = buildRsvpTtsSpeakDetail(word, BOOK_KEY, document);

    expect(detail).not.toBeNull();
    expect(detail!.bookKey).toBe(BOOK_KEY);
    expect(detail!.index).toBe(3);
    expect(detail!.range).toBe(range);
  });

  test('stale / cross-document range → detail keeps index but omits range', () => {
    // Range built in a different document than the one RSVP is rendering.
    const otherDoc = document.implementation.createHTMLDocument('other');
    const staleRange = makeRange(otherDoc);
    const word: RsvpWord = {
      text: 'word',
      orpIndex: 1,
      pauseMultiplier: 1,
      range: staleRange,
      docIndex: 3,
    };

    const detail = buildRsvpTtsSpeakDetail(word, BOOK_KEY, document);

    expect(detail).not.toBeNull();
    expect(detail!.index).toBe(3);
    expect(detail!.range).toBeUndefined();
  });

  test('word without a range → detail keeps index, no range', () => {
    const word: RsvpWord = { text: 'word', orpIndex: 1, pauseMultiplier: 1, docIndex: 2 };

    const detail = buildRsvpTtsSpeakDetail(word, BOOK_KEY, document);

    expect(detail!.index).toBe(2);
    expect(detail!.range).toBeUndefined();
  });

  test('word without docIndex → detail omits index (TTS falls back to progress)', () => {
    const range = makeRange(document);
    const word: RsvpWord = { text: 'word', orpIndex: 1, pauseMultiplier: 1, range };

    const detail = buildRsvpTtsSpeakDetail(word, BOOK_KEY, document);

    expect(detail!.index).toBeUndefined();
    expect(detail!.range).toBe(range);
  });
});
