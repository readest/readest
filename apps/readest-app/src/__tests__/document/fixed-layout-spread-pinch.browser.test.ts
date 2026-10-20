import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// A paginated pinch previews the zoom with a CSS scale on the shown pages, then
// the release commits it as a re-layout and scrolls back to where the preview
// showed the pages. On a two-page spread each page was scaled around its own
// centre, so the pages grew apart and the committed spread landed sideways
// from the preview (readest#6941).

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 100%; background: #eee; }
</style></head><body></body></html>`;

const makeBook = () => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 800 }, spread: 'auto' },
  // Section 0 is the cover on its own; sections 1 and 2 share spread 1.
  sections: Array.from({ length: 3 }, () => ({
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
    linear: 'yes',
  })),
});

type Renderer = HTMLElement & {
  open(book: unknown): void;
  goToSpread(index: number, side: string): Promise<void>;
  pinchZoom(ratio: number): void;
  pinchEnd(): void;
};

const waitFor = async <T>(fn: () => T | null | undefined, timeout = 4000): Promise<T> => {
  const start = performance.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

const mount = async (width: number, height: number, side: string) => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  Object.assign(renderer.style, { width: `${width}px`, height: `${height}px` });
  document.body.append(renderer);
  renderer.open(makeBook());
  await renderer.goToSpread(1, side);
  await waitFor(() => shownPages().length);
  await new Promise((r) => setTimeout(r, 100));
  return renderer;
};

// The page boxes on screen, left to right.
const shownPages = () =>
  [...renderer!.shadowRoot!.querySelectorAll('iframe')]
    .map((iframe) => iframe.parentElement!)
    .filter((el) => el.offsetWidth > 0 && getComputedStyle(el).visibility !== 'hidden')
    .sort((a, b) => a.offsetLeft - b.offsetLeft);

type Rect = { left: number; top: number; width: number; height: number };

const rects = (): Rect[] =>
  shownPages().map((el) => {
    const { left, top, width, height } = el.getBoundingClientRect();
    return { left, top, width, height };
  });

// Previews `ratio` on the shown pages, then releases and commits the zoom.
const pinch = (host: Renderer, ratio: number) => {
  const baseline = rects();
  host.pinchZoom(ratio);
  const preview = rects();
  host.pinchEnd();
  host.setAttribute('scale-factor', String(ratio * 100));
  const committed = rects();
  // The pinch has to have zoomed, or matching rects prove nothing.
  baseline.forEach((rect, i) => {
    expect(committed[i]!.width).toBeCloseTo(rect.width * ratio, 0);
  });
  return { preview, committed };
};

const expectSameRects = (actual: Rect[], expected: Rect[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((rect, i) => {
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      // The spine overlap shifts the right page by a pixel at most.
      expect(Math.abs(rect[key] - expected[i]![key]), `page ${i} ${key}`).toBeLessThanOrEqual(1);
    }
  });
};

describe('fixed-layout paginated pinch', () => {
  it('commits a two-page spread where the preview showed it', async () => {
    const host = await mount(1000, 600, 'left');
    expect(shownPages()).toHaveLength(2);

    const { preview, committed } = pinch(host, 2);
    expectSameRects(committed, preview);
  });

  // Portrait shows one page of the spread. When it's the right one, the left
  // page is display: none and has no rect to anchor on.
  it('commits the right page of a portrait spread where the preview showed it', async () => {
    const host = await mount(600, 1000, 'right');
    expect(shownPages()).toHaveLength(1);

    const { preview, committed } = pinch(host, 2);
    expectSameRects(committed, preview);
  });

  // The cover sits on the right with a blank slot facing it.
  it('commits the cover spread where the preview showed it', async () => {
    const host = await mount(1000, 600, 'left');
    await host.goToSpread(0, 'right');
    await new Promise((r) => setTimeout(r, 100));
    // The blank slot keeps its box, so both are laid out; its iframe is hidden.
    expect(shownPages()).toHaveLength(2);
    expect(shownPages()[0]!.querySelector('iframe')!.style.display).toBe('none');

    const { preview, committed } = pinch(host, 2);
    expectSameRects(committed, preview);
  });
});
