// readest/readest issue #6177: the sidebar TOC shows page thumbnails for PDFs.
//
// foliate-js' `makePDF` exposes `book.getPageThumbnail(index, maxSize)`, which
// renders a page small enough for the sidebar: the longer edge is scaled to
// `maxSize`, and the page object is released afterwards unless the reader is
// still holding it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let failRender = false;

const pages: {
  getViewport: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
}[] = [];

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
  }
  const makePage = () => {
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      })),
      render: vi.fn(() => ({
        promise: failRender ? Promise.reject(new Error('render failed')) : Promise.resolve(),
      })),
      cleanup: vi.fn(),
    };
    pages.push(page);
    return page;
  };
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 4,
      getPage: vi.fn(async () => makePage()),
      getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
      getViewerPreferences: vi.fn(async () => null),
      getOutline: vi.fn(async () => null),
      getPageLabels: vi.fn(async () => null),
      destroy: vi.fn(),
    }),
    destroy: vi.fn(),
  }));
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument,
  };
  return {};
});

const fakeFile = {
  size: 1,
  slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
} as unknown as File;

interface PdfBook {
  getPageThumbnail: (index: number, maxSize: number) => Promise<Blob | null>;
  sections: { createDocument: () => Promise<Document> }[];
}

const canvasSizes: { width: number; height: number; type?: string }[] = [];

beforeEach(() => {
  pages.length = 0;
  failRender = false;
  canvasSizes.length = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}),
  ) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string) {
    canvasSizes.push({ width: this.width, height: this.height, type });
    callback(new Blob([], { type }));
  };
});

const open = async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  return (await makePDF(fakeFile)) as unknown as PdfBook;
};

describe('makePDF page thumbnails (#6177)', () => {
  it('renders the page as a JPEG with its longer edge scaled to maxSize', async () => {
    const book = await open();
    const blob = await book.getPageThumbnail(2, 200);
    expect(blob?.type).toBe('image/jpeg');
    expect(canvasSizes[0]).toMatchObject({ width: 150, height: 200 });
  });

  it('releases the page afterwards', async () => {
    const book = await open();
    await book.getPageThumbnail(3, 200);
    expect(pages.at(-1)!.cleanup).toHaveBeenCalled();
  });

  it('releases the page when rendering fails', async () => {
    const book = await open();
    failRender = true;
    await expect(book.getPageThumbnail(3, 200)).rejects.toThrow('render failed');
    expect(pages.at(-1)!.cleanup).toHaveBeenCalled();
  });
});
