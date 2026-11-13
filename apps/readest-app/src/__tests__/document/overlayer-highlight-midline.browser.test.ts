// Reproduction for readest/readest#7482: a highlight of a mid-line selection
// extends to the entire line instead of covering only the selected text.
// The draw path (range -> client rects -> SVG strip) is fine: the first
// tests below pass against foliate's Overlayer unchanged. The bug is in the
// CFI round-trip: WebKit reports a selection starting right after an inline
// element as (parent, childIndex), and foliate's nodeToParts keeps an offset
// only for text, so fromRange writes such a start as the element and toRange
// reads it back as the element's start — the saved highlight then paints
// from the start of the line. normalizeRangeForCfi moves the start into the
// text node it sits in before the range becomes a CFI; these tests pin that
// the normalized range round-trips with its text intact.
import { afterEach, describe, expect, it } from 'vitest';

import { Overlayer } from 'foliate-js/overlayer.js';
import * as epubcfi from 'foliate-js/epubcfi.js';
import { normalizeRangeForCfi } from '@/utils/cfi';

let frame: HTMLIFrameElement | null = null;

afterEach(() => {
  frame?.remove();
  frame = null;
});

const TEXT =
  'The quick brown fox jumps over the lazy dog and then runs away into the ' +
  'forest where the tall trees stand in the morning light every single day.';

const loadDoc = async () => {
  frame = document.createElement('iframe');
  frame.style.width = '400px';
  frame.style.height = '600px';
  frame.style.border = '0';
  frame.srcdoc = `<!doctype html><html><head><style>
    * { margin: 0; padding: 0; }
    body { width: 400px; font: 16px/24px serif; }
    p { width: 400px; }
  </style></head><body><p id="p">${TEXT}</p></body></html>`;
  document.body.append(frame);
  await new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
  return frame.contentDocument!;
};

// Like foliate's paginator: the section document is laid out in CSS columns,
// one column per page, so a range's client rects tile across columns.
const loadColumnDoc = async () => {
  frame = document.createElement('iframe');
  frame.style.width = '400px';
  frame.style.height = '600px';
  frame.style.border = '0';
  frame.srcdoc = `<!doctype html><html><head><style>
    * { margin: 0; padding: 0; }
    html { column-width: 400px; column-gap: 0; height: 240px; }
    body { font: 16px/24px serif; }
    p { width: 400px; }
  </style></head><body><p id="p">${TEXT} ${TEXT}</p></body></html>`;
  document.body.append(frame);
  await new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
  return frame.contentDocument!;
};

const textNode = (doc: Document) => {
  const node = doc.getElementById('p')!.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) throw new Error('no text node');
  return node as Text;
};

// The SVG shapes Overlayer.highlight drew, as [x, width] pairs.
const drawnStrips = (overlayer: Overlayer) => {
  const svg = overlayer.element as unknown as SVGSVGElement;
  // Only shapes inside the highlight <g> groups — the <defs> clipPath <path>
  // is not a drawn strip.
  return Array.from(svg.querySelectorAll('g > rect, g > path')).map((el) => {
    if (el.tagName === 'rect') {
      return { x: Number(el.getAttribute('x')), width: Number(el.getAttribute('width')) };
    }
    // path: parse the M x y ... L x+w y bounding box from the d attribute
    const nums = (el.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const xs = nums.filter((_, i) => i % 2 === 0);
    return { x: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs) };
  });
};

