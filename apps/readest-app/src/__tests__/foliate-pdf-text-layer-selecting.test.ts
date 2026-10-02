// readest/readest issues #5599 and #4945: dragging an Android selection handle
// over a PDF page, or dragging a mouse selection across a column gutter in a
// Chromium older than 148, made the selection jump to the end of the page.
//
// The pdf.js text layer is absolutely positioned spans over the canvas. Between
// them (column gutters, margins, short lines) a hit test lands on the bare
// `.textLayer`, which resolves to the end of its content. pdf.js covers those
// gaps with `.endOfContent` (user-select: none) while the layer carries
// `selecting`. That class was only set between pointerdown and pointerup on
// the layer, but Android drags its native handles without sending any pointer
// event to the page: after the long-press finger lifts, every handle drag ran
// with the gaps uncovered.
//
// `selecting` must follow the document selection instead. Covering the gaps
// isn't enough on its own either: a point on `.endOfContent` resolves to the
// text just before it, the end of the page. pdf.js therefore moves it next to
// the end of the selection that is moving, so a point in a gap holds the
// selection where it is (Chromium 148+ needs that only for touch handles).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPanningEvents } from 'foliate-js/pdf.js';

vi.mock('@pdfjs/pdf.min.mjs', () => ({}));

// Each PDF page lives in its own iframe.
const createPage = () => {
  const iframe = document.createElement('iframe');
  document.body.replaceChildren(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div class="textLayer"><span>One </span><span>two </span><span>three</span>' +
    '<div class="endOfContent"></div></div>';
  setupPanningEvents(doc);
  return doc;
};

const spans = (doc: Document) => [...doc.querySelectorAll('.textLayer span')];

// Selects from the start of span `from` to the end of span `to`.
const select = (doc: Document, from = 0, to = 0) => {
  const range = doc.createRange();
  range.setStart(spans(doc)[from]!.firstChild!, 0);
  range.setEnd(spans(doc)[to]!.firstChild!, spans(doc)[to]!.textContent!.length);
  doc.getSelection()!.removeAllRanges();
  doc.getSelection()!.addRange(range);
  doc.dispatchEvent(new Event('selectionchange'));
};

const endOfContent = (doc: Document) => doc.querySelector('.endOfContent')!;

const isSelecting = (doc: Document) =>
  doc.querySelector('.textLayer')!.classList.contains('selecting');

describe('pdf text layer selecting state (#5599)', () => {
  let doc: Document;
  beforeEach(() => {
    doc = createPage();
  });

  it('marks the layer as selecting when the selection changes without a pointer event', () => {
    select(doc);
    expect(isSelecting(doc)).toBe(true);
  });

  it('keeps the layer selecting after the long-press finger lifts with text selected', () => {
    const layer = doc.querySelector('.textLayer')!;
    layer.classList.add('selecting'); // what pointerdown on the text sets
    select(doc);
    layer.dispatchEvent(new Event('pointerup'));
    expect(isSelecting(doc)).toBe(true);
  });

  it('stays selecting through the collapsed caret a mouse drag starts with', () => {
    const layer = doc.querySelector('.textLayer')!;
    const span = layer.querySelector('span')!;
    doc.elementFromPoint = () => span;
    layer.dispatchEvent(new Event('pointerdown'));
    doc.getSelection()!.collapse(span.firstChild!, 2);
    doc.dispatchEvent(new Event('selectionchange'));
    expect(isSelecting(doc)).toBe(true);
  });

  it('drops the selecting state once the selection is cleared', () => {
    select(doc);
    doc.getSelection()!.removeAllRanges();
    doc.dispatchEvent(new Event('selectionchange'));
    expect(isSelecting(doc)).toBe(false);
  });

  it('drops the selecting state on pointerup when nothing is selected', () => {
    const layer = doc.querySelector('.textLayer')!;
    layer.classList.add('selecting');
    layer.dispatchEvent(new Event('pointerup'));
    expect(isSelecting(doc)).toBe(false);
  });

  it('moves the gap cover right after the end of the selection that is moving', () => {
    select(doc, 0, 1);
    expect(endOfContent(doc).previousSibling).toBe(spans(doc)[1]);
    select(doc, 0, 0);
    expect(endOfContent(doc).previousSibling).toBe(spans(doc)[0]);
  });

  it('moves the gap cover right before the start when the start is moving', () => {
    select(doc, 2, 2);
    select(doc, 1, 2);
    expect(endOfContent(doc).nextSibling).toBe(spans(doc)[1]);
  });

  it('keeps the moved gap cover out of CFIs', () => {
    select(doc, 0, 1);
    expect(endOfContent(doc).hasAttribute('cfi-inert')).toBe(true);
  });

  it('puts the gap cover back at the end of the layer once the selection is cleared', () => {
    select(doc, 0, 1);
    doc.getSelection()!.removeAllRanges();
    doc.dispatchEvent(new Event('selectionchange'));
    expect(doc.querySelector('.textLayer')!.lastElementChild).toBe(endOfContent(doc));
  });
});
