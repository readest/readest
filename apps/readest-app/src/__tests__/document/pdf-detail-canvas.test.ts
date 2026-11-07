// Regression test for readest/readest issue #7100.
//
// On mobile WebViews the full-page bitmap is held to a memory budget (#5118):
// at most 2x, and at most ~3.1 Mpx. A 3x iPhone therefore draws PDF text at 2x,
// and an iPad page (dpr 2) already exceeds the pixel budget when fitted to the
// screen, so its bitmap is upscaled into the page box. Zooming in lowers the
// render dpr further, so text got softer the further the reader zoomed.
//
// render() now adds a second canvas over the part of the page that is on
// screen, drawn at the full device pixel ratio. Its size is bounded by the
// screen, not by the page or the zoom, so the memory budget still holds.

import { afterEach, describe, expect, it, vi } from 'vitest';

// US Letter, the size used by the test fixture PDFs.
const PAGE_W = 612;
const PAGE_H = 792;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

type Viewport = { width: number; height: number; scale: number; offsetX: number; offsetY: number };
const renders: Viewport[] = [];
let nextRender: { promise: Promise<void>; cancel: () => void } | null = null;

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }
  const makePage = () => ({
    getViewport: ({ scale, offsetX = 0, offsetY = 0 }: Partial<Viewport>) => ({
      width: PAGE_W * scale!,
      height: PAGE_H * scale!,
      scale,
      offsetX,
      offsetY,
    }),
    render: ({ viewport }: { viewport: Viewport }) => {
      renders.push(viewport);
      if (nextRender) {
        const task = nextRender;
        nextRender = null;
        return task;
      }
      return { promise: Promise.resolve(), cancel: () => {} };
    },
    streamTextContent: () => ({}),
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
    cleanup: () => {},
  });
  const fakePdf = {
    numPages: 3,
    getPage: vi.fn(async () => makePage()),
    getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
    getViewerPreferences: vi.fn(async () => null),
    getOutline: vi.fn(async () => null),
    getPageLabels: vi.fn(async () => null),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
    destroy: vi.fn(),
  };
  class TextLayer {
    render = async () => {};
  }
  class AnnotationLayer {
    render = async () => {};
  }
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument: vi.fn(() => ({ promise: Promise.resolve(fakePdf) })),
    TextLayer,
    AnnotationLayer,
  };
  return {};
});

// A 430x932 phone screen showing a page zoomed to 2.4x, scrolled 300 px right
// and 500 px down, inside a scrolling host (the fixed-layout element).
const SCREEN = { width: 430, height: 932 };
const ZOOM = 2.4;
const SCROLL = { x: 300, y: 500 };

const setup = async ({
  dpr,
  userAgent,
  zoom = ZOOM,
}: {
  dpr: number;
  userAgent: string;
  zoom?: number;
}) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  const maxTouchPoints = userAgent === DESKTOP_UA ? 0 : 5;
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  vi.stubGlobal('devicePixelRatio', dpr);
  vi.stubGlobal('innerWidth', SCREEN.width);
  vi.stubGlobal('innerHeight', SCREEN.height);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  renders.length = 0;

  const { makePDF } = await import('foliate-js/pdf.js');
  const file = { size: 1024, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  const book = (await makePDF(file as unknown as File)) as unknown as {
    sections: { load: () => Promise<{ onZoom: (arg: unknown) => Promise<void> }> }[];
  };
  const { onZoom } = await book.sections[0]!.load();

  const host = document.createElement('div');
  host.style.overflowX = host.style.overflowY = 'auto';
  host.getBoundingClientRect = () => new DOMRect(0, 0, SCREEN.width, SCREEN.height);
  const iframe = document.createElement('iframe');
  host.append(iframe);
  document.body.append(host);
  const pageW = PAGE_W * zoom;
  const pageH = PAGE_H * zoom;
  const scrollTo = ({ x, y }: { x: number; y: number }) => {
    iframe.getBoundingClientRect = () => new DOMRect(-x, -y, pageW, pageH);
  };
  scrollTo(SCROLL);
  Object.defineProperty(iframe, 'offsetWidth', { value: pageW });
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';

  await onZoom({ doc, scale: zoom, pageColors: null });
  await vi.advanceTimersByTimeAsync(1000);
  const scroll = async (to: { x: number; y: number }) => {
    scrollTo(to);
    host.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(1000);
  };
  return { doc, host, iframe, scroll };
};

