import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { getExtractMapping } from 'foliate-js/footnotes.js';
import {
  FootnoteExtractMapping,
  getFootnoteSelectionCfi,
  getFootnoteLocalCfi,
} from '@/app/reader/utils/footnoteCfi';

const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');

const SECTION = `<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Notes</title></head>
  <body id="body01">
    <h1>Notes</h1>
    <ol class="notes">
      <li id="fn1">First note with <em>emphasis</em> inside.</li>
      <li id="fn2">Second note text, quite a bit longer than the first one.</li>
      <li id="fn3">Third note.</li>
    </ol>
    <dl>
      <dt id="dt1">term</dt>
      <dd>first definition line</dd>
      <dd>second definition line</dd>
      <dt id="dt2">other term</dt>
      <dd>other definition</dd>
    </dl>
    <div class="paragraph-notes">
      <p id="pn1"><a id="pn1a" href="#r1">1.</a> A paragraph-style note body.</p>
      <p id="pn2"><a id="pn2a" href="#r2">2.</a> Another paragraph-style note.</p>
    </div>
  </body>
</html>`;

const BASE_CFI = 'epubcfi(/6/12)';

// Simulate exactly what foliate-js FootnoteHandler#showFragment does to the
// popup document: compute the mapping, then extract the range into the body.
const simulatePopup = (
  doc: Document,
  buildRange: (doc: Document) => Range,
): FootnoteExtractMapping | null => {
  const range = buildRange(doc);
  const mapping = getExtractMapping(range) as FootnoteExtractMapping | null;
  const frag = range.extractContents();
  doc.body.replaceChildren();
  doc.body.appendChild(frag);
  return mapping;
};

// Resolve a full (spine-prefixed) CFI against a document, the way
// epub.js resolveCFI does: shift off the spine part, then toRange.
const resolveInDoc = (doc: Document, cfi: string): Range | null => {
  const parts = CFI.parse(cfi) as { parent?: unknown[] } & unknown[];
  ((parts.parent ?? parts) as unknown[]).shift();
  return CFI.toRange(doc, parts) as Range | null;
};

// The extraction ranges used by FootnoteHandler#showFragment branches.
const liContents = (doc: Document) => {
  const range = doc.createRange();
  range.selectNodeContents(doc.getElementById('fn2')!);
  return range;
};
const dtRun = (doc: Document) => {
  const dt = doc.getElementById('dt1')!;
  const range = doc.createRange();
  range.setStartBefore(dt);
  let sibling = dt.nextElementSibling;
  let lastDD = null;
  while (sibling && sibling.matches('dd')) {
    lastDD = sibling;
    sibling = sibling.nextElementSibling;
  }
  range.setEndAfter(lastDD || dt);
  return range;
};
const paragraphRun = (doc: Document) => {
  const p1 = doc.getElementById('pn1')!;
  const range = doc.createRange();
  range.setStartBefore(p1);
  range.setEndBefore(doc.getElementById('pn2')!);
  return range;
};

