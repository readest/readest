import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { parse, toRange, fromRange } from 'foliate-js/epubcfi.js';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';

const vendorDir = join(process.cwd(), 'public/vendor');

/**
 * Tests EPUB CFI resolution with a real PDF loaded via DocumentLoader.
 *
 * Reference CFIs captured from sample-alice.pdf in a full browser environment:
 *   - index 3: epubcfi(/6/8!/4/4,/94/1:0,/118/1:10)
 *   - index 4: epubcfi(/6/10!/4/4/42,/1:0,/1:46)
 *
 * In jsdom the canvas 2d context is unavailable, so createDocument() uses a
 * fallback that produces one <span> per getTextContent() item.  The element
 * count differs from the full TextLayer render, so these tests generate CFIs
 * from the fallback DOM and verify round-trip resolution.
 */
describe('PDF CFI resolution with real document', () => {
  let book: BookDoc;
  let doc3: Document;
  let doc4: Document;

  /** Shift the spine-level part from a parsed CFI (as view.js resolveCFI does). */
  const shiftSpine = (parts: ReturnType<typeof parse>) => {
    (parts.parent ?? parts).shift();
    return parts;
  };

  beforeAll(async () => {
    await import('foliate-js/pdf.js');
    const pdfjsLib = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
      GlobalWorkerOptions: { workerSrc: string };
    };
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      `file://${join(vendorDir, 'pdfjs/pdf.worker.min.mjs')}`,
    ).href;

    const pdfPath = resolve(__dirname, '../fixtures/data/sample-alice.pdf');
    const buffer = readFileSync(pdfPath);
    const file = new File([buffer], 'sample-alice.pdf', { type: 'application/pdf' });
    const loader = new DocumentLoader(file);
    const result = await loader.open();
    book = result.book;

    doc3 = await book.sections[3]!.createDocument();
    doc4 = await book.sections[4]!.createDocument();
  }, 30_000);

  // ---------- DOM structure -------------------------------------------------

  it('should have textLayer, canvas, and annotationLayer wrappers', () => {
    expect(doc3.querySelector('#canvas')).toBeTruthy();
    expect(doc3.querySelector('.textLayer')).toBeTruthy();
    expect(doc3.querySelector('.annotationLayer')).toBeTruthy();

    const textLayer = doc3.querySelector('.textLayer')!;
    expect(textLayer.children.length).toBeGreaterThan(0);
  });

  // ---------- Round-trip: fromRange → parse → toRange -----------------------

  it('should round-trip a range CFI on page 3', () => {
    const textLayer = doc3.querySelector('.textLayer')!;
    const spans = textLayer.querySelectorAll('span');
    // Find a span with enough text content
    let targetSpan: Element | null = null;
    for (const span of spans) {
      if (span.firstChild && span.firstChild.textContent!.length >= 10) {
        targetSpan = span;
        break;
      }
    }
    expect(targetSpan).toBeTruthy();

    const srcRange = doc3.createRange();
    srcRange.setStart(targetSpan!.firstChild!, 0);
    srcRange.setEnd(targetSpan!.firstChild!, 10);
    const expectedText = srcRange.toString();

    const cfi = fromRange(srcRange);
    const parts = parse(cfi);
    const resolved = toRange(doc3, parts);

    expect(resolved).toBeInstanceOf(Range);
    expect(resolved!.toString()).toBe(expectedText);
  });

  it('should round-trip a range CFI on page 4', () => {
    const textLayer = doc4.querySelector('.textLayer')!;
    const spans = textLayer.querySelectorAll('span');
    let targetSpan: Element | null = null;
    for (const span of spans) {
      if (span.firstChild && span.firstChild.textContent!.length >= 10) {
        targetSpan = span;
        break;
      }
    }
    expect(targetSpan).toBeTruthy();

    const srcRange = doc4.createRange();
    srcRange.setStart(targetSpan!.firstChild!, 0);
    srcRange.setEnd(targetSpan!.firstChild!, 10);
    const expectedText = srcRange.toString();

    const cfi = fromRange(srcRange);
    const parts = parse(cfi);
    const resolved = toRange(doc4, parts);

    expect(resolved).toBeInstanceOf(Range);
    expect(resolved!.toString()).toBe(expectedText);
  });

  it('should round-trip a multi-span range CFI', () => {
    const textLayer = doc3.querySelector('.textLayer')!;
    const spans = textLayer.querySelectorAll('span');
    // Select a range spanning two different spans
    const span1 = spans[0]!;
    const span2 = spans[2]!;
    expect(span1.firstChild).toBeTruthy();
    expect(span2.firstChild).toBeTruthy();

    const srcRange = doc3.createRange();
    srcRange.setStart(span1.firstChild!, 0);
    const endOffset = Math.min(5, span2.firstChild!.textContent!.length);
    srcRange.setEnd(span2.firstChild!, endOffset);
    const expectedText = srcRange.toString();

    const cfi = fromRange(srcRange);
    const parts = parse(cfi);
    const resolved = toRange(doc3, parts);

    expect(resolved).toBeInstanceOf(Range);
    expect(resolved!.toString()).toBe(expectedText);
  });

  it('should round-trip a collapsed (point) CFI', () => {
    const textLayer = doc3.querySelector('.textLayer')!;
    const span = textLayer.querySelector('span')!;
    expect(span.firstChild).toBeTruthy();

    const srcRange = doc3.createRange();
    srcRange.setStart(span.firstChild!, 3);
    srcRange.collapse(true);

    const cfi = fromRange(srcRange);
    const parts = parse(cfi);
    const resolved = toRange(doc3, parts);

    expect(resolved).toBeInstanceOf(Range);
    expect(resolved!.collapsed).toBe(true);
  });

  // ---------- Cross-page CFI mismatch ---------------------------------------

  it('should fail to resolve a page 3 CFI on page 4 document', () => {
    const textLayer = doc3.querySelector('.textLayer')!;
    const spans = textLayer.querySelectorAll('span');
    // Pick the last span so its index likely exceeds page 4's element count
    const lastSpan = spans[spans.length - 1]!;
    expect(lastSpan.firstChild).toBeTruthy();

    const srcRange = doc3.createRange();
    srcRange.setStart(lastSpan.firstChild!, 0);
    const endOffset = Math.min(5, lastSpan.firstChild!.textContent!.length);
    srcRange.setEnd(lastSpan.firstChild!, endOffset);

    const cfi = fromRange(srcRange);
    const parts = parse(cfi);
    const range = toRange(doc4, parts);
    // May resolve to a different node or return null depending on DOM sizes;
    // either way it should NOT match the original text
    if (range) {
      expect(range.toString()).not.toBe(srcRange.toString());
    }
  });

  // ---------- Reference CFI format verification -----------------------------

  it('should parse real browser-captured CFIs correctly', () => {
    // These CFIs were captured from sample-alice.pdf in a full browser with
    // TextLayer.  They verify that the CFI format is structurally valid.
    const cfi3 = 'epubcfi(/6/8!/4/4,/94/1:0,/118/1:10)';
    const cfi4 = 'epubcfi(/6/10!/4/4/42,/1:0,/1:46)';

    const parts3 = parse(cfi3);
    expect(parts3.parent).toBeTruthy();
    expect(parts3.start).toBeTruthy();
    expect(parts3.end).toBeTruthy();

    const parts4 = parse(cfi4);
    expect(parts4.parent).toBeTruthy();
    expect(parts4.start).toBeTruthy();
    expect(parts4.end).toBeTruthy();
  });

  it('should encode the correct section index in CFI spine step', () => {
    // Section index 3 → spine step /6/8, section index 4 → spine step /6/10
    const cfi3 = 'epubcfi(/6/8!/4/4,/94/1:0,/118/1:10)';
    const cfi4 = 'epubcfi(/6/10!/4/4/42,/1:0,/1:46)';

    expect(cfi3).toContain('/6/8!');
    expect(cfi4).toContain('/6/10!');

    // Spine step /6/N: N = (index + 1) * 2
    // index 3 → (3+1)*2 = 8, index 4 → (4+1)*2 = 10
    const parts3 = parse(cfi3);
    expect(parts3.parent[0][0].index).toBe(6);
    expect(parts3.parent[0][1].index).toBe(8);

    const parts4 = parse(cfi4);
    expect(parts4.parent[0][0].index).toBe(6);
    expect(parts4.parent[0][1].index).toBe(10);
  });

  // ---------- Out-of-bounds CFI indices -------------------------------------

  it('should return null when CFI child indices exceed the DOM', () => {
    const cfi = 'epubcfi(/6/8!/4/4,/9000/1:0,/9002/1:5)';
    const parts = shiftSpine(parse(cfi));
    const range = toRange(doc3, parts);
    expect(range).toBeNull();
  });

  it('should return null for a simple CFI with an unreachable node', () => {
    const cfi = 'epubcfi(/6/8!/4/9000/1:0)';
    const parts = shiftSpine(parse(cfi));
    const range = toRange(doc3, parts);
    expect(range).toBeNull();
  });

  it('should return null when start resolves but end does not', () => {
    const cfi = 'epubcfi(/6/8!/4/4,/2/1:0,/9999/1:5)';
    const parts = shiftSpine(parse(cfi));
    const range = toRange(doc3, parts);
    expect(range).toBeNull();
  });
});
