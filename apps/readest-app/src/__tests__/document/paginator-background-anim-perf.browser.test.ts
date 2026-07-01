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
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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
