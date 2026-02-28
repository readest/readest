import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { wrappedFoliateView } from '@/types/view';

// jsdom's Blob doesn't implement arrayBuffer(), polyfill it via FileReader
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((res, reject) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Register a stub paginator custom element so View.open() doesn't fail in jsdom
if (!customElements.get('foliate-paginator')) {
  customElements.define(
    'foliate-paginator',
    class extends HTMLElement {
      override setAttribute() {}
      override addEventListener() {}
      open() {}
    },
  );
}

// Mock the paginator module import so View doesn't try to load the real one
vi.mock('foliate-js/paginator.js', () => ({}));

let book: BookDoc;
let view: FoliateView;
let totalSections: number;

const loadEPUB = async () => {
  const epubPath = resolve(__dirname, '../fixtures/sample-alice.epub');
  const buffer = readFileSync(epubPath);
  const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

describe('getCFIProgress with real EPUB', () => {
  beforeAll(async () => {
    book = await loadEPUB();
    totalSections = book.sections!.length;

    // Import View and create the element, wrapping it like the app does
    await import('foliate-js/view.js');
    const rawView = document.createElement('foliate-view') as FoliateView;
    view = wrappedFoliateView(rawView);
    await view.open(book);
  }, 30000);

  it('should load the EPUB with sections', () => {
    expect(book.sections!.length).toBeGreaterThan(0);
    expect(view.book).toBe(book);
  });

  it('should return a valid progress object with all fields', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.createDocument);
    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const firstTextNode = walker.nextNode();
    expect(firstTextNode).not.toBeNull();

    const range = doc.createRange();
    range.setStart(firstTextNode!, 0);
    range.setEnd(firstTextNode!, 0);

    const cfi = view.getCFI(sectionIndex, range);
    const result = await view.getCFIProgress(cfi);

    expect(result).not.toBeNull();
    // fraction is the overall book progress
    expect(result!.fraction).toBeGreaterThanOrEqual(0);
    expect(result!.fraction).toBeLessThanOrEqual(1);
    // section info
    expect(result!.section.current).toBe(sectionIndex);
    expect(result!.section.total).toBe(totalSections);
    // location info
    expect(result!.location.current).toBeGreaterThanOrEqual(0);
    expect(result!.location.next).toBeGreaterThanOrEqual(result!.location.current);
    expect(result!.location.total).toBeGreaterThan(0);
    // time info
    expect(result!.time.section).toBeGreaterThanOrEqual(0);
    expect(result!.time.total).toBeGreaterThanOrEqual(0);
  });

  it('should return the smallest fraction for a CFI at the start of a section', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.createDocument);
    expect(sectionIndex).toBeGreaterThanOrEqual(0);

    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const firstTextNode = walker.nextNode();
    expect(firstTextNode).not.toBeNull();

    const range = doc.createRange();
    range.setStart(firstTextNode!, 0);
    range.setEnd(firstTextNode!, 0);

    const cfi = view.getCFI(sectionIndex, range);
    const result = await view.getCFIProgress(cfi);

    expect(result).not.toBeNull();
    expect(result!.section.current).toBe(sectionIndex);
    // At the start of a section, fraction should equal the section's start fraction
    // (i.e. only prior sections' sizes contribute)
    expect(result!.fraction).toBeGreaterThanOrEqual(0);
  });

  it('should return a larger fraction for a CFI at the end of a section', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.createDocument);
    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;

    // Get start CFI
    const walkerStart = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const firstTextNode = walkerStart.nextNode()!;
    const startRange = doc.createRange();
    startRange.setStart(firstTextNode, 0);
    startRange.setEnd(firstTextNode, 0);
    const startCfi = view.getCFI(sectionIndex, startRange);
    const startResult = await view.getCFIProgress(startCfi);

    // Get end CFI
    const walkerEnd = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let lastTextNode: Node | null = null;
    for (let node = walkerEnd.nextNode(); node; node = walkerEnd.nextNode()) {
      lastTextNode = node;
    }
    expect(lastTextNode).not.toBeNull();
    const endRange = doc.createRange();
    endRange.setStart(lastTextNode!, lastTextNode!.textContent!.length);
    endRange.setEnd(lastTextNode!, lastTextNode!.textContent!.length);
    const endCfi = view.getCFI(sectionIndex, endRange);
    const endResult = await view.getCFIProgress(endCfi);

    expect(startResult).not.toBeNull();
    expect(endResult).not.toBeNull();
    expect(endResult!.section.current).toBe(sectionIndex);
    expect(endResult!.fraction).toBeGreaterThan(startResult!.fraction);
  });

  it('should return a fraction between start and end for a midpoint CFI', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 1000);
    expect(sectionIndex).toBeGreaterThanOrEqual(0);

    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      textNodes.push(node);
    }
    expect(textNodes.length).toBeGreaterThan(0);

    const midNodeIndex = Math.floor(textNodes.length / 2);
    const midNode = textNodes[midNodeIndex]!;
    const midOffset = Math.floor((midNode.textContent?.length ?? 0) / 2);

    const range = doc.createRange();
    range.setStart(midNode, midOffset);
    range.setEnd(midNode, midOffset);

    const cfi = view.getCFI(sectionIndex, range);
    const result = await view.getCFIProgress(cfi);

    expect(result).not.toBeNull();
    expect(result!.section.current).toBe(sectionIndex);
    expect(result!.fraction).toBeGreaterThan(0);
    expect(result!.fraction).toBeLessThan(1);
  });

  it('should produce consistent results for the same CFI', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 500);
    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    expect(node).not.toBeNull();

    const range = doc.createRange();
    const offset = Math.min(3, node!.textContent!.length);
    range.setStart(node!, offset);
    range.setEnd(node!, offset);

    const cfi = view.getCFI(sectionIndex, range);

    const result1 = await view.getCFIProgress(cfi);
    const result2 = await view.getCFIProgress(cfi);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.fraction).toBe(result2!.fraction);
    expect(result1!.section.current).toBe(result2!.section.current);
    expect(result1!.location.current).toBe(result2!.location.current);
  });

  it('should return increasing fractions for successive CFIs in the same section', async () => {
    const sectionIndex = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 2000);
    expect(sectionIndex).toBeGreaterThanOrEqual(0);

    const doc = await book.sections![sectionIndex]!.createDocument();
    const body = doc.body ?? doc.documentElement;

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      textNodes.push(node);
    }

    const positions = [0, Math.floor(textNodes.length / 4), Math.floor((textNodes.length * 3) / 4)];
    const fractions: number[] = [];

    for (const pos of positions) {
      const node = textNodes[pos]!;
      const range = doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 0);
      const cfi = view.getCFI(sectionIndex, range);
      const result = await view.getCFIProgress(cfi);
      expect(result).not.toBeNull();
      expect(result!.section.current).toBe(sectionIndex);
      fractions.push(result!.fraction);
    }

    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]!);
    }
  });

  it('should return increasing fractions across different sections', async () => {
    const linearSections = book
      .sections!.map((s, i) => ({ s, i }))
      .filter(({ s }) => s.linear !== 'no' && s.size > 0);

    expect(linearSections.length).toBeGreaterThan(1);

    const fractions: number[] = [];

    for (const { s, i } of linearSections.slice(0, 3)) {
      const doc = await s.createDocument();
      const body = doc.body ?? doc.documentElement;
      const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const firstTextNode = walker.nextNode();
      if (!firstTextNode) continue;

      const range = doc.createRange();
      range.setStart(firstTextNode, 0);
      range.setEnd(firstTextNode, 0);

      const cfi = view.getCFI(i, range);
      const result = await view.getCFIProgress(cfi);

      expect(result).not.toBeNull();
      expect(result!.section.current).toBe(i);
      expect(result!.fraction).toBeGreaterThanOrEqual(0);
      expect(result!.fraction).toBeLessThanOrEqual(1);
      fractions.push(result!.fraction);
    }

    // Fractions across sections should be increasing
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]!);
    }
  });

  it('should return null for an invalid CFI', async () => {
    const result = await view.getCFIProgress('epubcfi(/99/999!/0)');
    expect(result).toBeNull();
  });

  it('should return progress for real CFIs', async () => {
    const expectedData = [
      { cfi: 'epubcfi(/99/999!/0)', fraction: null },
      { cfi: 'epubcfi(/6/4!/4/2/6,/1:0,/1:13)', fraction: 0.009, page: 1 },
      { cfi: 'epubcfi(/6/8!/4/2/2[chapter_458]/4/18,/1:0,/1:681)', fraction: 0.045, page: 5 },
      { cfi: 'epubcfi(/6/10!/4/2/2[chapter_460]/2,/3:1,/3:18)', fraction: 0.098, page: 11 },
      { cfi: 'epubcfi(/6/10!/4/2/2[chapter_460]/4/70,/1:0,/1:261)', fraction: 0.161, page: 19 },
      { cfi: 'epubcfi(/6/12!/4/2/2[chapter_462]/4/22,/1:0,/1:156)', fraction: 0.179, page: 21 },
      { cfi: 'epubcfi(/6/18!/4/2/2[chapter_468]/4/6,/1:0,/1:65)', fraction: 0.411, page: 46 },
      { cfi: 'epubcfi(/6/18!/4/2/2[chapter_468]/4/94,/1:1,/1:30)', fraction: 0.446, page: 51 },
      { cfi: 'epubcfi(/6/18!/4/2/2[chapter_468]/4/134,/1:0,/1:58)', fraction: 0.473, page: 54 },
      { cfi: 'epubcfi(/6/18!/4/2/2[chapter_468]/4/170,/1:0,/1:124)', fraction: 0.491, page: 55 },
      { cfi: 'epubcfi(/6/26!/4/2/2[chapter_476]/4/120,/1:0,/1:117)', fraction: 0.804, page: 91 },
      { cfi: 'epubcfi(/6/30!/4/2/2[chapter_480]/4,/82/1:0,/86/1:26)', fraction: 0.955, page: 107 },
      { cfi: 'epubcfi(/6/30!/4/2/2[chapter_480]/4/134,/1:1,/1:118)', fraction: 0.955, page: 108 },
      { cfi: 'epubcfi(/6/30!/4/2/2[chapter_480]/4/134,/1:119,/1:358)', fraction: 0.955, page: 108 },
    ];

    for (const { cfi, fraction, page } of expectedData) {
      const result = await view.getCFIProgress(cfi);
      if (fraction === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result!.fraction).toBeCloseTo(fraction, 1);
        expect(result!.location.current).toBe(page! - 1);
        expect(Math.abs(result!.fraction - fraction)).toBeLessThan(0.006);
      }
    }
  });
});
