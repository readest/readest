import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Pages fitted to the width of a vertical scroll must fit inside the scrollbar
// the strip itself needs. Sizing them from the host's border box made each page
// as wide as the scrollbar is, so platforms with classic (space-taking)
// scrollbars -- Linux, Windows -- always showed a horizontal scrollbar too.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; background: #eee; }
</style></head><body></body></html>`;

const makeBook = (sectionCount: number) => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
  sections: Array.from({ length: sectionCount }, () => ({
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

// Headless Chromium hides scrollbars, so stand in for a 15px classic one with a
// border: like the scrollbar, it is part of the border box but not of the
// client area the pages have to fit in.
const mountRenderer = () => {
  renderer = document.createElement('foliate-fxl');
  Object.assign(renderer.style, {
    width: '600px',
    height: '400px',
    borderRight: '15px solid',
    boxSizing: 'border-box',
  });
  return renderer;
};

// A page is laid out once its iframe has been given a size.
const waitForPage = (selector: string) =>
  waitFor(() => {
    const f = renderer!.shadowRoot?.querySelector<HTMLIFrameElement>(selector);
    return f && f.style.display !== 'none' && f.getBoundingClientRect().width ? f : null;
  });

describe('fixed-layout fit width with a classic scrollbar', () => {
  it('fits scrolled pages inside the vertical scrollbar of the strip', async () => {
    const host = mountRenderer();
    host.setAttribute('flow', 'scrolled');
    document.body.append(host);
    (host as unknown as { open(book: unknown): void }).open(makeBook(3));
    await waitForPage('.scroll-page iframe');
    await new Promise((r) => setTimeout(r, 100));

    expect(host.clientWidth).toBe(585);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it('fits a paginated page that is taller than the view inside its scrollbar', async () => {
    const host = mountRenderer();
    host.setAttribute('zoom', 'fit-width');
    document.body.append(host);
    const paginated = host as unknown as {
      open(book: unknown): void;
      goToSpread(index: number, side: string): Promise<void>;
    };
    paginated.open(makeBook(1));
    await paginated.goToSpread(0, 'center');
    const iframe = await waitForPage('iframe');
    await new Promise((r) => setTimeout(r, 100));

    expect(iframe.getBoundingClientRect().width).toBeLessThanOrEqual(host.clientWidth);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });
});
