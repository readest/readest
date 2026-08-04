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

// Index of the .scroll-page whose rect contains the viewport's horizontal
// center, i.e. the page a reader would call "the current page".
const visiblePageIndex = (renderer: HTMLElement): number => {
  const host = renderer.getBoundingClientRect();
  const centerX = host.left + host.width / 2;
  return pageEls(renderer).findIndex((el) => {
    const rect = el.getBoundingClientRect();
    return rect.left <= centerX && rect.right >= centerX;
  });
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // RTL horizontal scroll must use the browser's negative-scrollLeft
  // convention, which is keyed off the SCROLLING element's own computed
  // `direction`, not a descendant's. Regression coverage for a bug where
  // `direction: rtl` was set on a non-scrolling child container instead of
  // the host: the host stayed 'ltr', scrollLeft never went negative
  // (assignments clamped to 0), and every anchor round trip teleported the
  // reader (readest#4995 review finding).
  it('puts the RTL host in the negative-scrollLeft convention', () => {
    renderer = mount('rtl');
    expect(getComputedStyle(renderer).direction).toBe('rtl');
    renderer.scrollLeft = -100;
    expect(renderer.scrollLeft).toBeLessThan(0);
  });

  it('preserves the visible page across a scroll-gap change in RTL horizontal mode', async () => {
    renderer = mount('rtl');
    const pages = pageEls(renderer);
    // Center page 2 in the viewport (scrolling deeper into the RTL strip,
    // i.e. further negative scrollLeft).
    const host = renderer.getBoundingClientRect();
    const centerX = host.left + host.width / 2;
    const target = pages[2]!.getBoundingClientRect();
    const delta = target.left + target.width / 2 - centerX;
    renderer.scrollLeft += delta;
    // let the scroll settle (handleScrollEvent's idle debounce).
    await wait(200);

    const before = visiblePageIndex(renderer);
    expect(before).toBe(2);

    renderer.setAttribute('scroll-gap', '8');

    expect(visiblePageIndex(renderer)).toBe(before);
  });

  it('clears the host direction when an RTL book switches back to vertical', () => {
    renderer = mount('rtl');
    expect(getComputedStyle(renderer).direction).toBe('rtl');
    renderer.setAttribute('scroll-direction', 'vertical');
    expect(getComputedStyle(renderer).direction).toBe('ltr');
  });

  const waitFor = async (fn: () => boolean, timeout = 4000): Promise<void> => {
    const start = performance.now();
    while (!fn()) {
      if (performance.now() - start > timeout) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 30));
    }
  };

  it('translates vertical wheel ticks into horizontal scrolling', () => {
    renderer = mount('ltr');
    const before = renderer.scrollLeft;
    renderer.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    expect(renderer.scrollLeft).toBeGreaterThan(before);
    // ctrl+wheel is pinch zoom, never scrolling.
    const zoomed = renderer.scrollLeft;
    renderer.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(renderer.scrollLeft).toBe(zoomed);
  });

  // Regression coverage for readest#4727 in horizontal mode: the iframe wheel
  // listener installed by #loadScrollPage must translate the tick itself here,
  // unlike vertical mode. In vertical mode the native scroll chain already
  // consumes the tick, so JS must stay hands off. In horizontal mode the host
  // only overflows horizontally, so a vertical wheel tick has nothing for the
  // native chain to consume, and without a manual translation the first tick
  // of every gesture over a page is silently swallowed.
  it('translates a wheel landing on a page iframe into horizontal scroll', async () => {
    renderer = mount('ltr');
    await waitFor(() => {
      const f = renderer!.shadowRoot?.querySelector<HTMLIFrameElement>('.scroll-page iframe');
      return !!(f && f.style.display && f.style.display !== 'none' && f.contentDocument);
    });
    const iframe = renderer.shadowRoot!.querySelector<HTMLIFrameElement>('.scroll-page iframe')!;
    const before = renderer.scrollLeft;
    iframe.contentDocument!.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    expect(renderer.scrollLeft).toBeCloseTo(before + 120, 0);
  });

  it('scrolls RTL books leftward (negative scrollLeft) on wheel down', () => {
    renderer = mount('rtl');
    renderer.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
    );
    expect(renderer.scrollLeft).toBeLessThan(0);
  });

  it('advances one viewport width on next()', async () => {
    renderer = mount('ltr');
    const before = renderer.scrollLeft;
    await renderer.next();
    // scrollBy uses smooth behavior; poll until it lands.
    await waitFor(() => renderer!.scrollLeft >= before + renderer!.clientWidth - 1);
  });

  it('exposes containerPosition as reading progression on both directions', () => {
    renderer = mount('ltr');
    renderer.containerPosition = 100;
    expect(renderer.scrollLeft).toBeCloseTo(100, 0);
    expect(renderer.containerPosition).toBeCloseTo(100, 0);
    renderer.remove();

    renderer = mount('rtl');
    renderer.containerPosition = 100;
    expect(renderer.scrollLeft).toBeCloseTo(-100, 0);
    expect(renderer.containerPosition).toBeCloseTo(100, 0);
  });
});
