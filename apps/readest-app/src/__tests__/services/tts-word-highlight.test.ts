import { describe, test, it, expect } from 'vitest';
import {
  computeWordOffsets,
  findBoundaryIndexAtTime,
  getTextSubRange,
  rangeTextExcludingInert,
} from '@/services/tts/wordHighlight';

describe('computeWordOffsets', () => {
  test('maps words to offsets in order', () => {
    const text = 'Dr. Smith bought 23 apples';
    const offsets = computeWordOffsets(text, ['Dr.', 'Smith', 'bought', '23', 'apples']);
    expect(offsets).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 9 },
      { start: 10, end: 16 },
      { start: 17, end: 19 },
      { start: 20, end: 26 },
    ]);
  });

  test('repeated words advance past earlier occurrences', () => {
    const text = 'the cat and the hat';
    const offsets = computeWordOffsets(text, ['the', 'cat', 'and', 'the', 'hat']);
    expect(offsets![3]).toEqual({ start: 12, end: 15 });
  });

  test('short word is not matched inside an earlier longer word', () => {
    const text = 'and a cat';
    const offsets = computeWordOffsets(text, ['and', 'a', 'cat']);
    expect(offsets).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 5 },
      { start: 6, end: 9 },
    ]);
  });

  test('missing word yields null without advancing the cursor', () => {
    const text = 'hello world';
    const offsets = computeWordOffsets(text, ['hello', 'BOGUS', 'world']);
    expect(offsets).toEqual([{ start: 0, end: 5 }, null, { start: 6, end: 11 }]);
  });

  test('empty or whitespace-only word yields null', () => {
    const offsets = computeWordOffsets('hello world', ['hello', ' ', 'world']);
    expect(offsets).toEqual([{ start: 0, end: 5 }, null, { start: 6, end: 11 }]);
  });

  test('words with attached punctuation match document text verbatim', () => {
    const text = 'paid $5.50 for them, you know.';
    const offsets = computeWordOffsets(text, ['paid', '$5.50', 'for', 'them', 'you', 'know']);
    expect(offsets).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 10 },
      { start: 11, end: 14 },
      { start: 15, end: 19 },
      { start: 21, end: 24 },
      { start: 25, end: 29 },
    ]);
  });
});

describe('findBoundaryIndexAtTime', () => {
  // offsets are in 100-nanosecond ticks: 10_000_000 ticks = 1 second
  const boundaries = [{ offset: 1_000_000 }, { offset: 5_000_000 }, { offset: 11_000_000 }];

  test('returns -1 for an empty list', () => {
    expect(findBoundaryIndexAtTime([], 1)).toBe(-1);
  });

  test('returns -1 before the first boundary', () => {
    expect(findBoundaryIndexAtTime(boundaries, 0.05)).toBe(-1);
  });

  test('returns the boundary exactly at its start time', () => {
    expect(findBoundaryIndexAtTime(boundaries, 0.1)).toBe(0);
  });

  test('returns the latest boundary at or before the given time', () => {
    expect(findBoundaryIndexAtTime(boundaries, 0.7)).toBe(1);
  });

  test('returns the last boundary after the stream end', () => {
    expect(findBoundaryIndexAtTime(boundaries, 10)).toBe(2);
  });
});

