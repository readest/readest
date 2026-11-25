// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { startInNextText } from '@/utils/cfi';

const XHTML = (body: string) =>
  new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );

const at = (doc: Document, node: Node, offset: number) => {
  const range = doc.createRange();
  range.setStart(node, offset);
  range.setEnd(node, (node as Text).length);
  return range;
};

describe('startInNextText', () => {
  it('moves a start read back at a dialogue span onto the text inside it', () => {
    const doc = XHTML(
      '<p>exclaimed Alice. <span class="readest-dialogue" cfi-skip="">“It’s a mineral,”</span> said Alice.</p>',
    );
    const quote = doc.querySelector('span')!.firstChild!;
    const original = at(doc, quote, 0);
    const resolved = CFI.toRange(doc, CFI.parse(CFI.fromRange(original)))!;
    // The read-back holds the same text position but sorts before the quote.
    expect(resolved.startContainer.textContent).toBe('exclaimed Alice. ');
    expect(resolved.compareBoundaryPoints(Range.START_TO_START, original)).toBe(-1);

    const moved = startInNextText(resolved);
    expect(moved.startContainer).toBe(quote);
    expect(moved.startOffset).toBe(0);
    expect(moved.compareBoundaryPoints(Range.END_TO_END, resolved)).toBe(0);
  });

  it('passes over an empty text node in the same chunk', () => {
    const doc = XHTML('<p>said Alice. <span cfi-skip="">“Off”</span></p>');
    const before = doc.querySelector('p')!.firstChild!;
    const quote = doc.querySelector('span')!.firstChild!;
    doc.querySelector('span')!.before(doc.createTextNode(''));
    const moved = startInNextText(at(doc, before, (before as Text).length));
    expect(moved.startContainer).toBe(quote);
  });

  it.each([
    ['inside a text node', '<p>said Alice. <span cfi-skip="">“Off”</span></p>', 3],
    ['before an element that takes a CFI step', '<p>said Alice. <em>Off</em></p>', -1],
    ['before text a CFI leaves out', '<p>said <span cfi-inert="">gloss</span>Alice</p>', -1],
    ['at the end of a paragraph', '<p>said Alice.</p><p>Off</p>', -1],
  ])('leaves a start %s alone', (_, body, offset) => {
    const doc = XHTML(body);
    const text = doc.querySelector('p')!.firstChild!;
    const range = at(doc, text, offset < 0 ? (text as Text).length : offset);
    expect(startInNextText(range)).toBe(range);
  });
});
