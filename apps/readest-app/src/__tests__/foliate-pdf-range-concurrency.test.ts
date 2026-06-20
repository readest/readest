// Regression test for readest/readest issue #3470.
//
// Opening a large PDF makes pdf.js request hundreds of small byte ranges at
// once while it parses the cross-reference and object streams. foliate-js'
// `makePDF` used to fulfil every `requestDataRange` immediately via an
// un-awaited `file.slice(begin, end).arrayBuffer()`, so all of those reads ran
// concurrently. On Android each read is a `fetch()` to the custom `rangefile`
// scheme that the WebView serves through `shouldInterceptRequest`; firing
// hundreds at once floods that native handler and exhausts the 512 MB Java
// heap, crashing the app on 50 MB+ PDFs.
//
// A real HTTP transport is implicitly throttled by the browser's per-host
// connection limit (~6); the custom file scheme bypasses that. `makePDF` must
// therefore throttle the concurrent range reads itself. This test drives a
// flood of `requestDataRange` calls and asserts the number of simultaneous
// `file.slice()` reads stays bounded while every requested range is still
// served.

import { afterEach, describe, expect, it, vi } from 'vitest';

// The number of range requests pdf.js fires in the simulated parse burst.
const FLOOD = 200;

// Captured by the @pdfjs mock so the test can drive requestDataRange.
let rangeTransport: {
  requestDataRange: (b: number, e: number) => void;
  onDataRange: (b: number, c: ArrayBuffer) => void;
};

// Minimal stand-in for the vendored pdf.js build. foliate-js/pdf.js imports it
// only for the side effect of setting globalThis.pdfjsLib, then reads from
// that global — so the mock installs a controllable fake there.
vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }
  const fakePdf = {
    numPages: 100,
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 600, height: 800 }),
      cleanup: vi.fn(),
    })),
    getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
    getOutline: vi.fn(async () => null),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
    destroy: vi.fn(),
  };
  const getDocument = vi.fn(({ range }: { range: typeof rangeTransport }) => {
    rangeTransport = range;
    const promise = (async () => {
      // pdf.js fires a burst of range requests as it parses the PDF structure.
      for (let i = 0; i < FLOOD; i++) range.requestDataRange(i * 1000, i * 1000 + 999);
      await new Promise((r) => setTimeout(r, 0));
      return fakePdf;
    })();
    return { promise };
  });
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument,
  };
  return {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makePDF range-read concurrency (#3470)', () => {
  it('bounds simultaneous range reads and still serves every request', async () => {
    const { makePDF } = await import('foliate-js/pdf.js');

    let inFlight = 0;
    let maxInFlight = 0;
    let served = 0;
    const file = {
      size: FLOOD * 1000,
      slice(begin: number, end: number) {
        return {
          async arrayBuffer() {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            served++;
            return new ArrayBuffer(end - begin);
          },
        };
      },
    };

    await makePDF(file as unknown as File);

    // Wait for the throttled queue to drain every requested range.
    const start = Date.now();
    while (served < FLOOD && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Every range pdf.js asked for must still be delivered…
    expect(served).toBe(FLOOD);
    // …but never more than a browser-like per-host connection limit at once.
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(6);
  });
});
