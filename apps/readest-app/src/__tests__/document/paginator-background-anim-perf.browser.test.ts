// Performance regression test for the swipe page-turn frame drops at chapter
// boundaries (readest/readest#4785).
//
// In paginated mode the paginator keeps the per-section backgrounds glued to the
// content during an animated page turn by repainting them every animation frame
// (the #replaceBackground / syncBackground loop). The original implementation
// rebuilt the whole paint *context* every frame: a getComputedStyle() on the
// primary section's <html> plus one getBoundingClientRect() per rendered view.
// Those are forced style/layout reads, and their cost scales with the number of
// loaded views — which peaks exactly when adjacent sections are preloaded at a
// chapter boundary, so the swipe animation dropped frames there.
//
// Everything that read context is invariant for the duration of a single scroll
// animation (theme/texture, the background+container geometry, each view's size
// and resolved background) — only the scroll offset changes. So the context must
// be snapshotted once when the animation starts and reused every frame; the
// per-frame work must NOT re-run getComputedStyle on the section document.
//
// This test drives a real animated turn and asserts the primary section's
// getComputedStyle is read at most a small constant number of times across the
// whole turn (not once per frame).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

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

describe('Paginator animated background repaint (browser)', () => {
  let paginator: Renderer;

  const suppressHandler = (e: ErrorEvent) => {
    if (e.message?.includes('getComputedStyle')) e.preventDefault();
  };

  beforeAll(async () => {
    window.addEventListener('error', suppressHandler);
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

  afterAll(() => {
    window.removeEventListener('error', suppressHandler);
  });

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    // Enable the snap/smooth animation path (syncBackground per-frame loop).
    el.setAttribute('animated', '');
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
    vi.restoreAllMocks();
  });

  it.each([
    false,
    true,
  ])('only defers off-screen preloads during a held swipe (needed: %s)', async (needed) => {
    const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 4000);
    paginator = createPaginator();
    paginator.style.width = '400px';
    paginator.setAttribute('no-preload', '');
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    expect(paginator.pages).toBeGreaterThan(3);
    await paginator.goTo({ index: idx, anchor: needed ? 1 : 1 - 3 / paginator.pages });

    const loaded: number[] = [];
    paginator.addEventListener('load', ((event: CustomEvent<{ index: number }>) => {
      loaded.push(event.detail.index);
    }) as EventListener);
    const touch = new Touch({ identifier: 1, target: paginator, clientX: 400, clientY: 100 });
    paginator.dispatchEvent(
      new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }),
    );
    paginator.removeAttribute('no-preload');
    paginator.shadowRoot!.querySelector('[part="container"]')!.dispatchEvent(new Event('scroll'));
    // The asynchronous iframe can finish loading after the finger goes down.
    // Its layout and host load handlers must wait even though fetch has finished.
    await expect
      .poll(() =>
        paginator
          .getContents()
          .some(
            (c) =>
              c.index != null &&
              c.index > idx &&
              c.doc.readyState === 'complete' &&
              c.doc.body?.textContent?.trim(),
          ),
      )
      .toBe(true);
    try {
      if (needed) await expect.poll(() => loaded.length).toBeGreaterThan(0);
      else expect(loaded).toEqual([]);
    } finally {
      paginator.dispatchEvent(new TouchEvent('touchcancel', { changedTouches: [touch] }));
    }
    await expect.poll(() => loaded.length).toBeGreaterThan(0);
  });

  it('yields before paginating a directly opened chapter', async () => {
    const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 4000);
    paginator = createPaginator();
    paginator.setAttribute('no-preload', '');
    paginator.open(book);
    let frameBeforePagination: boolean | undefined;
    paginator.addEventListener('load', ((event: CustomEvent<{ doc: Document }>) => {
      requestAnimationFrame(() => {
        frameBeforePagination = !event.detail.doc.documentElement.style.columnWidth;
      });
    }) as EventListener);
    await paginator.goTo({ index: idx });
    expect(frameBeforePagination).toBe(true);
    expect(paginator.pages).toBeGreaterThan(1);
  });

  it('lets the browser draw between preload styles, host handlers, and pagination', async () => {
    const idx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 4000);
    paginator = createPaginator();
    paginator.style.width = '400px';
    paginator.setAttribute('no-preload', '');
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    expect(paginator.pages).toBeGreaterThan(3);
    await paginator.goTo({ index: idx, anchor: 1 - 3 / paginator.pages });
    paginator.setStyles?.('body { color: rgb(10, 20, 30); }');

    let stylesPainted = false;
    let frameBeforeLoad: boolean | undefined;
    const primaryDoc = paginator.getContents().find((c) => c.index === idx)!.doc;
    const styleObserver = new MutationObserver(() => {
      requestAnimationFrame(() => {
        stylesPainted = true;
      });
    });
    let visibleStyleChanges = 0;
    const primaryObserver = new MutationObserver((records) => {
      visibleStyleChanges += records.length;
    });
    primaryObserver.observe(primaryDoc.head, { childList: true, subtree: true });
    let uninitializedMeasurements = 0;
    const measureRange = Range.prototype.getBoundingClientRect;
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      // A freshly constructed View range still belongs to the outer document.
      // Font-ready callbacks must not measure it before first pagination.
      if (this.commonAncestorContainer === document) uninitializedMeasurements++;
      return measureRange.call(this);
    });
    let frameBeforePagination: boolean | undefined;
    paginator.addEventListener('load', ((event: CustomEvent<{ doc: Document; index: number }>) => {
      if (event.detail.index <= idx) return;
      frameBeforeLoad = stylesPainted;
      styleObserver.disconnect();
      const doc = event.detail.doc;
      // Host load handlers customize chapter styles. Input and paint must get
      // a turn before the paginator measures and lays out the entire chapter.
      requestAnimationFrame(() => {
        frameBeforePagination = !doc.documentElement.style.columnWidth;
      });
    }) as EventListener);
    const touch = new Touch({ identifier: 1, target: paginator, clientX: 300, clientY: 100 });
    paginator.dispatchEvent(
      new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }),
    );
    paginator.removeAttribute('no-preload');
    paginator.shadowRoot!.querySelector('[part="container"]')!.dispatchEvent(new Event('scroll'));
    let adjacentDoc: Document | undefined;
    await expect
      .poll(() => {
        adjacentDoc = paginator
          .getContents()
          .find((c) => c.index! > idx && c.doc.body?.textContent?.trim())?.doc;
        return adjacentDoc?.readyState;
      })
      .toBe('complete');
    styleObserver.observe(adjacentDoc!.head, { childList: true, subtree: true });
    paginator.dispatchEvent(new TouchEvent('touchcancel', { changedTouches: [touch] }));
    await expect.poll(() => frameBeforePagination).toBe(true);
    await expect
      .poll(() =>
        paginator
          .getContents()
          .some((c) => c.index! > idx && c.doc.documentElement.style.columnWidth),
      )
      .toBe(true);
    expect(frameBeforeLoad).toBe(true);
    expect(uninitializedMeasurements).toBe(0);
    primaryObserver.disconnect();
    expect(visibleStyleChanges).toBe(0);
    expect(adjacentDoc!.defaultView!.getComputedStyle(adjacentDoc!.body).color).toBe(
      'rgb(10, 20, 30)',
    );
    paginator.setStyles?.('body { color: rgb(30, 20, 10); }');
    for (const doc of [primaryDoc, adjacentDoc!]) {
      expect(doc.defaultView!.getComputedStyle(doc.body).color).toBe('rgb(30, 20, 10)');
    }
  });

  it('snapshots the paint context once per animated turn instead of every frame', async () => {
    // A multi-page section so next() animates a page turn that stays within the
    // section (the within-section snap/smooth path runs the per-frame loop).
    const longIdx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 4000);
    const idx = longIdx >= 0 ? longIdx : book.sections!.findIndex((s) => s.linear !== 'no');

    paginator = createPaginator();
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    await waitForFillComplete(paginator);

    const primary = paginator.getContents().find((c) => c.index === paginator.primaryIndex);
    expect(primary).toBeDefined();
    const doc = primary!.doc;
    const win = doc.defaultView as Window & typeof globalThis;
    const htmlEl = doc.documentElement;

    // Count getComputedStyle reads against the primary section's <html> — the
    // forced style read #replaceBackground performs to resolve the theme/texture
    // background. The per-frame paint must not repeat it.
    let htmlStyleReads = 0;
    const origGetComputedStyle = win.getComputedStyle.bind(win);
    win.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      if (element === htmlEl) htmlStyleReads++;
      return origGetComputedStyle(element, pseudo ?? undefined);
    }) as typeof win.getComputedStyle;

    try {
      await paginator.next();
      // Let any trailing syncBackground RAF frames flush.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    } finally {
      win.getComputedStyle = origGetComputedStyle;
    }

    // A 300ms animation at ~60fps repaints ~18 frames. The pre-fix code read the
    // <html> computed style on every one of those frames; the fixed code reads it
    // a small constant number of times (context build + settle repaints).
    expect(htmlStyleReads).toBeLessThanOrEqual(3);
  });

  it('reuses the drag snapshot across swipe-drag frames instead of rebuilding', async () => {
    const longIdx = book.sections!.findIndex((s) => s.linear !== 'no' && s.size > 4000);
    const idx = longIdx >= 0 ? longIdx : book.sections!.findIndex((s) => s.linear !== 'no');

    paginator = createPaginator();
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    await waitForFillComplete(paginator);

    const primary = paginator.getContents().find((c) => c.index === paginator.primaryIndex);
    expect(primary).toBeDefined();
    const doc = primary!.doc;
    const win = doc.defaultView as Window & typeof globalThis;
    const htmlEl = doc.documentElement;

    const nextFrame = () =>
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const mkTouch = (x: number) =>
      new Touch({
        identifier: 1,
        target: paginator,
        screenX: x,
        screenY: 100,
        clientX: x,
        clientY: 100,
      });
    const mkEvent = (type: string, x: number) =>
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        changedTouches: [mkTouch(x)],
        touches: type === 'touchend' ? [] : [mkTouch(x)],
      });

    // Begin the gesture — #onTouchStart snapshots the paint context once.
    let x = 400;
    paginator.dispatchEvent(mkEvent('touchstart', x));

    // Install the spy AFTER the touchstart snapshot so we measure only the
    // per-drag-frame repaints, not the one-time snapshot read.
    let htmlStyleReads = 0;
    const origGetComputedStyle = win.getComputedStyle.bind(win);
    win.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      if (element === htmlEl) htmlStyleReads++;
      return origGetComputedStyle(element, pseudo ?? undefined);
    }) as typeof win.getComputedStyle;

    try {
      // Move the finger leftward in steps, one per frame, so each scrollBy emits
      // its own (non-coalesced) container scroll event → one drag repaint each.
      for (let i = 0; i < 6; i++) {
        x -= 30;
        paginator.dispatchEvent(mkEvent('touchmove', x));
        await nextFrame();
      }
      paginator.dispatchEvent(mkEvent('touchend', x));
      await nextFrame();
    } finally {
      win.getComputedStyle = origGetComputedStyle;
    }

    // Each drag frame repainted the per-view backgrounds; pre-fix that rebuilt the
    // whole context (a <html> getComputedStyle) every frame. The drag snapshot
    // must make those frames read-free.
    expect(htmlStyleReads).toBeLessThanOrEqual(1);
  });
});
