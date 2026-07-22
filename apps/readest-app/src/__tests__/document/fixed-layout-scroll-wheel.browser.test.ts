import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Regression test for readest#4727: in fixed-layout scroll mode, a wheel tick
// that lands on a page iframe (during the brief idle window where the iframe is
// interactive) must NOT be scrolled by JS. The browser already chains the wheel
// to the host scroller natively; if the in-iframe wheel handler also scrolls the
// host, the page travels twice as far in an instant lurch instead of one smooth
// notch.
//
// This needs a real browser: the bug is the interaction between native wheel
// scrolling and a programmatic scrollBy, and jsdom has no layout/scroll. We
// mount the real renderer and assert the JS-side handler does not move the host
// scroller on its own (the synthetic wheel does not trigger native scrolling,
// so any movement we observe is purely the JS handler — which must be zero).

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; background: linear-gradient(#fff, #ccc); }
</style></head><body></body></html>`;

const makeBook = (sectionCount: number) => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
  sections: Array.from({ length: sectionCount }, () => ({
    // `src` only has to be truthy — when `data` is present the renderer loads it
    // via srcdoc, which keeps the iframe same-origin so its document (and the
    // wheel listener attached to it) is reachable.
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
    linear: 'yes',
  })),
});

const waitFor = async <T>(fn: () => T | null | undefined, timeout = 4000): Promise<T> => {
  const start = performance.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};

let renderer: HTMLElement | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

describe('fixed-layout scroll mode wheel handling (readest#4727)', () => {
  it('does not double-scroll the host when a wheel lands on a page', async () => {
    renderer = document.createElement('foliate-fxl');
    renderer.style.width = '600px';
    renderer.style.height = '400px';
    renderer.setAttribute('flow', 'scrolled');
    document.body.append(renderer);

    (renderer as unknown as { open(book: unknown): void }).open(makeBook(3));

    // The first page loads via the IntersectionObserver; wait until its iframe
    // has rendered (display flipped from 'none') — by then the wheel listener
    // that #loadScrollPage attaches to the iframe document is in place.
    const iframe = await waitFor(() => {
      const f = renderer!.shadowRoot?.querySelector<HTMLIFrameElement>('.scroll-page iframe');
      return f && f.style.display && f.style.display !== 'none' && f.contentDocument ? f : null;
    });

    const scroller = renderer as unknown as HTMLElement;

    // A wheel over the page iframe. With the bug, the iframe handler runs
    // `host.scrollBy({ top: deltaY, behavior: 'instant' })`, an *instant*
    // (synchronous) scroll that lands by ~120px before dispatchEvent() returns.
    // With the fix the handler only drops pointer-events and never scrolls.
    //
    // Measure the scroll position synchronously around dispatchEvent() — with no
    // await in between — so we capture only the wheel handler's own effect. Do
    // NOT await/settle here: as sibling pages finish loading, the renderer runs
    // #restoreScrollModeAnchor asynchronously, which snaps scrollTop to a page's
    // offsetTop (the 4px --scroll-page-gap). A post-dispatch delay races that
    // re-anchoring and observed scrollTop === 4 instead of 0 on slow CI runners
    // (readest CI flake). The buggy scrollBy is synchronous, so a synchronous
    // before/after comparison still catches it while being immune to the race.
    const before = scroller.scrollTop;
    iframe.contentDocument!.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    const after = scroller.scrollTop;

    expect(after).toBe(before);
  });
});