const canvases = (doc: Document) => [...doc.querySelectorAll<HTMLCanvasElement>('#canvas canvas')];

afterEach(() => {
  nextRender = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  document.body.replaceChildren();
});

describe('PDF detail canvas (#7100)', () => {
  it('draws the visible part of a zoomed page at the full device pixel ratio', async () => {
    vi.useFakeTimers();
    const dpr = 3;
    const { doc } = await setup({ dpr, userAgent: IPHONE_UA });
    const [base, detail] = canvases(doc);

    // The full page stays within the memory budget, well under the screen's 3x.
    expect(base!.width / parseFloat(base!.style.width)).toBeLessThan(2);

    // The detail canvas covers exactly the screen, at 3 bitmap px per CSS px.
    expect(detail).toBeTruthy();
    expect(detail!.width).toBe(SCREEN.width * dpr);
    expect(detail!.height).toBe(SCREEN.height * dpr);
    expect(parseFloat(detail!.style.width)).toBe(SCREEN.width);
    expect(parseFloat(detail!.style.height)).toBe(SCREEN.height);
    expect(parseFloat(detail!.style.left)).toBe(SCROLL.x);
    expect(parseFloat(detail!.style.top)).toBe(SCROLL.y);
    expect(detail!.style.pointerEvents).toBe('none');

    // It is rendered at zoom x dpr, shifted to the visible region.
    const viewport = renders[renders.length - 1]!;
    expect(viewport.scale).toBeCloseTo(ZOOM * dpr, 6);
    expect(viewport.offsetX).toBeCloseTo(-SCROLL.x * dpr, 6);
    expect(viewport.offsetY).toBeCloseTo(-SCROLL.y * dpr, 6);
  });

  it('cuts the coarse page away under the detail canvas', async () => {
    // Readest blends PDF canvases into the theme with mix-blend-mode, so the
    // page under the detail would otherwise show through as a blurry halo.
    vi.useFakeTimers();
    const { doc, iframe, scroll } = await setup({ dpr: 3, userAgent: IPHONE_UA });
    const [base] = canvases(doc);
    const { x, y } = SCROLL;
    const [r, b] = [x + SCREEN.width, y + SCREEN.height];
    // The whole page, minus the screen-sized hole the detail canvas fills.
    expect(base!.style.clipPath).toMatch(
      /^polygon\(evenodd, 0(px)? 0(px)?, 100% 0(px)?, 100% 100%/,
    );
    expect(base!.style.clipPath).toContain(
      `${x}px ${y}px, ${r}px ${y}px, ${r}px ${b}px, ${x}px ${b}px, ${x}px ${y}px)`,
    );
    iframe.style.visibility = 'hidden';
    await scroll(SCROLL);
    expect(base!.style.clipPath).toBe('');
  });

  it('follows the reader panning the zoomed page', async () => {
    vi.useFakeTimers();
    const dpr = 3;
    const { doc, scroll } = await setup({ dpr, userAgent: IPHONE_UA });
    await scroll({ x: 100, y: 1200 });
    const [, detail, extra] = canvases(doc);
    expect(extra).toBeUndefined();
    expect(parseFloat(detail!.style.left)).toBe(100);
    expect(parseFloat(detail!.style.top)).toBe(1200);
    expect(detail!.width).toBe(SCREEN.width * dpr);
  });

  it('drops the detail canvas when the page is hidden', async () => {
    vi.useFakeTimers();
    const { doc, iframe, scroll } = await setup({ dpr: 3, userAgent: IPHONE_UA });
    iframe.style.visibility = 'hidden';
    await scroll(SCROLL);
    expect(canvases(doc)).toHaveLength(1);
  });

  it('drops the detail canvas when its page scrolls off the screen', async () => {
    vi.useFakeTimers();
    const { doc, scroll } = await setup({ dpr: 3, userAgent: IPHONE_UA });
    expect(canvases(doc)).toHaveLength(2);
    // The 1900.8 px page now ends about 99 px above the screen.
    await scroll({ x: 0, y: 2000 });
    expect(canvases(doc)).toHaveLength(1);
    expect(canvases(doc)[0]!.style.clipPath).toBe('');
  });

  it('adds nothing where the page bitmap already matches the screen', async () => {
    vi.useFakeTimers();
    const { doc } = await setup({ dpr: 2, userAgent: DESKTOP_UA });
    expect(canvases(doc)).toHaveLength(1);
  });

  it('keeps the outgoing detail and its base mask fixed while a page turns', async () => {
    vi.useFakeTimers();
    const { doc, host, scroll } = await setup({ dpr: 3, userAgent: IPHONE_UA });
    const [base, detail] = canvases(doc);
    const mask = base!.style.clipPath;
    const count = renders.length;
    host.dataset['pageTurnView'] = 'outgoing';
    await scroll({ x: 420, y: 600 });
    expect(canvases(doc)[1], 'a swipe must not replace the sharp detail with a moving crop').toBe(
      detail,
    );
    expect(base!.style.clipPath).toBe(mask);
    expect(renders).toHaveLength(count);
    // Cancellation returns the page to its original pan; no new raster is needed.
    await scroll(SCROLL);
    delete host.dataset['pageTurnView'];
    await vi.advanceTimersByTimeAsync(200);
    expect(canvases(doc)[1]).toBe(detail);
    expect(renders).toHaveLength(count);
  });

  it('waits for a fitted incoming page to land before adding its detail canvas', async () => {
    vi.useFakeTimers();
    const { doc, host, iframe, scroll } = await setup({
      dpr: 3,
      userAgent: IPHONE_UA,
      zoom: SCREEN.width / PAGE_W,
    });
    iframe.style.visibility = 'hidden';
    await scroll({ x: 0, y: 0 });
    expect(canvases(doc)).toHaveLength(1);
    host.dataset['pageTurnView'] = 'incoming';
    iframe.style.visibility = 'visible';
    await scroll({ x: -250, y: 0 });
    expect(
      canvases(doc),
      '100% swipes must not cut a partial viewport hole into the page',
    ).toHaveLength(1);
    expect(canvases(doc)[0]!.style.clipPath).toBe('');
    // Landing itself must resume detail rendering, without requiring another scroll.
    iframe.getBoundingClientRect = () =>
      new DOMRect(0, 0, SCREEN.width, (PAGE_H * SCREEN.width) / PAGE_W);
    delete host.dataset['pageTurnView'];
    await vi.advanceTimersByTimeAsync(200);
    expect(canvases(doc)).toHaveLength(2);
    expect(parseFloat(canvases(doc)[1]!.style.left)).toBe(0);
    expect(canvases(doc)[1]!.width).toBe(SCREEN.width * 3);
  });

  it('cancels a pending detail crop when the page starts moving', async () => {
    vi.useFakeTimers();
    const { doc, host, scroll } = await setup({ dpr: 3, userAgent: IPHONE_UA });
    let finish!: () => void;
    const cancel = vi.fn();
    nextRender = {
      promise: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel,
    };
    await scroll({ x: 420, y: 600 });
    host.dataset['pageTurnView'] = 'outgoing';
    await vi.advanceTimersByTimeAsync(1);
    expect(
      cancel,
      'an in-flight detail must not paint a new crop during the swipe',
    ).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(canvases(doc)).toHaveLength(1);
    expect(canvases(doc)[0]!.style.clipPath).toBe('');
    delete host.dataset['pageTurnView'];
    await vi.advanceTimersByTimeAsync(200);
    expect(canvases(doc)).toHaveLength(2);
  });
});