describe('Overlayer highlight of a mid-line selection (#7482)', () => {
  it('paints only the selected words on a single line', async () => {
    const doc = await loadDoc();
    const text = textNode(doc);
    // "brown fox jumps" sits mid-line on the first line.
    const start = TEXT.indexOf('brown');
    const end = TEXT.indexOf('jumps') + 'jumps'.length;
    const range = doc.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    const expected = Array.from(range.getClientRects());
    expect(expected.length).toBeGreaterThan(0);

    const overlayer = new Overlayer(doc);
    doc.body.append(overlayer.element as unknown as Node);
    overlayer.add('annotation', range, Overlayer.highlight, { radius: 0, radiusPadding: 0 });

    const strips = drawnStrips(overlayer);
    expect(strips).toHaveLength(expected.length);
    for (const [i, strip] of strips.entries()) {
      expect(strip.x, `strip ${i} x`).toBeCloseTo(expected[i]!.left, 0);
      expect(strip.width, `strip ${i} width`).toBeCloseTo(expected[i]!.width, 0);
    }
  });

  it('paints only the selected part of the last line of a multi-line selection', async () => {
    const doc = await loadDoc();
    const text = textNode(doc);
    const start = TEXT.indexOf('quick');
    const end = TEXT.indexOf('forest') + 'forest'.length;
    const range = doc.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    const expected = Array.from(range.getClientRects());
    expect(expected.length).toBeGreaterThan(1);

    const overlayer = new Overlayer(doc);
    doc.body.append(overlayer.element as unknown as Node);
    overlayer.add('annotation', range, Overlayer.highlight, { radius: 0, radiusPadding: 0 });

    const strips = drawnStrips(overlayer);
    expect(strips).toHaveLength(expected.length);
    const last = strips.length - 1;
    expect(strips[last]!.x, 'last strip x').toBeCloseTo(expected[last]!.left, 0);
    expect(strips[last]!.width, 'last strip width').toBeCloseTo(expected[last]!.width, 0);
  });

  it('paints only the selected part of the last line in a paginated column layout', async () => {
    const doc = await loadColumnDoc();
    const text = textNode(doc);
    const full = text.data;
    // A selection that ends mid-line on the last line of the first column.
    const start = full.indexOf('quick');
    const end = full.indexOf('forest') + 'forest'.length;
    const range = doc.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    const expected = Array.from(range.getClientRects());
    expect(expected.length).toBeGreaterThan(1);

    const overlayer = new Overlayer(doc);
    doc.body.append(overlayer.element as unknown as Node);
    overlayer.add('annotation', range, Overlayer.highlight, { radius: 0, radiusPadding: 0 });

    const strips = drawnStrips(overlayer);
    expect(strips).toHaveLength(expected.length);
    for (const [i, strip] of strips.entries()) {
      expect(strip.x, `strip ${i} x`).toBeCloseTo(expected[i]!.left, 0);
      expect(strip.width, `strip ${i} width`).toBeCloseTo(expected[i]!.width, 0);
    }
  });

  it('keeps the mid-line end after a CFI round-trip', async () => {
    const doc = await loadDoc();
    const text = textNode(doc);
    const start = TEXT.indexOf('brown');
    const end = TEXT.indexOf('jumps') + 'jumps'.length;
    const range = doc.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);

    const cfi = epubcfi.fromRange(range);
    const resolved = epubcfi.toRange(doc, epubcfi.parse(cfi)) as Range | null;
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe(range.toString());

    const expected = Array.from(resolved!.getClientRects());
    const overlayer = new Overlayer(doc);
    doc.body.append(overlayer.element as unknown as Node);
    overlayer.add('annotation', resolved!, Overlayer.highlight, { radius: 0, radiusPadding: 0 });

    const strips = drawnStrips(overlayer);
    expect(strips).toHaveLength(expected.length);
    for (const [i, strip] of strips.entries()) {
      expect(strip.width, `strip ${i} width`).toBeCloseTo(expected[i]!.width, 0);
    }
  });
});

