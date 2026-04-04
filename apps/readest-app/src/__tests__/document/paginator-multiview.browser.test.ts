import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { FoliateView, Renderer } from '@/types/view';

// Vite serves fixture files; fetch the EPUB at runtime in the browser.
const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async () => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

/**
 * Wait for the paginator to emit 'stabilized'.
 * MUST be called BEFORE the action that triggers stabilization (e.g. goTo),
 * because #display dispatches 'stabilized' synchronously before returning.
 */
const waitForStabilized = (el: HTMLElement, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Wait until `getContents().length >= n` or timeout. */
const waitForViews = async (el: Renderer, n: number, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (el.getContents().length >= n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** Wait for fill to complete by polling until getContents count stabilizes. */
const waitForFillComplete = async (el: Renderer, timeout = 10000) => {
  const start = Date.now();
  let lastCount = -1;
  let stableFor = 0;
  while (Date.now() - start < timeout) {
    const count = el.getContents().length;
    if (count === lastCount) {
      stableFor += 100;
      if (stableFor >= 500) return;
    } else {
      stableFor = 0;
      lastCount = count;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('Paginator multi-view architecture (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    // The paginator needs non-zero dimensions for layout calculations
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  /** Create paginator, open book, navigate to section, wait for stabilized. */
  const setupAt = async (index: number) => {
    paginator = createPaginator();
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index });
    await stabilized;
  };

  afterEach(() => {
    if (paginator) {
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  describe('Initial state', () => {
    it('should expose primaryIndex as -1 before any section is loaded', () => {
      paginator = createPaginator();
      paginator.open(book);
      expect(paginator.primaryIndex).toBe(-1);
    });

    it('should have no pages before loading a section', () => {
      paginator = createPaginator();
      paginator.open(book);
      expect(paginator.pages).toBe(0);
    });

    it('should return empty contents before loading', () => {
      paginator = createPaginator();
      paginator.open(book);
      expect(paginator.getContents()).toEqual([]);
    });
  });

  describe('Single section display', () => {
    it('should set primaryIndex after goTo', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      expect(paginator.primaryIndex).toBe(firstLinear);
    });

    it('should have positive page count after loading', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      expect(paginator.pages).toBeGreaterThan(0);
    });

    it('should emit stabilized event after display', async () => {
      paginator = createPaginator();
      paginator.open(book);
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      let stabilizedFired = false;
      paginator.addEventListener('stabilized', () => {
        stabilizedFired = true;
      });
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: firstLinear });
      await stabilized;
      expect(stabilizedFired).toBe(true);
    });

    it('should have at least one entry in getContents after loading', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      const contents = paginator.getContents();
      expect(contents.length).toBeGreaterThanOrEqual(1);
      expect(contents.find((c) => c.index === firstLinear)).toBeDefined();
    });

    it('should have a valid document in getContents entries', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      const contents = paginator.getContents();
      const primary = contents.find((c) => c.index === firstLinear);
      expect(primary).toBeDefined();
      // Iframe documents have a different Document constructor than the
      // test's global scope, so use nodeType check instead of instanceof.
      expect(primary!.doc.nodeType).toBe(Node.DOCUMENT_NODE);
      expect(primary!.doc.body).toBeTruthy();
    });
  });

  describe('Multi-view filling', () => {
    it('should load adjacent sections after display', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      await waitForViews(paginator, 2);
      const contents = paginator.getContents();
      expect(contents.length).toBeGreaterThan(1);
    });

    it('should return contents sorted by section index', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      await waitForViews(paginator, 2);
      const contents = paginator.getContents();
      const indices = contents.map((c) => c.index);
      expect(indices).toEqual([...indices].sort((a, b) => (a ?? 0) - (b ?? 0)));
    });

    it('should include the primary section in getContents', async () => {
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(firstLinear);
      await waitForViews(paginator, 2);
      const contents = paginator.getContents();
      const primary = contents.find((c) => c.index === firstLinear);
      expect(primary).toBeDefined();
    });
  });

  describe('Navigation between sections', () => {
    it('should update primaryIndex when navigating to a different section', async () => {
      const linearSections = book
        .sections!.map((s, i) => ({ s, i }))
        .filter(({ s }) => s.linear !== 'no');
      expect(linearSections.length).toBeGreaterThan(1);

      const first = linearSections[0]!.i;
      await setupAt(first);
      expect(paginator.primaryIndex).toBe(first);

      // Second goTo may reuse an already-loaded view (no 'stabilized' event).
      // Just await the goTo promise directly.
      const second = linearSections[1]!.i;
      await paginator.goTo({ index: second });
      await new Promise((r) => setTimeout(r, 200));
      expect(paginator.primaryIndex).toBe(second);
    });

    it('should navigate to a section by fraction anchor', async () => {
      const linearSections = book
        .sections!.map((s, i) => ({ s, i }))
        .filter(({ s }) => s.linear !== 'no' && s.size > 2000);

      const idx = linearSections[0]!.i;
      paginator = createPaginator();
      paginator.open(book);
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx, anchor: 0.5 });
      await stabilized;
      expect(paginator.primaryIndex).toBe(idx);
      // When anchored at 0.5 in a multi-page section, page should be
      // roughly in the middle — at least past page 0 when there are
      // enough pages (sections with few columns may legitimately land
      // on page 0 at 50%).
      if (paginator.pages > 2) {
        expect(paginator.page).toBeGreaterThan(0);
      }
      expect(paginator.page).toBeLessThan(paginator.pages);
    });

    it('should navigate to a later section and back', async () => {
      const linearSections = book
        .sections!.map((s, i) => ({ s, i }))
        .filter(({ s }) => s.linear !== 'no');
      expect(linearSections.length).toBeGreaterThan(2);

      const later = linearSections[Math.min(5, linearSections.length - 1)]!.i;
      await setupAt(later);
      expect(paginator.primaryIndex).toBe(later);

      // Navigate back to first — far enough that views won't be reused
      const first = linearSections[0]!.i;
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: first });
      await stabilized;
      expect(paginator.primaryIndex).toBe(first);
    });
  });

  describe('Relocate events', () => {
    it('should emit relocate with fraction data after display', async () => {
      paginator = createPaginator();
      paginator.open(book);
      const relocates: Array<{ index: number; fraction: number; reason: string }> = [];
      paginator.addEventListener('relocate', ((e: CustomEvent) => {
        relocates.push(e.detail);
      }) as EventListener);
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: firstLinear });
      await stabilized;
      // Give time for afterScroll to fire
      await new Promise((r) => setTimeout(r, 500));
      expect(relocates.length).toBeGreaterThan(0);
      const last = relocates[relocates.length - 1]!;
      expect(last.index).toBe(firstLinear);
      expect(typeof last.fraction).toBe('number');
      expect(last.fraction).toBeGreaterThanOrEqual(0);
      expect(last.fraction).toBeLessThanOrEqual(1);
    });

    it('should report fraction=0 when anchored at start of section', async () => {
      paginator = createPaginator();
      paginator.open(book);
      const relocates: Array<{ index: number; fraction: number }> = [];
      paginator.addEventListener('relocate', ((e: CustomEvent) => {
        relocates.push(e.detail);
      }) as EventListener);
      const firstLinear = book.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: firstLinear, anchor: 0 });
      await stabilized;
      await new Promise((r) => setTimeout(r, 500));
      const last = relocates[relocates.length - 1]!;
      expect(last.fraction).toBe(0);
    });
  });

  describe('Two-column layout at 800×600', () => {
    // At 800px width, Math.ceil(800/720) = 2 and max-column-count defaults
    // to 2, so the paginator uses a two-column (spread) layout.

    it('should use columnCount=2 at 800px width', async () => {
      const idx = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(idx);
      expect(paginator.columnCount).toBe(2);
    });

    it('should have viewSize >= size for a section with content', async () => {
      const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 2000);
      await setupAt(idx);
      // viewSize includes padding + content columns
      expect(paginator.viewSize).toBeGreaterThanOrEqual(paginator.size);
    });

    it('should compute pages = ceil(viewSize / size)', async () => {
      const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 2000);
      await setupAt(idx);
      const expectedPages = Math.ceil(paginator.viewSize / paginator.size);
      expect(paginator.pages).toBe(expectedPages);
    });

    it('should advance fraction by 2 columns per page turn', async () => {
      paginator = createPaginator();
      paginator.open(book);
      // Pick a section large enough to span multiple spreads
      const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 5000);
      const relocates: Array<{ fraction: number; size: number }> = [];
      paginator.addEventListener('relocate', ((e: CustomEvent) => {
        relocates.push({ fraction: e.detail.fraction, size: e.detail.size });
      }) as EventListener);

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx, anchor: 0 });
      await stabilized;
      await waitForFillComplete(paginator);
      await new Promise((r) => setTimeout(r, 300));

      const fractionAtStart = relocates[relocates.length - 1]?.fraction ?? 0;
      expect(fractionAtStart).toBe(0);

      // Page forward once — should advance by 2 columns worth of content
      await paginator.next();
      await new Promise((r) => setTimeout(r, 500));

      const fractionAfterNext = relocates[relocates.length - 1]!.fraction;
      expect(fractionAfterNext).toBeGreaterThan(fractionAtStart);

      // The fraction step per page should equal columnCount / textPages.
      // With 2 columns, each page turn advances by exactly `size` (detail.size).
      const lastSize = relocates[relocates.length - 1]!.size;
      expect(lastSize).toBeGreaterThan(0);
      expect(lastSize).toBeLessThanOrEqual(1);
      // fraction advanced by approximately `size` (2/textPages)
      const step = fractionAfterNext - fractionAtStart;
      expect(step).toBeCloseTo(lastSize, 1);
    });

    it('should report two header/footer cells for two-column layout', async () => {
      const idx = book.sections!.findIndex((s) => s.linear !== 'no');
      await setupAt(idx);
      // In 2-column layout, the paginator creates 2 header and 2 footer cells
      const header = paginator.shadowRoot?.getElementById('header');
      const footer = paginator.shadowRoot?.getElementById('footer');
      expect(header?.children.length).toBe(2);
      expect(footer?.children.length).toBe(2);
    });

    it('should use columnCount=1 in scrolled mode regardless of width', async () => {
      paginator = createPaginator();
      paginator.open(book);
      paginator.setAttribute('flow', 'scrolled');
      const idx = book.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx });
      await stabilized;
      // Scrolled mode always uses 1 column
      expect(paginator.columnCount).toBe(1);
    });
  });

  describe('Adjacent index skipping non-linear sections', () => {
    it('should skip non-linear sections during navigation', async () => {
      paginator = createPaginator();
      paginator.open(book);
      const sections = book.sections!;
      const nonLinearIdx = sections.findIndex((s) => s.linear === 'no');
      // If there are non-linear sections, navigating past them should work
      if (nonLinearIdx >= 0) {
        const prevLinear = sections.slice(0, nonLinearIdx).findLastIndex((s) => s.linear !== 'no');
        if (prevLinear >= 0) {
          const stabilized = waitForStabilized(paginator);
          await paginator.goTo({ index: prevLinear });
          await stabilized;
          await waitForFillComplete(paginator);
          // Next should skip non-linear and go to next linear
          await paginator.next();
          await new Promise((r) => setTimeout(r, 500));
          expect(paginator.primaryIndex).not.toBe(nonLinearIdx);
          expect(sections[paginator.primaryIndex]!.linear).not.toBe('no');
        }
      }
      // If no non-linear sections, the test passes trivially
      expect(true).toBe(true);
    });
  });

  describe('Scrolled mode', () => {
    it('should support flow=scrolled attribute', async () => {
      paginator = createPaginator();
      paginator.open(book);
      paginator.setAttribute('flow', 'scrolled');
      const idx = book.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx });
      await stabilized;
      expect(paginator.scrolled).toBe(true);
      expect(paginator.primaryIndex).toBe(idx);
    });
  });
});

