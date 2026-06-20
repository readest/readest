import { describe, it, expect } from 'vitest';
import { ParagraphIterator } from '@/utils/paragraph';

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

describe('ParagraphIterator', () => {
  it('skips whitespace-only paragraphs', async () => {
    const doc = createDoc(`
      <p>First</p>
      <p> </p>
      <p>&nbsp;</p>
      <p>​</p>
      <p><span> </span></p>
      <p><br /></p>
      <p>Second</p>
    `);

    const iterator = await ParagraphIterator.createAsync(doc, 1000);

    expect(iterator.length).toBe(2);
    expect(iterator.first()?.toString()).toContain('First');
    expect(iterator.next()?.toString()).toContain('Second');
  });

  it('keeps paragraphs with non-text content', async () => {
    const doc = createDoc(`
      <p>Intro</p>
      <p><img src="cover.png" alt="" /></p>
      <p>Outro</p>
    `);

    const iterator = await ParagraphIterator.createAsync(doc, 1000);

    expect(iterator.length).toBe(3);

    iterator.first();
    expect(iterator.current()?.toString()).toContain('Intro');

    const imageRange = iterator.next();
    const fragment = imageRange?.cloneContents();
    expect(fragment?.querySelector('img')).not.toBeNull();

    expect(iterator.next()?.toString()).toContain('Outro');
  });
});

describe('ParagraphIterator.findIndexByRange', () => {
  // Five compact, single-text-node blocks so indices map 1:1 to paragraphs.
  const buildIterator = async () => {
    const doc = createDoc(
      `<p id="b0">Zero</p><p id="b1">One</p><p id="b2">Two</p><p id="b3">Three</p><p id="b4">Four</p>`,
    );
    const iterator = await ParagraphIterator.createAsync(doc, 1000);
    return { doc, iterator };
  };

  // Builds a collapsed Range at `offset` inside the text node of paragraph `id`.
  const pointInside = (doc: Document, id: string, offset = 0): Range => {
    const el = doc.getElementById(id)!;
    const textNode = el.firstChild!;
    const range = doc.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset);
    return range;
  };

  it('returns the index of the block that contains the target start (containment)', async () => {
    const { doc, iterator } = await buildIterator();
    // A point inside block 2's text must resolve to 2 (not 1 or 3).
    const target = pointInside(doc, 'b2', 1);
    expect(iterator.findIndexByRange(target)).toBe(2);
  });

  it('returns -1 (not 0) when the target is after the last block', async () => {
    const { doc, iterator } = await buildIterator();
    // Append a node AFTER the iterator is built so it belongs to no block and
    // sits in document order past the last block's end.
    const trailing = doc.createElement('span');
    trailing.textContent = 'trailing';
    doc.body.appendChild(trailing);
    const range = doc.createRange();
    range.setStart(trailing.firstChild!, 0);
    range.collapse(true);
    expect(iterator.findIndexByRange(range)).toBe(-1);
  });

  it('returns the nearest following block when the target falls in a gap', async () => {
    const { doc, iterator } = await buildIterator();
    // Insert a node between block 2 and block 3 AFTER the iterator is built so
    // it sits in a genuine gap that no block range covers.
    const gap = doc.createElement('span');
    gap.textContent = 'gap';
    doc.body.insertBefore(gap, doc.getElementById('b3'));
    const range = doc.createRange();
    range.setStart(gap.firstChild!, 0);
    range.collapse(true);
    // No block contains the gap point; the nearest following block is index 3.
    expect(iterator.findIndexByRange(range)).toBe(3);
  });

  it('returns -1 when there are no blocks', async () => {
    const doc = createDoc(`<div></div>`);
    const iterator = await ParagraphIterator.createAsync(doc, 1000);
    expect(iterator.length).toBe(0);
    const range = doc.createRange();
    range.setStart(doc.body, 0);
    range.collapse(true);
    expect(iterator.findIndexByRange(range)).toBe(-1);
  });

  it('resolves correctly with a correct hint (fast path)', async () => {
    const { doc, iterator } = await buildIterator();
    const target = pointInside(doc, 'b3', 0);
    expect(iterator.findIndexByRange(target, 3)).toBe(3);
  });

  it('resolves correctly with a stale hint (binary-search fallback)', async () => {
    const { doc, iterator } = await buildIterator();
    const target = pointInside(doc, 'b1', 0);
    // Hint points far away (block 4); must still resolve to 1.
    expect(iterator.findIndexByRange(target, 4)).toBe(1);
  });
});
