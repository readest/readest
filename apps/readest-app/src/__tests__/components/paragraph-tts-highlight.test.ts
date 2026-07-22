import { describe, test, expect } from 'vitest';
import {
  computeParagraphHighlightOffsets,
  decideParagraphTtsHighlight,
  buildTtsHighlightCssText,
} from '@/app/reader/components/paragraph/paragraphTts';

// Build a paragraph element and return both the element and its
// selectNodeContents range (what the iterator hands paragraph mode).
const makeParagraph = (html: string) => {
  const p = document.createElement('p');
  p.innerHTML = html;
  document.body.appendChild(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  return { p, range };
};

const rangeInNode = (node: Node, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
};

describe('computeParagraphHighlightOffsets (#3235)', () => {
  test('word in a single text node → character offsets relative to paragraph start', () => {
    const { p, range } = makeParagraph('Hello world foo');
    const text = p.firstChild!; // "Hello world foo"
    const target = rangeInNode(text, 6, 11); // "world"

    expect(computeParagraphHighlightOffsets(range, target)).toEqual({ start: 6, end: 11 });
  });

  test('word at the very start of the paragraph → start 0', () => {
    const { p, range } = makeParagraph('Hello world');
    const target = rangeInNode(p.firstChild!, 0, 5); // "Hello"

    expect(computeParagraphHighlightOffsets(range, target)).toEqual({ start: 0, end: 5 });
  });

  test('word inside a nested inline element → offsets across node boundaries', () => {
    // "Hello " (6) + "brave" (in <b>) + " world"
    const { p, range } = makeParagraph('Hello <b>brave</b> world');
    const bold = p.querySelector('b')!;
    const target = rangeInNode(bold.firstChild!, 0, 5); // "brave"

    expect(computeParagraphHighlightOffsets(range, target)).toEqual({ start: 6, end: 11 });
  });

  test('word after a nested inline element counts the inline text', () => {
    const { p, range } = makeParagraph('Hello <b>brave</b> world');
    const tail = p.childNodes[2]!; // " world" text node
    const target = rangeInNode(tail, 1, 6); // "world"

    expect(computeParagraphHighlightOffsets(range, target)).toEqual({ start: 12, end: 17 });
  });

  test('target outside the paragraph → null', () => {
    const { range } = makeParagraph('Hello world');
    const other = makeParagraph('Different paragraph');
    const target = rangeInNode(other.p.firstChild!, 0, 9); // "Different"

    expect(computeParagraphHighlightOffsets(range, target)).toBeNull();
  });

  test('collapsed / empty target → null', () => {
    const { p, range } = makeParagraph('Hello world');
    const target = rangeInNode(p.firstChild!, 3, 3); // empty

    expect(computeParagraphHighlightOffsets(range, target)).toBeNull();
  });
});

describe('decideParagraphTtsHighlight (#3235)', () => {
  test('word boundary event → highlight the word', () => {
    expect(decideParagraphTtsHighlight({ kind: 'word', hasWordPositions: false })).toBe('word');
    expect(decideParagraphTtsHighlight({ kind: 'word', hasWordPositions: true })).toBe('word');
  });

  test('sentence event with no word boundaries seen → highlight the sentence', () => {
    expect(decideParagraphTtsHighlight({ kind: 'sentence', hasWordPositions: false })).toBe(
      'sentence',
    );
  });

  test('sentence event after words seen → skip (words drive the fine-grained highlight)', () => {
    expect(decideParagraphTtsHighlight({ kind: 'sentence', hasWordPositions: true })).toBe('skip');
  });

  test('unknown kind falls back to sentence granularity', () => {
    expect(decideParagraphTtsHighlight({ hasWordPositions: false })).toBe('sentence');
    expect(decideParagraphTtsHighlight({ hasWordPositions: true })).toBe('skip');
  });
});

describe('buildTtsHighlightCssText (#3235)', () => {
  test('defaults to a translucent background using the default color', () => {
    const css = buildTtsHighlightCssText(undefined);
    expect(css).toContain('background-color');
    expect(css).toContain('#808080');
  });

  test('highlight style uses a translucent background of the configured color', () => {
    const css = buildTtsHighlightCssText({ style: 'highlight', color: '#ffcc00' });
    expect(css).toContain('color-mix');
    expect(css).toContain('#ffcc00');
  });

  test('underline style uses text-decoration underline', () => {
    const css = buildTtsHighlightCssText({ style: 'underline', color: '#3366ff' });
    expect(css).toContain('text-decoration');
    expect(css).toContain('underline');
    expect(css).toContain('#3366ff');
  });

  test('squiggly style uses a wavy underline', () => {
    expect(buildTtsHighlightCssText({ style: 'squiggly', color: '#ff0000' })).toContain('wavy');
  });

  test('strikethrough style uses line-through', () => {
    expect(buildTtsHighlightCssText({ style: 'strikethrough', color: '#ff0000' })).toContain(
      'line-through',
    );
  });
});
