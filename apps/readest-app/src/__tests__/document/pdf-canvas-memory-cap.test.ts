// Regression test for readest/readest issues #5118 and #5251.
//
// On iOS the WKWebView content process is killed by Jetsam when it exceeds its
// per-process memory high-water limit (~2 GB). A device crash log for #5118
// shows the foreground WebContent process reaching 2.10 GB with reason
// `highwater` right before the PDF "closed". macOS WebKit has no such per-process
// ceiling, which is why the same PDF reads fine in the desktop app; the iOS web
// build hits the same limit and crashes too.
//
// render() over-samples the page *bitmap* (for a crisp raster) but lays the DOM
// out at the true display size, and lets the <canvas> element downscale its
// bitmap to its CSS box. The document is NOT scaled with `transform` (which
// promotes the whole page to one over-sized GPU IOSurface that OOM-kills the iOS
// WebContent process when zooming past ~150%) nor with `zoom` (which throws off
// getBoundingClientRect and misplaces text selection / the annotation toolbar).
//
// On mobile WebViews the bitmap resolution is clamped:
//   * to MAX_RENDER_DPR (a 3x phone rasterises at 2x, still retina)
//   * further, so the bitmap area stays within MAX_CANVAS_PIXELS (large tablet
//     pages don't blow the budget)
// Desktop browsers have no per-process ceiling, so they are NOT clamped: doing so
// only cost sharpness, and a page filling a desktop window exceeds the mobile
// pixel budget immediately, so its raster was upscaled to the screen and PDF text
// came out visibly blurry (#5251).
//
// The CSS box is always the un-scaled display size, so text and annotation
// layers stay in real display coordinates.

import { afterEach, describe, expect, it, vi } from 'vitest';

// US Letter, the size used by the test fixture PDFs.
const PAGE_W = 612;
const PAGE_H = 792;

// Must mirror the constants in foliate-js/pdf.js.
const MAX_RENDER_DPR = 2;
const MAX_CANVAS_PIXELS = 2048 * 1536; // 3,145,728

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
// iPadOS reports a desktop ("Macintosh") user agent, so only the touch points
// give it away.
const IPAD_UA = DESKTOP_UA;

