// Performance regression test for the paged-mode freeze on EPUBs with Duokan
// footnotes (readest/readest#6155).
//
// Duokan marks every footnote with an inline <img>, so a book that keeps a whole
// volume in one XHTML file hands the paginator hundreds of replaced elements in
// a single section. `setImageSize` walks them to clamp each one to the page box.
//
// The clamp reads the element's own margins so it can cap the *margin* box
// (foliate-js#90). `getComputedStyle().marginLeft` resolves to a used value, so
// reading it flushes layout — and the loop wrote inline styles to the previous
// element just before, which had dirtied layout again. That read/write
// interleaving forced one full multi-column relayout of the section per image.
// On the reported book (2125 images in a 1.1MB section) that is minutes of
// blocked main thread: the book never opens in paged mode, while scrolled mode
// — whose layout is far cheaper — still works.
//
// The reads must be batched ahead of the writes so the pass costs one layout,
// not one per image.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

const REPRO_URL = new URL('../fixtures/data/repro-6155-footnote-images.epub', import.meta.url).href;

// The fixed pass takes tens of milliseconds; the thrashing one takes tens of
// seconds. Anything in between is still a regression.
const BUDGET_MS = 5000;

const loadEPUB = async (url: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const name = url.split('/').pop() ?? 'book.epub';
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

const waitForStabilized = (el: HTMLElement, timeout = 60000) =>
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

let reproBook: BookDoc;

describe('Paginator image clamp cost (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    reproBook = await loadEPUB(REPRO_URL);
    await import('foliate-js/paginator.js');
  }, 60000);

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
  });

  it('columnizes a section full of footnote images without a per-image relayout', async () => {
    paginator = createPaginator();
    paginator.open(reproBook);

    const started = performance.now();
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;
    const elapsed = performance.now() - started;

    const content = paginator.getContents().find((c) => c.index === 0);
    expect(content).toBeDefined();
    const doc = content!.doc;

    // Guard against a vacuously fast pass: the section must really have
    // columnized over the footnote images the clamp walks.
    const images = doc.body.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(1900);
    // The paginator expands the iframe to the full columnized width, so compare
    // against the 800px viewport the host element gives it, not clientWidth.
    expect(doc.documentElement.scrollWidth).toBeGreaterThan(800 * 20);
    // Every image is clamped to the page box.
    expect(images[0]!.style.getPropertyValue('max-width')).not.toBe('');
    expect(images[images.length - 1]!.style.getPropertyValue('max-width')).not.toBe('');

    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 120000);
});
