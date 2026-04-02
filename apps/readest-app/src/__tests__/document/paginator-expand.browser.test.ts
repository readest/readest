import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// repro-3683: cover page with display:table + position:absolute + width:100% on body
const REPRO_3683_URL = new URL('../fixtures/data/repro-3683.epub', import.meta.url).href;
// repro-3583: vertical writing mode with height/width:100% divs and SVG image
const REPRO_3583_URL = new URL('../fixtures/data/repro-3583.epub', import.meta.url).href;
const ALICE_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

const loadEPUB = async (url: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const name = url.split('/').pop() ?? 'book.epub';
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

const waitForStabilized = (el: HTMLElement, timeout = 5000) =>
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

const waitForFillComplete = async (el: Renderer, timeout = 5000) => {
  const start = Date.now();
  let lastCount = -1;
  let stableFor = 0;
  while (Date.now() - start < timeout) {
    const count = el.getContents().length;
    if (count === lastCount) {
      stableFor += 50;
      if (stableFor >= 300) return;
    } else {
      stableFor = 0;
      lastCount = count;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};

let repro3683: BookDoc;
let repro3583: BookDoc;
let aliceBook: BookDoc;

/** Check all iframes and SVGs in shadow DOM stay within a size bound. */
const assertBoundedWidths = (paginator: Renderer, maxWidth: number) => {
  const shadow = paginator.shadowRoot;
  expect(shadow).toBeDefined();
  for (const iframe of shadow!.querySelectorAll('iframe')) {
    const w = parseFloat(iframe.style.width) || iframe.getBoundingClientRect().width;
    expect(w, `iframe width ${w}px exceeds ${maxWidth}px`).toBeLessThan(maxWidth);
  }
  for (const svg of shadow!.querySelectorAll('svg')) {
    const w = parseFloat(svg.style.width) || svg.getBoundingClientRect().width;
    expect(w, `svg width ${w}px exceeds ${maxWidth}px`).toBeLessThan(maxWidth);
  }
};

const assertBoundedHeights = (paginator: Renderer, maxHeight: number) => {
  const shadow = paginator.shadowRoot;
  expect(shadow).toBeDefined();
  for (const iframe of shadow!.querySelectorAll('iframe')) {
    const h = parseFloat(iframe.style.height) || iframe.getBoundingClientRect().height;
    expect(h, `iframe height ${h}px exceeds ${maxHeight}px`).toBeLessThan(maxHeight);
  }
  for (const svg of shadow!.querySelectorAll('svg')) {
    const h = parseFloat(svg.style.height) || svg.getBoundingClientRect().height;
    expect(h, `svg height ${h}px exceeds ${maxHeight}px`).toBeLessThan(maxHeight);
  }
};

describe('Paginator expand loop regression', () => {
  let paginator: Renderer;

  const suppressHandler = (e: ErrorEvent) => {
    if (e.message?.includes('getComputedStyle')) e.preventDefault();
  };

  beforeAll(async () => {
    window.addEventListener('error', suppressHandler);
    [repro3683, repro3583, aliceBook] = await Promise.all([
      loadEPUB(REPRO_3683_URL),
      loadEPUB(REPRO_3583_URL),
      loadEPUB(ALICE_URL),
    ]);
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
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
    if (paginator) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
    window.removeEventListener('error', suppressHandler);
  });

  describe('Table-layout cover page (repro EPUB)', () => {
    it('should stabilize without freezing on the problematic cover section', async () => {
      paginator = createPaginator();
      paginator.open(repro3683);

      // Section 0 is the cover with display:table + position:absolute + width:100%
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      // If we reach here, the paginator didn't loop infinitely
      expect(paginator.primaryIndex).toBe(0);
      expect(paginator.getContents().length).toBeGreaterThanOrEqual(1);
    });

    it('should render the cover content correctly', async () => {
      paginator = createPaginator();
      paginator.open(repro3683);

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      const contents = paginator.getContents();
      const cover = contents.find((c) => c.index === 0);
      expect(cover).toBeDefined();
      expect(cover!.doc.body.textContent).toContain('COVER PAGE');
    });

    it('should navigate from cover to chapter without freezing', async () => {
      paginator = createPaginator();
      paginator.open(repro3683);

      // Go to cover first
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;
      await waitForFillComplete(paginator);

      // Navigate to chapter 1 — it may already be loaded as an adjacent
      // section during fill, so goTo reuses the view without emitting
      // 'stabilized'. Just await goTo and verify the result.
      await paginator.goTo({ index: 1 });
      // Allow layout to settle
      await new Promise((r) => setTimeout(r, 200));

      expect(paginator.primaryIndex).toBe(1);
      const contents = paginator.getContents();
      const ch1 = contents.find((c) => c.index === 1);
      expect(ch1).toBeDefined();
      expect(ch1!.doc.body.textContent).toContain('Hello, world.');
    });

    it('should stabilize the cover in scrolled mode', async () => {
      paginator = createPaginator();
      paginator.open(repro3683);
      paginator.setAttribute('flow', 'scrolled');

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      expect(paginator.scrolled).toBe(true);
      expect(paginator.primaryIndex).toBe(0);
    });

    it('should keep element sizes bounded in paginated mode', async () => {
      // Without the fix, expand() diverges: body (position:absolute,
      // width:100%) mirrors the iframe width, each expand computes an
      // even larger expandedSize. Iframes/SVGs grow to millions of px.
      paginator = createPaginator();
      paginator.open(repro3683);

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;
      await waitForFillComplete(paginator);

      // Let ResizeObserver cycles run — divergence would explode here
      await new Promise((r) => setTimeout(r, 500));
      assertBoundedWidths(paginator, 800 * 20);
      assertBoundedHeights(paginator, 600 * 20);
    });
  });

  describe('Vertical writing mode with 100% divs in scrolled mode (repro-3583)', () => {
    it('should stabilize without freezing', async () => {
      paginator = createPaginator();
      paginator.open(repro3583);
      paginator.setAttribute('flow', 'scrolled');

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      expect(paginator.scrolled).toBe(true);
      expect(paginator.primaryIndex).toBe(0);
    });

    it('should keep element sizes bounded', async () => {
      paginator = createPaginator();
      paginator.open(repro3583);
      paginator.setAttribute('flow', 'scrolled');

      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;
      await waitForFillComplete(paginator);
      await new Promise((r) => setTimeout(r, 500));

      assertBoundedWidths(paginator, 800 * 20);
      assertBoundedHeights(paginator, 600 * 20);
    });
  });

  describe('Normal EPUB regression check', () => {
    it('should stabilize normally on a regular section', async () => {
      paginator = createPaginator();
      paginator.open(aliceBook);

      const idx = aliceBook.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx });
      await stabilized;

      expect(paginator.primaryIndex).toBe(idx);
      expect(paginator.getContents().length).toBeGreaterThanOrEqual(1);
    });

    it('should allow legitimate re-expansion after render', async () => {
      paginator = createPaginator();
      paginator.open(aliceBook);

      const idx = aliceBook.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx });
      await stabilized;
      await waitForFillComplete(paginator);

      // Re-render should work (expand history resets on layout changes)
      const stabilized2 = waitForStabilized(paginator);
      paginator.render?.();
      await stabilized2;

      expect(paginator.primaryIndex).toBe(idx);
    });

    it('should handle flow mode switch with convergence detection', async () => {
      paginator = createPaginator();
      paginator.open(aliceBook);

      const idx = aliceBook.sections!.findIndex((s) => s.linear !== 'no');
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: idx });
      await stabilized;
      await waitForFillComplete(paginator);

      // Switch to scrolled — triggers full re-layout
      const stabilized2 = waitForStabilized(paginator);
      paginator.setAttribute('flow', 'scrolled');
      await stabilized2;

      expect(paginator.scrolled).toBe(true);
      expect(paginator.primaryIndex).toBe(idx);
    });
  });
});
