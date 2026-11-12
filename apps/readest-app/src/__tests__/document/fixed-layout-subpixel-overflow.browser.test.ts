/**
 * A page fitted to the view is sized from the host's clientWidth, which rounds
 * the host's width: on a 2.75x phone the reader is 392.727px wide and the page
 * 393px. The page then overflows by a fraction of a pixel, and a touch scrolled
 * the host by one device pixel and back on release, so the page jumped as a
 * finger landed and a curl snapshot taken mid-gesture sat a pixel off.
 */

import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; background: #eee; }
</style></head><body></body></html>`;

const makeBook = (spread = 'none', count = 1, width = 600, height = 1000) => ({
  dir: 'ltr',
  rendition: { viewport: { width, height }, spread },
  sections: Array.from({ length: count }, () => ({
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

const mount = async (
  zoom: string,
  { width = '392.7273px', height = '700px', book = makeBook(), spread = 0, side = 'center' } = {},
) => {
  renderer = document.createElement('foliate-fxl');
  Object.assign(renderer.style, { position: 'fixed', left: '0', top: '0', width, height });
  renderer.setAttribute('zoom', zoom);
  document.body.append(renderer);
  const paginated = renderer as unknown as {
    open(book: unknown): void;
    goToSpread(index: number, side: string): Promise<void>;
  };
  paginated.open(book);
  await paginated.goToSpread(spread, side);
  await waitFor(() =>
    [...(renderer!.shadowRoot?.querySelectorAll<HTMLIFrameElement>('iframe') ?? [])].find(
      (f) => f.style.display !== 'none' && f.getBoundingClientRect().width,
    ),
  );
  await new Promise((r) => setTimeout(r, 100));
  return renderer;
};

describe('fixed-layout page that fits the view', () => {
  // Headless Chromium keeps scroll offsets in whole CSS pixels, so it never
  // scrolls the sliver; Android's WebView scrolls it by one device pixel.
  it('gives the reader nothing to scroll when the page fits within a pixel', async () => {
    const host = await mount('fit-page');
    const page = host.shadowRoot!.querySelector('iframe')!.getBoundingClientRect();
    expect(page.width, 'the fitted page overflows the host by a sliver').toBeGreaterThan(
      host.getBoundingClientRect().width,
    );
    const style = getComputedStyle(host);
    expect([style.overflowX, style.overflowY], 'the reader can scroll a fitted page').toEqual([
      'hidden',
      'hidden',
    ]);
  });

  it('gives the reader nothing to scroll when a two-page spread fits', async () => {
    // Two 392.5px pages fill a 785px client box; each rounds up to 393px on its
    // own, but together they fit.
    const host = await mount('fit-page', {
      width: '785.4545px',
      height: '500px',
      book: makeBook('auto', 3, 1000, 600),
      spread: 1,
      side: 'left',
    });
    const frames = [...host.shadowRoot!.querySelectorAll('iframe')].filter(
      (f) => f.parentElement!.style.visibility !== 'hidden' && f.getBoundingClientRect().width > 0,
    );
    expect(frames.map((f) => f.getBoundingClientRect().width)).toEqual([392.5, 392.5]);
    const style = getComputedStyle(host);
    expect([style.overflowX, style.overflowY], 'the reader can scroll a fitted spread').toEqual([
      'hidden',
      'hidden',
    ]);
  });

  it('counts only the page shown when a portrait view shows one page of a spread', async () => {
    for (const side of ['left', 'right']) {
      const host = await mount('fit-page', { book: makeBook('auto', 3), spread: 1, side });
      const style = getComputedStyle(host);
      expect(
        [style.overflowX, style.overflowY],
        `the ${side} page counts its hidden sibling`,
      ).toEqual(['hidden', 'hidden']);
      host.remove();
    }
  });

  it('still lets the reader pan a page zoomed past the view', async () => {
    const host = await mount('fit-width');
    host.setAttribute('scale-factor', '200');
    await waitFor(() => host.scrollWidth > host.clientWidth);
    await new Promise((r) => setTimeout(r, 100));
    const style = getComputedStyle(host);
    expect([style.overflowX, style.overflowY]).toEqual(['auto', 'auto']);
    host.scrollLeft = 50;
    expect(host.scrollLeft).toBe(50);
  });
});
