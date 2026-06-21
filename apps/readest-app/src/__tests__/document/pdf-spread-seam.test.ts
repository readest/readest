// Regression test for readest/readest issue #4587.
//
// In a PDF two-page spread at a fractional device pixel ratio (Windows display
// scale 150% -> devicePixelRatio 1.5), a one-pixel white bar appeared in the
// middle of the spread on certain zoom levels.
//
// Root cause: `render()` sized the page canvas only via its bitmap dimensions
// (`canvas.width = viewport.width`). A canvas bitmap width is an integer, so
// the fractional `viewport.width` (= pageWidthCss * devicePixelRatio) was
// truncated. The iframe content is displayed scaled by `1 / devicePixelRatio`,
// so the truncated bitmap rendered up to ~1 device pixel narrower than the page
// box. The left page's canvas therefore stopped short of the spine, exposing
// the background as a thin white seam.
//
// The fix gives the canvas an explicit CSS size equal to the *un-truncated*
// viewport dimensions, so the bitmap is scaled to fill the page box exactly and
// the left page reaches the spine regardless of bitmap truncation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// US Letter, the size used by the test fixture PDFs.
const PAGE_W = 612;
const PAGE_H = 792;

// Minimal stand-in for the vendored pdf.js build. foliate-js/pdf.js imports it
// for the side effect of setting globalThis.pdfjsLib, then reads from that
// global — so the mock installs a controllable fake there.
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

beforeEach(() => {
  // Windows display scale 150%.
  vi.stubGlobal('devicePixelRatio', 1.5);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  // jsdom has no 2D context; render() only forwards it to the mocked
  // page.render(), so a null context is fine.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PDF spread canvas seam (#4587)', () => {
  it('sizes the page canvas to fill its box exactly at fractional devicePixelRatio', async () => {
    const { makePDF } = await import('foliate-js/pdf.js');

    const file = { size: 1024, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
    const book = (await makePDF(file as unknown as File)) as unknown as {
      sections: { load: () => Promise<{ onZoom: (arg: unknown) => Promise<void> }> }[];
    };
    const { onZoom } = await book.sections[0]!.load();

    // render() bails out when the document has no `defaultView`, so drive it
    // through a real iframe document (which has one) rather than a detached one.
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML =
      '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';

    // A zoom whose page-box width forces the device-pixel viewport width to be
    // fractional: 612 * zoom * 1.5 must not be an integer.
    const zoom = 0.8523;
    const pageBoxWidth = PAGE_W * zoom; // CSS px width of the page box
    const viewportWidth = pageBoxWidth * 1.5; // un-truncated device-pixel width

    await onZoom({ doc, scale: zoom, pageColors: null });

    const canvas = doc.querySelector('#canvas canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();

    // Bitmap width is an integer and is truncated below the ideal device size —
    // this is the truncation that, left to drive layout, produced the seam.
    expect(Number.isInteger(canvas.width)).toBe(true);
    expect(canvas.width).toBeLessThan(viewportWidth);

    // The fix: an explicit CSS size equal to the un-truncated viewport width, so
    // the page fills its box exactly (displayed width = box width) and the left
    // page reaches the spine — no white seam.
    expect(canvas.style.width).not.toBe('');
    expect(parseFloat(canvas.style.width)).toBeCloseTo(viewportWidth, 3);
    expect(parseFloat(canvas.style.width) / 1.5).toBeCloseTo(pageBoxWidth, 3);
  });
});
