// Regression test for: highlights spanning a bullet list are not drawn over
// the list items.
//
// Overlayer splits a range into sub-ranges before collecting client rects so
// that fully-contained block elements don't contribute their border boxes
// (which over-highlight blank space between lines/paragraphs). The split was
// keyed on a hard-coded selector ('p, h1, h2, h3, h4'), so any text living in
// other block containers — li, blockquote, dd, td, ... — fell into no
// sub-range and was silently dropped from the drawn SVG rects whenever the
// range also touched a matching paragraph/heading.
//
// The fix splits by text nodes (plus replaced elements like img/svg), which
// covers every block type and still never yields block border boxes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Overlayer } from 'foliate-js/overlayer.js';

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// Records what content each getClientRects() call covered, so assertions can
// check which parts of the document contribute rects to the overlay.
let covered: string[] = [];

const describeRange = (range: Range): string => {
  const text = range.toString();
  const frag = range.cloneContents();
  return frag.querySelector('img, svg') ? `<replaced>${text}` : text;
};

function stubGetClientRects(this: Range): DOMRectList {
  covered.push(describeRange(this));
  const i = covered.length;
  const rect: RectLike = {
    left: 0,
    top: i * 20,
    right: 100,
    bottom: i * 20 + 10,
    width: 100,
    height: 10,
  };
  return [rect] as unknown as DOMRectList;
}

const realGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

const drawSpy = () => {
  const drawn: RectLike[] = [];
  const draw = (rects: RectLike[]) => {
    drawn.push(...rects);
    return document.createElementNS('http://www.w3.org/2000/svg', 'g');
  };
  return { drawn, draw };
};

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const textNode = (id: string) => {
  const node = byId(id).firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) throw new Error(`#${id} has no text node`);
  return node as Text;
};

describe('Overlayer rect splitting across block types', () => {
  beforeEach(() => {
    covered = [];
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: stubGetClientRects,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    if (realGetClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', realGetClientRects);
    } else {
      delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('draws rects for list items when a highlight spans paragraphs and a bullet list', () => {
    document.body.innerHTML = `
      <section>
        <p id="p1">The final role of taxes is to encourage certain behaviors.</p>
        <p id="p2">To summarize, taxes have four functions:</p>
        <ul>
          <li id="li1">Make people accept the currency.</li>
          <li>Redistribute income.</li>
          <li>Reduce consumption to fight inflation.</li>
          <li id="li4">Deter undesirable behaviors.</li>
        </ul>
      </section>`;
    const range = document.createRange();
    range.setStart(textNode('p1'), 0);
    range.setEnd(textNode('li4'), textNode('li4').length);

    const { drawn, draw } = drawSpy();
    const overlayer = new Overlayer(document);
    overlayer.add('annotation', range, draw);

    const text = covered.join('');
    expect(text).toContain('To summarize, taxes have four functions:');
    expect(text).toContain('Make people accept the currency.');
    expect(text).toContain('Redistribute income.');
    expect(text).toContain('Reduce consumption to fight inflation.');
    expect(text).toContain('Deter undesirable behaviors.');
    expect(drawn.length).toBeGreaterThan(0);

    // The range must stay split per block: a single getClientRects call over
    // the whole range would include block border boxes and over-highlight the
    // blank space between paragraphs (the reason the split exists).
    for (const chunk of covered) {
      expect(chunk.includes('To summarize') && chunk.includes('Make people')).toBe(false);
    }
  });

  it('does not double-draw text of paragraphs nested inside list items', () => {
    document.body.innerHTML = `
      <section>
        <p id="p1">Intro paragraph.</p>
        <ul>
          <li id="li1"><p id="nested">Paragraph inside a list item.</p></li>
        </ul>
      </section>`;
    const range = document.createRange();
    range.setStart(textNode('p1'), 0);
    range.setEnd(textNode('nested'), textNode('nested').length);

    const { draw } = drawSpy();
    const overlayer = new Overlayer(document);
    overlayer.add('annotation', range, draw);

    const hits = covered.filter((t) => t.includes('Paragraph inside a list item.'));
    expect(hits).toHaveLength(1);
  });

  it('covers other text blocks such as blockquotes', () => {
    document.body.innerHTML = `
      <section>
        <p id="p1">Before the quote.</p>
        <blockquote id="quote">Quoted text in a blockquote.</blockquote>
        <p id="p2">After the quote.</p>
      </section>`;
    const range = document.createRange();
    range.setStart(textNode('p1'), 0);
    range.setEnd(textNode('p2'), textNode('p2').length);

    const { draw } = drawSpy();
    const overlayer = new Overlayer(document);
    overlayer.add('annotation', range, draw);

    const text = covered.join('');
    expect(text).toContain('Before the quote.');
    expect(text).toContain('Quoted text in a blockquote.');
    expect(text).toContain('After the quote.');
  });

  it('clips the first and last blocks to the range boundaries', () => {
    document.body.innerHTML = `
      <section>
        <p id="p1">To summarize, taxes have four functions:</p>
        <ul>
          <li id="li1">Make people accept the currency.</li>
        </ul>
      </section>`;
    const start = textNode('p1');
    const end = textNode('li1');
    const range = document.createRange();
    range.setStart(start, 'To summarize, taxes have '.length);
    range.setEnd(end, 'Make people'.length);

    const { draw } = drawSpy();
    const overlayer = new Overlayer(document);
    overlayer.add('annotation', range, draw);

    const chunks = covered.filter((t) => t.trim() !== '');
    expect(chunks[0]).toBe('four functions:');
    expect(chunks[chunks.length - 1]).toBe('Make people');
  });

  it('still draws a rect for replaced elements like images inside the range', () => {
    document.body.innerHTML = `
      <section>
        <p id="p1">Before the image. <img src="cover.png" alt=""> After the image.</p>
      </section>`;
    const p = byId('p1');
    const range = document.createRange();
    range.selectNodeContents(p);

    const { draw } = drawSpy();
    const overlayer = new Overlayer(document);
    overlayer.add('annotation', range, draw);

    expect(covered.some((t) => t.startsWith('<replaced>'))).toBe(true);
    const text = covered.join('');
    expect(text).toContain('Before the image.');
    expect(text).toContain('After the image.');
  });
});
