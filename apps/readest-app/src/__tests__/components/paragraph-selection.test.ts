import { describe, expect, it } from 'vitest';

import {
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

const createSource = (body: string) => {
  const doc = new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');
  const paragraph = doc.querySelector('p')!;
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