describe('getTextSubRange', () => {
  const makeBaseRange = (html: string) => {
    document.body.innerHTML = html;
    const root = document.body.firstElementChild!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);
    const range = document.createRange();
    range.setStart(textNodes[0]!, 0);
    range.setEnd(textNodes.at(-1)!, textNodes.at(-1)!.length);
    return range;
  };

  test('extracts a word inside a single text node', () => {
    const base = makeBaseRange('<p>Hello brave world</p>');
    const sub = getTextSubRange(base, 6, 11);
    expect(sub?.toString()).toBe('brave');
  });

  test('extracts a word inside a nested element', () => {
    const base = makeBaseRange('<p>Hello <em>brave</em> world</p>');
    expect(base.toString()).toBe('Hello brave world');
    const sub = getTextSubRange(base, 6, 11);
    expect(sub?.toString()).toBe('brave');
  });

  test('extracts a span crossing element boundaries', () => {
    const base = makeBaseRange('<p>Hello <em>brave</em> world</p>');
    const sub = getTextSubRange(base, 4, 14);
    expect(sub?.toString()).toBe('o brave wo');
  });

  test('offsets are relative to a base range starting mid-node', () => {
    document.body.innerHTML = '<p>Hello brave world</p>';
    const textNode = document.body.firstElementChild!.firstChild as Text;
    const base = document.createRange();
    base.setStart(textNode, 3);
    base.setEnd(textNode, textNode.length);
    expect(base.toString()).toBe('lo brave world');
    const sub = getTextSubRange(base, 3, 8);
    expect(sub?.toString()).toBe('brave');
  });

  test('ignores text nodes outside the base range', () => {
    document.body.innerHTML = '<p>before <span id="target">Hello world</span> after</p>';
    const textNode = document.getElementById('target')!.firstChild as Text;
    const base = document.createRange();
    base.setStart(textNode, 0);
    base.setEnd(textNode, textNode.length);
    const sub = getTextSubRange(base, 6, 11);
    expect(sub?.toString()).toBe('world');
  });

  test('returns null when offsets exceed the base range text', () => {
    const base = makeBaseRange('<p>Hello</p>');
    expect(getTextSubRange(base, 0, 100)).toBeNull();
  });

  test('returns null for an empty or inverted span', () => {
    const base = makeBaseRange('<p>Hello</p>');
    expect(getTextSubRange(base, 2, 2)).toBeNull();
    expect(getTextSubRange(base, 3, 2)).toBeNull();
    expect(getTextSubRange(base, -1, 2)).toBeNull();
  });
});

const makeBaseRangeFrom = (html: string): Range => {
  document.body.innerHTML = html;
  const root = document.body.firstElementChild!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const range = document.createRange();
  range.setStart(nodes[0]!, 0);
  range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
  return range;
};

describe('rangeTextExcludingInert respects the range offsets', () => {
  // A paragraph whose whole text is a single text node (e.g. wrapped in one
  // <span>): a middle sentence is a sub-range of that node with non-zero
  // start/end offsets. The text must be the sentence, not the whole node.
  it('returns only the sub-range text when the range is inside a single text node', () => {
    document.body.innerHTML =
      '<p><span>First sentence. Second sentence. Third sentence.</span></p>';
    const textNode = document.querySelector('span')!.firstChild as Text;
    const data = textNode.data;
    const base = document.createRange();
    base.setStart(textNode, data.indexOf('Second'));
    base.setEnd(textNode, data.indexOf('Third'));
    expect(base.toString()).toBe('Second sentence. ');
    expect(rangeTextExcludingInert(base)).toBe('Second sentence. ');
  });

  // The actual word-highlight failure: offsets computed from the matching text
  // must line up with getTextSubRange (which respects the range offsets), or
  // every highlighted word drifts. Reproduces the "second/third sentence"
  // skipping seen with single-text-node paragraphs.
  it('word offsets from rangeTextExcludingInert align with getTextSubRange mid-node', () => {
    document.body.innerHTML =
      '<p><span>First sentence here. Those immortals are going crazy. Last one.</span></p>';
    const textNode = document.querySelector('span')!.firstChild as Text;
    const data = textNode.data;
    const base = document.createRange();
    base.setStart(textNode, data.indexOf('Those'));
    base.setEnd(textNode, data.indexOf('Last'));
    const sentenceText = rangeTextExcludingInert(base);
    const offsets = computeWordOffsets(sentenceText, ['Those', 'immortals', 'crazy']);
    expect(getTextSubRange(base, offsets[0]!.start, offsets[0]!.end)?.toString()).toBe('Those');
    expect(getTextSubRange(base, offsets[1]!.start, offsets[1]!.end)?.toString()).toBe('immortals');
    expect(getTextSubRange(base, offsets[2]!.start, offsets[2]!.end)?.toString()).toBe('crazy');
  });
});

describe('gloss-aware word highlighting', () => {
  it('rangeTextExcludingInert drops cfi-inert gloss text', () => {
    const base = makeBaseRangeFrom(
      `<p>The <ruby cfi-skip="">quick<rt cfi-inert="">敏捷</rt></ruby> fox</p>`,
    );
    expect(rangeTextExcludingInert(base)).toBe('The quick fox');
  });

  it('getTextSubRange ignores the gloss when slicing a word', () => {
    const base = makeBaseRangeFrom(
      `<p>The <ruby cfi-skip="">quick<rt cfi-inert="">敏捷</rt></ruby> fox</p>`,
    );
    const sub = getTextSubRange(base, 10, 13)!;
    expect(sub.toString()).toBe('fox');
  });
});
