import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Resolve with the next `relocate` event whose reason matches. */
const waitForRelocate = (el: HTMLElement, reason: string, timeout = 5000) =>
  new Promise<CustomEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relocate(${reason}) timeout`)), timeout);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.reason !== reason) return;
      clearTimeout(timer);
      el.removeEventListener('relocate', handler);
      resolve(event as CustomEvent);
    };
    el.addEventListener('relocate', handler);
  });

// The paginator's scroll listener relocates 250ms after the last scroll event
// (debounced); a phone rotation is never faster than that, so every resize
// step below lets that relocate run before the next one.
const SCROLL_DEBOUNCE_SETTLE_MS = 500;

describe('Paginator resize keeps the reading position (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

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

  const createPaginator = (width: number, height: number) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: `${width}px`,
      height: `${height}px`,
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  /** Resize the host (the ResizeObserver re-renders and re-anchors) and let the layout settle. */
  const resizeTo = async (width: number, height: number) => {
    const reanchored = waitForRelocate(paginator, 'anchor');
    paginator.style.width = `${width}px`;
    paginator.style.height = `${height}px`;
    await reanchored;
    await sleep(SCROLL_DEBOUNCE_SETTLE_MS);
  };

  it('lands on the same page after a portrait/landscape/portrait round trip (#5808)', async () => {
    const PORTRAIT: [number, number] = [400, 700];
    const LANDSCAPE: [number, number] = [700, 400];
    paginator = createPaginator(...PORTRAIT);
    paginator.open(book);
    // The longest section, so two page turns stay inside it (`page` is
    // section-relative) and the reflow has a few pages to shift around.
    const sections = book.sections!;
    const idx = sections.reduce(
      (best, s, i) => ((s.size ?? 0) > (sections[best]!.size ?? 0) ? i : best),
      0,
    );
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    await sleep(SCROLL_DEBOUNCE_SETTLE_MS);

    // Read a few pages into the section, like the reporter did.
    await paginator.next();
    await paginator.next();
    await sleep(SCROLL_DEBOUNCE_SETTLE_MS);
    const pageBefore = paginator.page;
    expect(pageBefore).toBeGreaterThan(0);

    await resizeTo(...LANDSCAPE);
    await resizeTo(...PORTRAIT);
    expect(paginator.page).toBe(pageBefore);

    // A second rotation must not walk the position back any further either.
    await resizeTo(...LANDSCAPE);
    await resizeTo(...PORTRAIT);
    expect(paginator.page).toBe(pageBefore);
  }, 30000);
});
