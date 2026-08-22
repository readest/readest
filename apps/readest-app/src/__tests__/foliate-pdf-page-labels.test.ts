// readest/readest issue #5822: surface PDF page labels as the book's page list.
//
// A PDF's page labels (PDF 32000-1 §12.4.2) are the numbers printed on the
// pages -- roman-numeral front matter, a body that restarts at 1 -- and are
// what the book's own TOC and index mean by "page 139", as opposed to the
// physical 1-based index into the file. foliate-js' `makePDF` must expose
// them as `book.pageList` so they flow through the same `TOCProgress` ->
// `pageItem` pipeline an EPUB page-list nav uses, and the footer's reference
// progress style can show the printed page instead of the raw one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOCProgress } from 'foliate-js/progress.js';

// Labels of the PDF Association's PageLabelsTest.pdf (16 pages): roman front
// matter, an arabic run, an Arabic-Indic run, then prefixed labels.
const SAMPLE_LABELS = [
  'i',
  'ii',
  'iii',
  'iv',
  '1',
  '2',
  '3',
  '4',
  '٤',
  '٥',
  '٦',
  '٧',
  ' Long Label - 11',
  ' Long Label - 12',
  ' Long Label - 13',
  ' Long Label - 14',
];

// Controls what the fake pdf.js document answers for getPageLabels().
let getPageLabels: () => Promise<string[] | null>;
let numPages = SAMPLE_LABELS.length;

// Minimal stand-in for the vendored pdf.js build. foliate-js/pdf.js imports it
// only for the side effect of setting globalThis.pdfjsLib, then reads from
// that global -- so the mock installs a controllable fake there.
vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      get numPages() {
        return numPages;
      },
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 600, height: 800 }),
        cleanup: vi.fn(),
      })),
      getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
      getViewerPreferences: vi.fn(async () => null),
      getOutline: vi.fn(async () => null),
      getPageLabels: vi.fn(() => getPageLabels()),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
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

interface PageListItem {
  label: string;
  href: string;
}

interface PdfBook {
  pageList: PageListItem[] | null;
  sections: { id: number }[];
  resolveHref: (href: string) => Promise<{ index: number }>;
  splitTOCHref: (href: string) => Promise<[number | null, string | null]>;
  getTOCFragment: (doc: Document) => Element;
}

const open = async (labels: string[] | null | (() => Promise<string[] | null>)) => {
  getPageLabels = typeof labels === 'function' ? labels : async () => labels;
  numPages = Array.isArray(labels) ? labels.length : 16;
  const { makePDF } = await import('foliate-js/pdf.js');
  return (await makePDF(fakeFile)) as unknown as PdfBook;
};

// The page list is consumed exactly the way `view.open` wires it up, so a
// relocate to page `index` yields that page's label as `pageItem`.
const pageItemFor = async (book: PdfBook, index: number) => {
  const progress = new TOCProgress();
  await progress.init({
    toc: book.pageList ?? [],
    ids: book.sections.map((s) => s.id),
    splitHref: book.splitTOCHref.bind(book),
    getFragment: book.getTOCFragment.bind(book),
  });
  return progress.getProgress(index, undefined) as PageListItem | null | undefined;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makePDF page labels (#5822)', () => {
  it('exposes the page labels as a page list, one entry per page', async () => {
    const book = await open(SAMPLE_LABELS);
    expect(book.pageList).not.toBeNull();
    expect(book.pageList!.map((item) => item.label)).toEqual(SAMPLE_LABELS);
  });

  it('resolves a page-list href to its page index, for both navigation and progress', async () => {
    const book = await open(SAMPLE_LABELS);
    for (const [i, item] of book.pageList!.entries()) {
      expect(await book.resolveHref(item.href)).toEqual({ index: i });
      expect(await book.splitTOCHref(item.href)).toEqual([i, null]);
    }
  });

  it('maps a relocate to the label of the page it landed on', async () => {
    const book = await open(SAMPLE_LABELS);
    expect((await pageItemFor(book, 0))?.label).toBe('i');
    expect((await pageItemFor(book, 4))?.label).toBe('1');
    expect((await pageItemFor(book, 9))?.label).toBe('٥');
    expect((await pageItemFor(book, 15))?.label).toBe(' Long Label - 14');
  });

  it('keeps an unlabeled page on its own (empty) entry instead of inheriting its predecessor', async () => {
    const book = await open(['i', '', '1']);
    expect((await pageItemFor(book, 1))?.label).toBe('');
    expect((await pageItemFor(book, 2))?.label).toBe('1');
  });

  it('ignores labels that merely restate the physical page numbers', async () => {
    const book = await open(['1', '2', '3', '4']);
    expect(book.pageList).toBeNull();
  });

  it('ignores labels that are all empty', async () => {
    const book = await open(['', '', '']);
    expect(book.pageList).toBeNull();
  });

  it('has no page list when the PDF declares no labels', async () => {
    const book = await open(null);
    expect(book.pageList).toBeNull();
  });

  it('still opens when the label tree is unreadable', async () => {
    const book = await open(async () => {
      throw new Error('corrupt PageLabels number tree');
    });
    expect(book.pageList).toBeNull();
    expect(book.sections).toHaveLength(16);
  });
});
