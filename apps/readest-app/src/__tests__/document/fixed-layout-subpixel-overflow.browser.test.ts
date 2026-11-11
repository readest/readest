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

const makeBook = () => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
  sections: [{ load: async () => ({ src: 'srcdoc', data: PAGE_HTML }), linear: 'yes' }],
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

const mount = async (zoom: string) => {
  renderer = document.createElement('foliate-fxl');
  Object.assign(renderer.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '392.7273px',
    height: '700px',
  });
  renderer.setAttribute('zoom', zoom);
  document.body.append(renderer);
  const paginated = renderer as unknown as {
    open(book: unknown): void;
    goToSpread(index: number, side: string): Promise<void>;
  };
  paginated.open(makeBook());
  await paginated.goToSpread(0, 'center');
  await waitFor(() => {
    const f = renderer!.shadowRoot?.querySelector<HTMLIFrameElement>('iframe');
    return f && f.style.display !== 'none' && f.getBoundingClientRect().width ? f : null;
  });
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
