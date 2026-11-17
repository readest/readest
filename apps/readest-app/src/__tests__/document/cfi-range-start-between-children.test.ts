import { describe, expect, it } from 'vitest';
import { fromRange, parse, toRange } from 'foliate-js/epubcfi.js';

// readest/readest#7482: WebKit reports a selection that starts right after an
// inline element as (parent, childIndex). A CFI step keeps an offset only for
// text, so that start was read back as the element's start and the highlight
// was drawn from the start of the paragraph instead of the selected word.
const doc = new DOMParser().parseFromString(
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body>' +
    '<p>Alpha <em>bravo <b>charlie</b></em> delta <img alt=""/> echo</p>' +
    '</body></html>',
  'application/xhtml+xml',
);
const p = doc.querySelector('p')!;
const em = doc.querySelector('em')!;
const b = doc.querySelector('b')!;
const img = doc.querySelector('img')!;
const tail = p.childNodes[2] as Text; // " delta "

const roundTrip = (range: Range) => toRange(doc, parse(fromRange(range))) as Range | null;

describe('CFI of a range starting between children (#7482)', () => {
  it.each([
    ['after an inline element', p, 2, tail, 6, ' delta'],
    ["after an inline element's last child", em, 2, tail, 6, ' delta'],
    ['after a nested inline element', b, 1, tail, 6, ' delta'],
  ] as const)('keeps a start %s', (_, startNode, startOffset, endNode, endOffset, text) => {
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    expect(range.toString()).toBe(text);
    expect(roundTrip(range)?.toString()).toBe(text);
  });

  // The image has no text, so the text alone can't show whether it was kept.
  it('keeps a start before a void element', () => {
    const range = doc.createRange();
    range.setStart(p, 3);
    range.setEnd(p, 5);
    const restored = roundTrip(range)!;
    expect(restored.toString()).toBe(' echo');
    expect(restored.intersectsNode(img)).toBe(true);
  });

  // A cfi-skip wrapper (Word Lens, translation, dialogue spans) has no CFI
  // step of its own: its children are indexed as the parent's.
  it('keeps a start before a cfi-skip wrapper', () => {
    const skipDoc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body>' +
        '<p>Alpha <b>bravo</b><span cfi-skip="">charlie</span> delta</p>' +
        '</body></html>',
      'application/xhtml+xml',
    );
    const para = skipDoc.querySelector('p')!;
    const range = skipDoc.createRange();
    range.setStart(para, 2);
    range.setEnd(skipDoc.querySelector('span')!.firstChild!, 'charlie'.length);
    expect(range.toString()).toBe('charlie');
    const restored = toRange(skipDoc, parse(fromRange(range))) as Range | null;
    expect(restored?.toString()).toBe('charlie');
  });

  it('keeps a collapsed range after an inline element at that point', () => {
    const range = doc.createRange();
    range.setStart(p, 2);
    const after = toRange(doc, parse(fromRange(range))) as Range;
    after.setEnd(tail, 6);
    expect(after.toString()).toBe(' delta');
  });
});