describe('FoliateView CFI navigation (browser)', () => {
  let view: FoliateView;

  beforeAll(async () => {
    book = await loadEPUB();
    // Import both view.js (registers foliate-view) and paginator.js
    await import('foliate-js/view.js');
    await import('foliate-js/paginator.js');
  }, 30000);

  const createView = () => {
    const el = document.createElement('foliate-view') as FoliateView;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  afterEach(async () => {
    if (view) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        view.close();
      } catch {
        /* iframe body may already be torn down */
      }
      view.remove();
    }
  });

  it('should navigate to CFI and render Chapter 5', async () => {
    view = createView();
    await view.open(book);

    const cfi = 'epubcfi(/6/16!/4,,/2/2[chapter_466]/4/18/1:70)';
    const { index } = view.resolveCFI(cfi);

    // Wait for the renderer (paginator) to stabilize after goTo
    const stabilized = new Promise<void>((resolve) => {
      view.renderer.addEventListener('stabilized', () => resolve(), { once: true });
    });
    await view.goTo(cfi);
    await stabilized;

    // The primary section should contain "Chapter 5"
    const contents = view.renderer.getContents();
    const primary = contents.find((c) => c.index === index);
    expect(primary).toBeDefined();
    const headings = primary!.doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const chapterHeading = Array.from(headings).find((h) => h.textContent?.includes('Chapter 5'));
    expect(chapterHeading).toBeDefined();
    expect(chapterHeading!.textContent).toContain('Chapter 5');
  });
});
