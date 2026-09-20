import { describe, expect, it } from 'vitest';

import {
  getRangeOffsetsInParagraph,
  getSelectionRangeWithin,
  mapCloneSelectionToSource,
} from '@/app/reader/components/paragraph/paragraphSelection';

// The overlay clones the paragraph the way ParagraphOverlay.extractContent does:
// cloneContents() serialized to HTML and parsed back into a host element.
const cloneParagraph = (source: Range): HTMLDivElement => {
  const temp = document.createElement('div');
  temp.appendChild(source.cloneContents());
  const clone = document.createElement('div');
  clone.className = 'paragraph-content';
  clone.innerHTML = temp.innerHTML;
  document.body.appendChild(clone);
  return clone;
};

const createSource = (body: string, paragraphIndex = 0) => {
  const doc = new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');
  const paragraph = doc.querySelectorAll('p')[paragraphIndex]!;
  // A paragraph-mode range starts inside the block and ends before the next
  // one, exactly as ParagraphIterator builds them.
  const range = doc.createRange();
  range.setStart(paragraph, 0);
  range.setEndBefore(doc.querySelector('h2')!);
  return { doc, range };
};

const selectText = (root: Element, text: string): Range => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const nodes: { node: Text; start: number }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: offset });
    offset += (node as Text).data.length;
  }
  const full = nodes.map(({ node }) => node.data).join('');
  const start = full.indexOf(text);
  if (start < 0) throw new Error(`"${text}" not found in clone`);
  const end = start + text.length;
  const at = (pos: number, endSide: boolean) => {
    const entry = nodes.find(({ node, start: s }) =>
      endSide ? pos <= s + node.data.length && pos > s : pos < s + node.data.length,
    )!;
    return { node: entry.node, offset: pos - entry.start };
  };
  const range = root.ownerDocument.createRange();
  const from = at(start, false);
  const to = at(end, true);
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
};

describe('mapCloneSelectionToSource (#6200)', () => {
  it('maps a selection in the clone onto the same text in the book paragraph', () => {
    const { range } = createSource('<p>Hello <em>brave</em> new world</p><h2>Next</h2>');
    const clone = cloneParagraph(range);
    const selection = selectText(clone, 'brave new');

    const mapped = mapCloneSelectionToSource(clone, selection, range);

    expect(mapped?.toString()).toBe('brave new');
    expect(mapped?.startContainer.ownerDocument).toBe(range.startContainer.ownerDocument);
    clone.remove();
  });

  it('skips injected inert text on both sides so offsets stay aligned', () => {
    const { range } = createSource(
      '<p>Hello <span cfi-inert="true">[gloss]</span>brave new world</p><h2>Next</h2>',
    );
    const clone = cloneParagraph(range);
    const selection = selectText(clone, 'new world');

    const mapped = mapCloneSelectionToSource(clone, selection, range);

    expect(mapped?.toString()).toBe('new world');
    clone.remove();
  });

  it('returns null for a selection outside the clone', () => {
    const { range } = createSource('<p>Hello world</p><h2>Next</h2>');
    const clone = cloneParagraph(range);
    const other = document.createElement('p');
    other.textContent = 'elsewhere';
    document.body.appendChild(other);
    const selection = document.createRange();
    selection.selectNodeContents(other);

    expect(mapCloneSelectionToSource(clone, selection, range)).toBeNull();
    clone.remove();
    other.remove();
  });
});

describe('getSelectionRangeWithin (#6200)', () => {
  it('returns the live selection only when it is a non-empty range inside the container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hello world</p>';
    document.body.appendChild(container);
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    const sel = document.getSelection()!;

    sel.removeAllRanges();
    expect(getSelectionRangeWithin(container)).toBeNull();

    const inside = document.createRange();
    inside.selectNodeContents(container.querySelector('p')!);
    sel.addRange(inside);
    expect(getSelectionRangeWithin(container)?.toString()).toBe('Hello world');

    sel.removeAllRanges();
    const collapsed = document.createRange();
    collapsed.setStart(container.querySelector('p')!.firstChild!, 2);
    collapsed.collapse(true);
    sel.addRange(collapsed);
    expect(getSelectionRangeWithin(container)).toBeNull();

    sel.removeAllRanges();
    const elsewhere = document.createRange();
    elsewhere.selectNodeContents(outside);
    sel.addRange(elsewhere);
    expect(getSelectionRangeWithin(container)).toBeNull();

    sel.removeAllRanges();
    container.remove();
    outside.remove();
  });
});

describe('getRangeOffsetsInParagraph (#6200)', () => {
  const setup = (body: string, paragraphIndex = 0) => {
    const { doc, range } = createSource(body, paragraphIndex);
    const rangeOver = (text: string) => selectText(doc.body, text);
    return { doc, paragraph: range, rangeOver };
  };

  it('returns the offsets of an annotation inside the paragraph', () => {
    const { paragraph, rangeOver } = setup('<p>Hello <em>brave</em> new world</p><h2>Next</h2>');
    expect(getRangeOffsetsInParagraph(paragraph, rangeOver('brave new'))).toEqual({
      start: 6,
      end: 15,
    });
  });

  it('clips an annotation that starts before or ends after the paragraph', () => {
    const { doc, paragraph, rangeOver } = setup(
      '<p class="intro">Intro text</p><p>Hello brave new world</p><h2>Next</h2>',
      1,
    );
    const intro = doc.querySelector('.intro')!;
    const spill = doc.createRange();
    spill.setStart(intro.firstChild!, 6);
    spill.setEnd(rangeOver('brave').endContainer, rangeOver('brave').endOffset);
    expect(getRangeOffsetsInParagraph(paragraph, spill)).toEqual({ start: 0, end: 11 });

    const tail = doc.createRange();
    tail.setStart(rangeOver('new').startContainer, rangeOver('new').startOffset);
    tail.setEndAfter(doc.querySelector('h2')!);
    expect(getRangeOffsetsInParagraph(paragraph, tail)).toEqual({ start: 12, end: 21 });
  });

  it('returns null for an annotation elsewhere in the section', () => {
    const { doc, paragraph } = setup('<p>Hello world</p><h2>Next</h2><p>After</p>');
    const after = doc.createRange();
    after.selectNodeContents(doc.querySelectorAll('p')[1]!);
    expect(getRangeOffsetsInParagraph(paragraph, after)).toBeNull();
  });

  it('skips injected inert text when counting offsets', () => {
    const { paragraph, rangeOver } = setup(
      '<p>Hello <span cfi-inert="true">[gloss]</span>brave new world</p><h2>Next</h2>',
    );
    expect(getRangeOffsetsInParagraph(paragraph, rangeOver('new world'))).toEqual({
      start: 12,
      end: 21,
    });
  });
});