const stubPlatform = (userAgent: string, maxTouchPoints: number) => {
  for (const [key, value] of Object.entries({ userAgent, maxTouchPoints })) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
};

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
    getViewport: ({ scale }: { scale: number }) => ({
      width: PAGE_W * scale,
      height: PAGE_H * scale,
      scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    streamTextContent: () => ({}),
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
    cleanup: () => {},
  });
  const fakePdf = {
    numPages: 3,
    getPage: vi.fn(async () => makePage()),
    getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
    getOutline: vi.fn(async () => null),
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

const renderPageCanvas = async (
  dpr: number,
  zoom: number,
  platform: { userAgent: string; maxTouchPoints: number } = {
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
  },
) => {
  stubPlatform(platform.userAgent, platform.maxTouchPoints);
  vi.stubGlobal('devicePixelRatio', dpr);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

  const { makePDF } = await import('foliate-js/pdf.js');
  const file = { size: 1024, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  const book = (await makePDF(file as unknown as File)) as unknown as {
    sections: { load: () => Promise<{ onZoom: (arg: unknown) => Promise<void> }> }[];
  };
  const { onZoom } = await book.sections[0]!.load();

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';

  await onZoom({ doc, scale: zoom, pageColors: null });
  const canvas = doc.querySelector('#canvas canvas') as HTMLCanvasElement;
  // The DOM is laid out at the display size; only the canvas bitmap is
  // over-sampled. renderDpr = bitmap width / CSS (display) width.
  const displayW = parseFloat(canvas.style.width);
  const renderDpr = canvas.width / displayW;
  return { canvas, renderDpr, displayW };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('PDF canvas memory cap (#5118)', () => {
  it('does not scale the DOM (no transform / zoom on the page)', async () => {
    const { canvas } = await renderPageCanvas(3, 0.64, { userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const docEl = canvas.ownerDocument.documentElement;
    expect(docEl.style.transform).toBe('');
    expect(docEl.style.zoom).toBe('');
  });

  it('clamps the bitmap to MAX_RENDER_DPR on a high-dpr phone, CSS box stays display size', async () => {
    // iPhone: devicePixelRatio 3, page fit to a phone-width box.
    const dpr = 3;
    const zoom = 0.64;
    const { canvas, renderDpr, displayW } = await renderPageCanvas(dpr, zoom, {
      userAgent: IPHONE_UA,
      maxTouchPoints: 5,
    });
    expect(canvas).toBeTruthy();

    // Bitmap is over-sampled at the clamped dpr, not the full device dpr.
    expect(renderDpr).toBeCloseTo(MAX_RENDER_DPR, 2);
    expect(renderDpr).toBeLessThan(dpr);
    expect(canvas.width).toBeCloseTo(PAGE_W * zoom * MAX_RENDER_DPR, 0);
    const fullDprArea = PAGE_W * zoom * dpr * (PAGE_H * zoom * dpr);
    expect(canvas.width * canvas.height).toBeLessThan(fullDprArea);

    // CSS box is the true (un-scaled) display size, so overlays stay aligned.
    expect(displayW).toBeCloseTo(PAGE_W * zoom, 0);
    expect(parseFloat(canvas.style.height)).toBeCloseTo(PAGE_H * zoom, 0);
  });

  it('clamps the bitmap area to MAX_CANVAS_PIXELS on a large page', async () => {
    // iPad: devicePixelRatio 2, page fit to a wide box -> would exceed budget.
    const dpr = 2;
    const zoom = 1.6;
    const { canvas, renderDpr, displayW } = await renderPageCanvas(dpr, zoom, {
      userAgent: IPAD_UA,
      maxTouchPoints: 5,
    });
    expect(canvas).toBeTruthy();

    // Even at dpr 2 this page is over budget, so the render dpr drops below 2.
    expect(renderDpr).toBeLessThan(MAX_RENDER_DPR);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 8192);
    // Aspect ratio and display box are preserved.
    expect(canvas.width / canvas.height).toBeCloseTo(PAGE_W / PAGE_H, 2);
    expect(displayW).toBeCloseTo(PAGE_W * zoom, 0);
  });

  it('over-samples at exactly the device dpr when already within budget (desktop dpr 2)', async () => {
    // Desktop retina: dpr 2, modest zoom -> under budget, no extra clamp.
    const dpr = 2;
    const zoom = 1.0;
    const { canvas, renderDpr } = await renderPageCanvas(dpr, zoom);
    expect(canvas).toBeTruthy();

    expect(renderDpr).toBeCloseTo(dpr, 2);
    expect(canvas.width).toBeCloseTo(PAGE_W * zoom * dpr, 0);
    expect(canvas.height).toBeCloseTo(PAGE_H * zoom * dpr, 0);
  });
});

describe('PDF raster sharpness on desktop (#5251)', () => {
  // A page fitted to the width of a desktop window is far bigger than the mobile
  // pixel budget: at dpr 2 this one wants a 10.9 Mpx bitmap, 3.5x the budget.
  // Clamping it made the raster coarser than the screen, so the browser upscaled
  // it to the CSS box and PDF glyph edges came out blurry.
  const dpr = 2;
  const zoom = 2.37;

  it('rasterises at the full device pixel ratio, however large the page', async () => {
    const { canvas, renderDpr, displayW } = await renderPageCanvas(dpr, zoom);
    expect(canvas).toBeTruthy();

    // The bitmap size is an integer, so the full-dpr viewport is truncated.
    expect(renderDpr).toBeCloseTo(dpr, 2);
    expect(canvas.width).toBe(Math.trunc(PAGE_W * zoom * dpr));
    expect(canvas.height).toBe(Math.trunc(PAGE_H * zoom * dpr));
    expect(canvas.width * canvas.height).toBeGreaterThan(MAX_CANVAS_PIXELS);

    // Still no document scaling: the CSS box stays the display size.
    expect(displayW).toBeCloseTo(PAGE_W * zoom, 0);
    expect(canvas.ownerDocument.documentElement.style.transform).toBe('');
  });

  it('keeps the memory budget on a mobile WebView at the same size', async () => {
    const { renderDpr } = await renderPageCanvas(dpr, zoom, {
      userAgent: IPHONE_UA,
      maxTouchPoints: 5,
    });
    expect(renderDpr).toBeLessThan(dpr);
  });
});