describe('footnote popup CFI mapping', () => {
  const roundTrip = (
    buildExtractRange: (doc: Document) => Range,
    buildSelection: (popupDoc: Document) => Range,
  ) => {
    const popupDoc = XHTML(SECTION);
    const pristineDoc = XHTML(SECTION);
    const mapping = simulatePopup(popupDoc, buildExtractRange);
    expect(mapping).not.toBeNull();
    const selection = buildSelection(popupDoc);
    const cfi = getFootnoteSelectionCfi(selection, mapping!, BASE_CFI);
    expect(cfi).toBeTruthy();
    const resolved = resolveInDoc(pristineDoc, cfi!);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe(selection.toString());
    return { popupDoc, pristineDoc, mapping: mapping!, cfi: cfi! };
  };

  it('maps a text selection inside an extracted <li> back to the pristine document', () => {
    const { cfi } = roundTrip(liContents, (popupDoc) => {
      // "Second note text" without the trailing part
      const text = popupDoc.body.firstChild!;
      const range = popupDoc.createRange();
      range.setStart(text, 7);
      range.setEnd(text, 16);
      return range;
    });
    expect(cfi).toContain('epubcfi(/6/12!');
  });

  it('maps a selection spanning elements in a <dt>/<dd> extraction', () => {
    roundTrip(dtRun, (popupDoc) => {
      // from inside the dt text to inside the second dd text
      const dt = popupDoc.getElementById('dt1')!;
      const dds = popupDoc.querySelectorAll('dd');
      const range = popupDoc.createRange();
      range.setStart(dt.firstChild!, 1);
      range.setEnd(dds[1]!.firstChild!, 6);
      return range;
    });
  });

  it('maps a selection in a paragraph-run extraction (setStartBefore/setEndBefore)', () => {
    roundTrip(paragraphRun, (popupDoc) => {
      const p = popupDoc.getElementById('pn1')!;
      // text node after the <a>: " A paragraph-style note body."
      const text = p.childNodes[1]!;
      const range = popupDoc.createRange();
      range.setStart(text, 3);
      range.setEnd(text, 12);
      return range;
    });
  });

  it('maps a select-all selection (body-level boundaries) via normalization', () => {
    roundTrip(liContents, (popupDoc) => {
      const range = popupDoc.createRange();
      range.setStart(popupDoc.body, 0);
      range.setEnd(popupDoc.body, popupDoc.body.childNodes.length);
      return range;
    });
  });

  it('reverse-maps a pristine-document annotation CFI into the popup', () => {
    const popupDoc = XHTML(SECTION);
    const pristineDoc = XHTML(SECTION);
    const mapping = simulatePopup(popupDoc, liContents)!;

    // An annotation on "note text" inside fn2 of the pristine document
    const fn2Text = pristineDoc.getElementById('fn2')!.firstChild!;
    const noteRange = pristineDoc.createRange();
    noteRange.setStart(fn2Text, 7);
    noteRange.setEnd(fn2Text, 16);
    const bookCfi = CFI.joinIndir(BASE_CFI, CFI.fromRange(noteRange)) as string;

    const localCfi = getFootnoteLocalCfi(bookCfi, mapping, popupDoc);
    expect(localCfi).toBeTruthy();
    const localRange = resolveInDoc(popupDoc, localCfi!);
    expect(localRange).not.toBeNull();
    expect(localRange!.toString()).toBe(noteRange.toString());
  });

  it('rejects reverse-mapping an annotation outside the extracted region', () => {
    const popupDoc = XHTML(SECTION);
    const pristineDoc = XHTML(SECTION);
    // popup shows fn2's contents only
    const mapping = simulatePopup(popupDoc, liContents)!;

    // annotation in fn1 (different container) must not map into the popup
    const fn1Text = pristineDoc.getElementById('fn1')!.firstChild!;
    const outside = pristineDoc.createRange();
    outside.setStart(fn1Text, 0);
    outside.setEnd(fn1Text, 5);
    const bookCfi = CFI.joinIndir(BASE_CFI, CFI.fromRange(outside)) as string;
    expect(getFootnoteLocalCfi(bookCfi, mapping, popupDoc)).toBeNull();
  });

  it('rejects reverse-mapping a same-container sibling outside a partial extraction', () => {
    const popupDoc = XHTML(SECTION);
    const pristineDoc = XHTML(SECTION);
    // popup shows dt1 + its two dds; dt2/dd stay outside but share the <dl>
    const mapping = simulatePopup(popupDoc, dtRun)!;

    const dt2Text = pristineDoc.getElementById('dt2')!.firstChild!;
    const outside = pristineDoc.createRange();
    outside.setStart(dt2Text, 0);
    outside.setEnd(dt2Text, 5);
    const bookCfi = CFI.joinIndir(BASE_CFI, CFI.fromRange(outside)) as string;
    expect(getFootnoteLocalCfi(bookCfi, mapping, popupDoc)).toBeNull();
  });

  it('returns null mapping for a range with text-node boundaries (resolved CFI anchors)', () => {
    const doc = XHTML(SECTION);
    const text = doc.getElementById('fn2')!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 10);
    expect(getExtractMapping(range)).toBeNull();
  });
});