describe('CFI round-trip of element-boundary selections (#7482)', () => {
  // WebKit reports a selection that starts exactly at an inline-element
  // boundary as (parent, childIndex) rather than (text, 0). foliate's
  // nodeToParts keeps an offset only for text, so such a start is written as
  // the element and read back as its start — the drawn highlight then covers
  // text before the selection, back to the start of the line (or paragraph).
  // normalizeRangeForCfi moves the start into the text node it sits in
  // before the range becomes a CFI, so the round-trip must keep the text.
  const MARKUP =
    'Alpha <em id="em">bravo charlie</em> delta echo foxtrot golf hotel india ' +
    'juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform ' +
    'victor whiskey xray yankee zulu.';

  const loadMarkupDoc = async () => {
    frame = document.createElement('iframe');
    frame.style.width = '400px';
    frame.style.height = '600px';
    frame.style.border = '0';
    frame.srcdoc = `<!doctype html><html><head><style>
      * { margin: 0; padding: 0; }
      body { width: 400px; font: 16px/24px serif; }
      p { width: 400px; }
    </style></head><body><p id="p">${MARKUP}</p></body></html>`;
    document.body.append(frame);
    await new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
    return frame.contentDocument!;
  };

  const roundTrip = (doc: Document, range: Range) => {
    const fixed = normalizeRangeForCfi(range);
    const cfi = epubcfi.fromRange(fixed);
    const resolved = epubcfi.toRange(doc, epubcfi.parse(cfi));
    expect(resolved, `CFI ${cfi} must resolve`).not.toBeNull();
    return resolved!;
  };

  it('keeps a start at (parent, index) after an inline element', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const tail = p.childNodes[2] as Text; // " delta echo ..."
    const range = doc.createRange();
    range.setStart(p, 2); // right after the <em>, i.e. start of " delta"
    range.setEnd(tail, ' delta'.length);
    expect(range.toString()).toBe(' delta');

    expect(roundTrip(doc, range).toString()).toBe(' delta');
  });

  it('keeps a start at (inline element, childCount)', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const em = doc.getElementById('em')!;
    const tail = p.childNodes[2] as Text;
    const range = doc.createRange();
    range.setStart(em, 1); // right after the em's text child
    range.setEnd(tail, ' delta'.length);
    expect(range.toString()).toBe(' delta');

    expect(roundTrip(doc, range).toString()).toBe(' delta');
  });

  it('keeps an end at (parent, index) after an inline element', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const head = p.childNodes[0] as Text; // "Alpha "
    const range = doc.createRange();
    range.setStart(head, 0);
    range.setEnd(p, 2); // right after the <em>
    expect(range.toString()).toBe('Alpha bravo charlie');

    expect(roundTrip(doc, range).toString()).toBe('Alpha bravo charlie');
  });

  it('keeps an end at (inline element, childCount)', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const head = p.childNodes[0] as Text;
    const em = doc.getElementById('em')!;
    const range = doc.createRange();
    range.setStart(head, 0);
    range.setEnd(em, 1); // right after the em's text child
    expect(range.toString()).toBe('Alpha bravo charlie');

    expect(roundTrip(doc, range).toString()).toBe('Alpha bravo charlie');
  });

  it('leaves the original range untouched', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const tail = p.childNodes[2] as Text; // " delta echo ..."
    const range = doc.createRange();
    range.setStart(p, 2); // right after the <em>
    range.setEnd(tail, ' delta'.length);

    const fixed = normalizeRangeForCfi(range);
    expect(fixed.startContainer).toBe(tail);
    expect(fixed.startOffset).toBe(0);
    expect(range.startContainer).toBe(p);
    expect(range.startOffset).toBe(2);
  });

  it('keeps a collapsed range at an element boundary collapsed', async () => {
    const doc = await loadMarkupDoc();
    const p = doc.getElementById('p')!;
    const tail = p.childNodes[2] as Text; // " delta echo ..."
    const range = doc.createRange();
    range.setStart(p, 2);
    range.setEnd(p, 2);

    const fixed = normalizeRangeForCfi(range);
    expect(fixed.collapsed).toBe(true);
    expect(fixed.toString()).toBe('');
    expect(fixed.startContainer).toBe(tail);
    expect(fixed.startOffset).toBe(0);
  });

  it('keeps a start at the end of a nested inline element', async () => {
    frame = document.createElement('iframe');
    frame.style.width = '400px';
    frame.style.height = '600px';
    frame.style.border = '0';
    frame.srcdoc = `<!doctype html><html><head><style>
      * { margin: 0; padding: 0; }
      body { width: 400px; font: 16px/24px serif; }
      p { width: 400px; }
    </style></head><body><p id="p">Alpha <em>bravo</em> <strong id="strong">charlie delta</strong> echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu.</p></body></html>`;
    document.body.append(frame);
    await new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
    const doc = frame.contentDocument!;
    const p = doc.getElementById('p')!;
    const strong = doc.getElementById('strong')!;
    const tail = p.childNodes[4] as Text; // " echo foxtrot ..."
    const range = doc.createRange();
    range.setStart(strong, 1); // right after the strong's text child
    range.setEnd(tail, ' echo'.length);
    expect(range.toString()).toBe(' echo');

    expect(roundTrip(doc, range).toString()).toBe(' echo');
  });
});
