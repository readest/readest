import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Horizontal scroll mode (readest#4995): pages joined at their left/right
// edges along the reading direction, each scaled fit-to-height. Placeholder
// geometry is laid out for every page up front, so these assertions do not
// need to wait for iframe loads.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const makeBook = (sectionCount: number, dir: 'ltr' | 'rtl' = 'ltr') => ({
  dir,
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
  sections: Array.from({ length: sectionCount }, () => ({
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
    linear: 'yes',
  })),
});

type Renderer = HTMLElement & {
  open(book: unknown): void;
  next(distance?: number): Promise<void>;
  containerPosition: number;
};

const mount = (dir: 'ltr' | 'rtl' = 'ltr', pages = 5): Renderer => {
  const renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '600px';
  renderer.style.height = '400px';
  renderer.setAttribute('flow', 'scrolled');
  renderer.setAttribute('scroll-direction', 'horizontal');
  document.body.append(renderer);
  renderer.open(makeBook(pages, dir));
  return renderer;
};

const pageEls = (renderer: HTMLElement): HTMLElement[] =>
  Array.from(renderer.shadowRoot!.querySelectorAll<HTMLElement>('.scroll-page'));

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

describe('fixed-layout horizontal scroll mode (readest#4995)', () => {
  it('lays pages side by side, scaled fit-to-height', () => {
    renderer = mount('ltr');
    const pages = pageEls(renderer);
    expect(pages.length).toBe(5);
    const first = pages[0]!.getBoundingClientRect();
    const second = pages[1]!.getBoundingClientRect();
    // fit-to-height: host is 400px tall, pages are 600x1000 -> 240x400.
    expect(first.height).toBeCloseTo(400, 0);
    expect(first.width).toBeCloseTo(240, 0);
    // side by side, reading left to right.
    expect(second.left).toBeGreaterThan(first.right - 1);
    expect(second.top).toBeCloseTo(first.top, 0);
    // the strip overflows horizontally, not vertically.
    expect(renderer.scrollWidth).toBeGreaterThan(renderer.clientWidth);
    expect(renderer.scrollHeight).toBeLessThanOrEqual(renderer.clientHeight + 1);
  });

  it('reverses the strip for RTL books and starts on page 0', () => {
    renderer = mount('rtl');
    const pages = pageEls(renderer);
    const first = pages[0]!.getBoundingClientRect();
    const second = pages[1]!.getBoundingClientRect();
    // page 0 sits to the RIGHT of page 1 (manga order).
    expect(first.left).toBeGreaterThan(second.left);
    // reading start: page 0 visible in the viewport.
    const host = renderer.getBoundingClientRect();
    expect(first.right).toBeLessThanOrEqual(host.right + 1);
    expect(first.left).toBeGreaterThanOrEqual(host.left - 1);
  });

  it('switches back to a vertical strip when scroll-direction resets', () => {
    renderer = mount('ltr');
    renderer.setAttribute('scroll-direction', 'vertical');
    const pages = pageEls(renderer);
    const first = pages[0]!.getBoundingClientRect();
    const second = pages[1]!.getBoundingClientRect();
    expect(second.top).toBeGreaterThan(first.bottom - 1);
  });
});
