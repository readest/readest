import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader, CFI } from '@/libs/document';
import type { BookDoc, TOCItem } from '@/libs/document';
import { computeBookNav, hydrateBookNav, updateToc, findTocItemBS } from '@/services/nav';

// Simulates an annotation deep inside a section, past the chapter heading.
// Section CFIs look like `epubcfi(/6/2)` and TOC item CFIs point at the heading
// (e.g. `epubcfi(/6/2!/4/2[ch01])`), so a real annotation lives after that —
// e.g. inside a <p> sibling, reached via `CFI.joinIndir`.
const ANNOTATION_PATH = '/4/4/1:0';

// Polyfill CSS.escape for jsdom
if (typeof globalThis['CSS'] === 'undefined') {
  (globalThis as Record<string, unknown>)['CSS'] = {
    escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
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

/**
 * Regression test for https://github.com/readest/readest/issues/3688
 *
 * When TOC entries use fragment-suffixed hrefs (e.g. ch01.xhtml#ch01),
 * all annotations were incorrectly grouped under the last chapter.
 * This happened because section subitems created during EPUB init had
 * cfi: undefined, and the sectionsMap lookup found these subitems
 * instead of the parent sections with valid CFIs.
 */
describe('TOC-to-CFI mapping with fragment hrefs (#3688)', () => {
  let book: BookDoc;

  beforeAll(async () => {
    const epubPath = resolve(__dirname, '../fixtures/data/repro-3688.epub');
    const buffer = readFileSync(epubPath);
    const file = new File([buffer], 'repro-3688.epub', {
      type: 'application/epub+zip',
    });
    const loader = new DocumentLoader(file);
    const result = await loader.open();
    book = result.book;
    // Mirror the production open flow in readerStore: build (or hydrate) the
    // BookNav — which bakes section/fragment locations and TOC cfi+location —
    // and then apply per-open settings via updateToc.
    const nav = await computeBookNav(book);
    hydrateBookNav(book, nav);
    await updateToc(book, false, 'none');
  }, 30000);

  it('should assign valid CFIs to all TOC items', () => {
    const toc = book.toc ?? [];
    expect(toc.length).toBeGreaterThan(0);

    const collectItems = (items: TOCItem[]): TOCItem[] =>
      items.flatMap((item) => [item, ...(item.subitems ? collectItems(item.subitems) : [])]);

    const allItems = collectItems(toc);
    const itemsWithHref = allItems.filter((item) => item.href);
    expect(itemsWithHref.length).toBeGreaterThan(1);

    // Every TOC item with an href should have a valid (non-empty) CFI
    for (const item of itemsWithHref) {
      expect(
        item.cfi,
        `TOC item "${item.label}" (href: ${item.href}) should have a valid CFI`,
      ).toBeTruthy();
    }
  });

  it('should map CFIs from different sections to different TOC items', () => {
    const toc = book.toc ?? [];
    const sections = book.sections ?? [];
    expect(sections.length).toBeGreaterThan(1);

    const linearSections = sections.filter((s) => s.linear !== 'no' && s.cfi);
    expect(linearSections.length).toBeGreaterThan(2);

    const firstSection = linearSections[0]!;
    const lastSection = linearSections[linearSections.length - 1]!;

    const firstTocItem = findTocItemBS(toc, CFI.joinIndir(firstSection.cfi, ANNOTATION_PATH));
    const lastTocItem = findTocItemBS(toc, CFI.joinIndir(lastSection.cfi, ANNOTATION_PATH));

    expect(firstTocItem).not.toBeNull();
    expect(lastTocItem).not.toBeNull();

    // Annotations from different sections must NOT all map to the same chapter
    expect(firstTocItem!.label).toBe('Chapter One');
    expect(lastTocItem!.label).toBe('Chapter Three');
  });

  it('should map a mid-book CFI to a mid-book TOC item, not the last one', () => {
    const toc = book.toc ?? [];
    const sections = book.sections ?? [];
    const linearSections = sections.filter((s) => s.linear !== 'no' && s.cfi);

    const midSection = linearSections[1]!;
    const midTocItem = findTocItemBS(toc, CFI.joinIndir(midSection.cfi, ANNOTATION_PATH));

    expect(midTocItem).not.toBeNull();
    expect(midTocItem!.label).toBe('Chapter Two');
  });
});
