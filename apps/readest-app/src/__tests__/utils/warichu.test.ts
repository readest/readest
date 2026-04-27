import { describe, it, expect } from 'vitest';
import { sliceHtml, removeFirstVisibleChar, removeLastVisibleChar } from '@/utils/warichu';

describe('sliceHtml', () => {
  it('returns the slice of plain text by visible-char positions', () => {
    expect(sliceHtml('Hello', 0, 3)).toBe('Hel');
    expect(sliceHtml('Hello', 2, 5)).toBe('llo');
  });

  it('keeps a fully-enclosing tag intact when the slice covers all visible chars', () => {
    expect(sliceHtml('<b>Hello</b>', 0, 5)).toBe('<b>Hello</b>');
  });

  it('keeps a fully-enclosing tag intact when slicing the prefix', () => {
    expect(sliceHtml('<b>Hello</b>', 0, 2)).toBe('<b>He</b>');
  });

  it('re-emits tags that were open before the slice start', () => {
    // Bug: previously returned "lo</b>" — orphan close tag.
    expect(sliceHtml('<b>Hello</b>', 3, 5)).toBe('<b>lo</b>');
    expect(sliceHtml('<b>Hello</b>', 2, 4)).toBe('<b>ll</b>');
  });

  it('handles nested tags open before the slice', () => {
    expect(sliceHtml('<b><i>Hello</i></b>', 2, 4)).toBe('<b><i>ll</i></b>');
  });

  it('treats HTML entities as one visible character', () => {
    // "A&amp;B" has 3 visible chars: A, &, B
    expect(sliceHtml('A&amp;B', 0, 1)).toBe('A');
    expect(sliceHtml('A&amp;B', 1, 2)).toBe('&amp;');
    expect(sliceHtml('A&amp;B', 0, 2)).toBe('A&amp;');
    expect(sliceHtml('A&amp;B', 2, 3)).toBe('B');
  });

  it('returns empty string when slice range is empty', () => {
    expect(sliceHtml('Hello', 2, 2)).toBe('');
  });
});

describe('removeFirstVisibleChar', () => {
  it('removes the first plain character', () => {
    expect(removeFirstVisibleChar('Hello')).toBe('ello');
  });

  it('skips opening tags and removes the first text character after them', () => {
    expect(removeFirstVisibleChar('<b>Hello</b>')).toBe('<b>ello</b>');
  });

  it('treats an HTML entity as a single visible character and removes it whole', () => {
    // Bug: previously returned "amp;rest" — corrupt.
    expect(removeFirstVisibleChar('&amp;rest')).toBe('rest');
    expect(removeFirstVisibleChar('&lt;X')).toBe('X');
  });

  it('handles a tag followed by an entity', () => {
    expect(removeFirstVisibleChar('<b>&amp;rest</b>')).toBe('<b>rest</b>');
  });
});

describe('removeLastVisibleChar', () => {
  it('removes the last plain character', () => {
    expect(removeLastVisibleChar('Hello')).toBe('Hell');
  });

  it('skips closing tags and removes the last text character before them', () => {
    expect(removeLastVisibleChar('<b>Hello</b>')).toBe('<b>Hell</b>');
  });

  it('treats a trailing HTML entity as a single visible character and removes it whole', () => {
    // Bug: previously returned "front&amp" — corrupt.
    expect(removeLastVisibleChar('front&amp;')).toBe('front');
    expect(removeLastVisibleChar('X&gt;')).toBe('X');
  });

  it('handles an entity wrapped in a closing tag', () => {
    expect(removeLastVisibleChar('<b>front&amp;</b>')).toBe('<b>front</b>');
  });

  it('treats a stray semicolon (not part of an entity) as a single character', () => {
    expect(removeLastVisibleChar('Hello;')).toBe('Hello');
  });
});
