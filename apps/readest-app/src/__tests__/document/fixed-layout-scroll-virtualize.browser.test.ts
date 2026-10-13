import { afterEach, describe, expect, it } from 'vitest';

import 'foliate-js/fixed-layout.js';

// Scroll mode used to put one placeholder per page in the DOM. On WebKit every
// frame and every page load then cost time proportional to the page count, and
// a 2752-page PDF scrolled at a few frames per second on iOS. Only the pages
// around the viewport may be in the DOM; the rest of the strip is arithmetic.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const PAGES = 2000;
// 600x1000 pages fitted to a 300px wide host: 500px tall, 4px gap each side.
const PAGE_HEIGHT = 500;
const STEP = PAGE_HEIGHT + 8;

type Renderer = HTMLElement & {
  open(book: unknown): void;
  goTo(target: { index: number }): Promise<void>;
  destroy(): void;
  readonly index: number;
};

const makeBook = () => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
  sections: Array.from({ length: PAGES }, () => ({
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
    linear: 'yes',
  })),
});

const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

const nextFrames = async (count = 2) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.destroy();
  renderer?.remove();
  renderer = null;
});

const mount = () => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '300px';
  renderer.style.height = '600px';
  renderer.setAttribute('flow', 'scrolled');
  document.body.append(renderer);
  renderer.open(makeBook());
  return renderer;
};

const pageEls = () =>
  Array.from(renderer!.shadowRoot!.querySelectorAll<HTMLElement>('.scroll-page'));

const pageTop = (el: HTMLElement) =>
  el.getBoundingClientRect().top - renderer!.getBoundingClientRect().top + renderer!.scrollTop;

describe('fixed-layout scroll mode virtualization', () => {
  it('mounts only the pages around the viewport', () => {
    const r = mount();
    expect(pageEls().length).toBeLessThan(30);
    expect(r.scrollHeight).toBeCloseTo(PAGES * STEP, 0);
  });

  it('lays every page where the flex strip put it', async () => {
    const r = mount();
    await nextFrames();
    r.scrollTop = 1234 * STEP + 100;
    await waitFor(() => pageEls().some((el) => el.dataset['index'] === '1234'));
    const els = pageEls();
    const indices = els.map((el) => Number(el.dataset['index']));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(els.length).toBeLessThan(30);
    for (const el of els)
      expect(pageTop(el)).toBeCloseTo(4 + Number(el.dataset['index']) * STEP, 0);
  });

  it('goes to a far page and loads it', async () => {
    const r = mount();
    await r.goTo({ index: 1500 });
    expect(r.scrollTop).toBeCloseTo(4 + 1500 * STEP, 0);
    expect(r.index).toBe(1500);
    await waitFor(() => !!r.shadowRoot!.querySelector('.scroll-page[data-index="1500"] iframe'));
    expect(pageEls().length).toBeLessThan(30);
  });
});
