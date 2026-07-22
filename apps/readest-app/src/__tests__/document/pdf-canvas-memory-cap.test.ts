// Regression test for readest/readest issue #5118.
//
// On iOS the WKWebView content process is killed by Jetsam when it exceeds its
// per-process memory high-water limit (~2 GB). A device crash log for this issue
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
// The bitmap resolution is clamped:
//   * to MAX_RENDER_DPR (a 3x phone rasterises at 2x, still retina)
//   * further, so the bitmap area stays within MAX_CANVAS_PIXELS (large tablet
//     pages don't blow the budget)
// The CSS box is always the un-scaled display size, so text and annotation
// layers stay in real display coordinates.

import { afterEach, describe, expect, it, vi } from 'vitest';

// US Letter, the size used by the test fixture PDFs.
const PAGE_W = 612;
const PAGE_H = 792;

// Must mirror the constants in foliate-js/pdf.js.
const MAX_RENDER_DPR = 2;
const MAX_CANVAS_PIXELS = 2048 * 1536; // 3,145,728

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

const renderPageCanvas = async (dpr: number, zoom: number) => {
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
});

describe('PDF canvas memory cap (#5118)', () => {
  it('does not scale the DOM (no transform / zoom on the page)', async () => {
    const { canvas } = await renderPageCanvas(3, 0.64);
    const docEl = canvas.ownerDocument.documentElement;
    expect(docEl.style.transform).toBe('');
    expect(docEl.style.zoom).toBe('');
  });

  it('clamps the bitmap to MAX_RENDER_DPR on a high-dpr phone, CSS box stays display size', async () => {
    // iPhone: devicePixelRatio 3, page fit to a phone-width box.
    const dpr = 3;
    const zoom = 0.64;
    const { canvas, renderDpr, displayW } = await renderPageCanvas(dpr, zoom);
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
    // Tablet: devicePixelRatio 2, page fit to a wide box -> would exceed budget.
    const dpr = 2;
    const zoom = 1.6;
    const { canvas, renderDpr, displayW } = await renderPageCanvas(dpr, zoom);
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
