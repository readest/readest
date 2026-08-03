import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// repro-4379: a Duokan/DangDang full-page cover — `data-duokan-page-fullscreen`
// on <html> with a dimensionless <img> inside a `.cover` wrapper. The paginator
// pins such covers with `position:absolute; inset:0; height:100%`, which fills
// the fixed-height page in paginated mode but collapses to zero against the
// auto-height scroll container in scrolled mode (the cover disappears).
const EPUB_URL = new URL('../fixtures/data/repro-4379.epub', import.meta.url).href;
// repro-5263: same cover, but the wrapper div is positioned (as Readest's
// duokan-bleed handling makes it). The pinned image must not resolve its
// height:100% against the zero-height wrapper, or the cover renders blank.
const EPUB_5263_URL = new URL('../fixtures/data/repro-5263.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async (url: string = EPUB_URL) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'repro.epub', { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

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

const getCoverImg = (paginator: Renderer): HTMLImageElement | null => {
  const cover = paginator.getContents().find((c) => c.index === 0);
  return (cover?.doc.body.querySelector('img') as HTMLImageElement | undefined) ?? null;
};

/** Wait for the cover <img> resource to decode so layout has a natural size. */
const waitForImgLoaded = async (img: HTMLImageElement, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (img.complete && img.naturalHeight > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Poll until the element has a non-zero rendered height (or time out). */
const waitForVisibleHeight = async (img: HTMLImageElement, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (img.offsetHeight > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('Paginator Duokan fullscreen cover (#4379)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
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

  it('shows the cover image in paginated mode (sanity)', async () => {
    paginator = createPaginator();
    paginator.open(book);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;

    const img = getCoverImg(paginator);
    expect(img).toBeTruthy();
    await waitForImgLoaded(img!);
    await waitForVisibleHeight(img!);
    expect(img!.offsetHeight).toBeGreaterThan(0);
  });

  it('letterboxes the fullscreen cover, preserving its aspect ratio (#5263)', async () => {
    paginator = createPaginator();
    paginator.open(book);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;

    const img = getCoverImg(paginator);
    expect(img).toBeTruthy();
    await waitForImgLoaded(img!);
    await waitForVisibleHeight(img!);

    // The fullscreen treatment fits the cover to the page while keeping its
    // aspect ratio, filling the leftover space with black bars like Duokan's
    // native full-page rendering — not stretching it edge-to-edge.
    const cs = img!.ownerDocument.defaultView!.getComputedStyle(img!);
    expect(cs.objectFit).toBe('contain');
    expect(cs.backgroundColor).toBe('rgb(0, 0, 0)');
    // The element box still spans the whole page so the bars cover it.
    expect(img!.getBoundingClientRect().height).toBeGreaterThanOrEqual(599);
  });

  it('shows the cover pinned to the page when the wrapper is positioned (#5263)', async () => {
    const positionedBook = await loadEPUB(EPUB_5263_URL);
    paginator = createPaginator();
    paginator.open(positionedBook);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;

    const img = getCoverImg(paginator);
    expect(img).toBeTruthy();
    await waitForImgLoaded(img!);
    await waitForVisibleHeight(img!);

    // A positioned wrapper (as produced by duokan-bleed handling) must not
    // become the containing block of the pinned cover: its height:100% would
    // resolve against the wrapper's zero height and the page renders blank.
    expect(img!.offsetHeight).toBeGreaterThan(0);
    expect(img!.getBoundingClientRect().height).toBeGreaterThanOrEqual(599);
  });

  it('shows the cover image in scrolled mode', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;

    const img = getCoverImg(paginator);
    expect(img).toBeTruthy();
    await waitForImgLoaded(img!);
    await waitForVisibleHeight(img!);

    // Before the fix the cover is absolutely positioned at height:100% inside
    // an auto-height (zero) container, so it collapses and never renders.
    expect(img!.offsetHeight).toBeGreaterThan(0);
    // It must also stay bounded by the viewport rather than overflowing it.
    expect(img!.offsetHeight).toBeLessThanOrEqual(600);
  });

  it('shows the cover image after toggling paginated -> scrolled', async () => {
    paginator = createPaginator();
    paginator.open(book);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;

    const img = getCoverImg(paginator);
    expect(img).toBeTruthy();
    await waitForImgLoaded(img!);
    await waitForVisibleHeight(img!);

    const stabilized2 = waitForStabilized(paginator);
    paginator.setAttribute('flow', 'scrolled');
    await stabilized2;

    // The same <img> element is re-rendered; stale absolute positioning from
    // the paginated render must not leave it collapsed in scrolled mode.
    await waitForVisibleHeight(img!);
    expect(img!.offsetHeight).toBeGreaterThan(0);
    // The letterbox background is tied to the pinned fullscreen treatment and
    // must not stick to the normally flowing image in scrolled mode.
    expect(img!.style.getPropertyValue('background-color')).toBe('');
  });
});
