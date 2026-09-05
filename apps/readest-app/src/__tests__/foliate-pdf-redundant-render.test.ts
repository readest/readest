// readest/readest issue #6071: a redundant PDF re-render detaches the live TTS ranges.
//
// Every PDF render tears the text layer down (`container.replaceChildren()`) and
// builds it again. fixed-layout's `#observer = new ResizeObserver(() => this.#render())`
// re-renders on any layout change -- including the one a page turn itself causes --
// and discards the render promises, so a second render lands ~130ms after the first
// with nothing about the output changed.
//
// By then TTSController has already built its `TTS` over the first render's text
// layer and materialised the sentence `Range`s. The second `replaceChildren()`
// detaches every node those ranges point at, so the blocks yield empty text: TTS
// skips paragraphs, nothing highlights, and a page whose blocks are all empty makes
// the controller advance -- the reported "one paragraph per page" loop.
//
// Traced on a Xiaomi 2211133C (Android 16, Readest 0.12.6): every page was wiped
// exactly twice, ~130ms apart, at an identical scale and host box.
//
// `render` must therefore skip the rebuild when nothing that affects its output
// (the page, the zoom, the page colours, the OS font scale) has changed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Text of the page the fake pdf.js text layer builds, one span per entry.
const PAGE_TEXT = ['Magnus Pym got out of his elderly country taxicab. ', 'No one to flap about.'];

// Counts how many times a text layer was actually built.
let textLayerBuilds = 0;

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }

  // Stands in for pdfjsLib.TextLayer: fills the container the way the real one
  // does, so the test can hold a node from it and check it stays connected.
  class TextLayer {
    #container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.#container = container;
    }
    async render() {
      textLayerBuilds++;
      for (const str of PAGE_TEXT) {
        const span = this.#container.ownerDocument.createElement('span');
        span.textContent = str;
        this.#container.append(span);
      }
    }
  }

  class AnnotationLayer {
    async render() {}
  }

  const makePage = () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    streamTextContent: vi.fn(async () => ({})),
    getTextContent: vi.fn(async () => ({ items: [] })),
    getAnnotations: vi.fn(async () => []),
    cleanup: vi.fn(),
  });

  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: vi.fn(async () => makePage()),
      getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
      getViewerPreferences: vi.fn(async () => null),
      getOutline: vi.fn(async () => null),
      getPageLabels: vi.fn(async () => null),
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
    TextLayer,
    AnnotationLayer,
  };
  return {};
});

const fakeFile = {
  size: 1,
  slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
} as unknown as File;

type OnZoom = (opts: {
  doc: Document;
  scale: number;
  pageColors?: { background: string; foreground: string };
}) => Promise<void> | void;

interface PdfBook {
  sections: { load: () => Promise<{ onZoom: OnZoom }> }[];
}

// The DOM `renderPage`'s blob document gives each page's iframe. It has to be a
// real iframe document: `render` bails on a document with no `defaultView`.
const frames: HTMLIFrameElement[] = [];
const makePageDocument = () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const doc = frame.contentDocument!;
  for (const [tag, attr, value] of [
    ['div', 'id', 'canvas'],
    ['div', 'class', 'textLayer'],
    ['div', 'class', 'annotationLayer'],
  ] as const) {
    const el = doc.createElement(tag);
    el.setAttribute(attr, value);
    doc.body.append(el);
  }
  return doc;
};

const openFirstPage = async () => {
  const { makePDF } = await import('foliate-js/pdf.js');
  const book = (await makePDF(fakeFile)) as unknown as PdfBook;
  const { onZoom } = await book.sections[0]!.load();
  return { onZoom, doc: makePageDocument() };
};

beforeEach(() => {
  textLayerBuilds = 0;
  // jsdom has no 2d context; `render` only hands it to page.render(), which the
  // fake pdf.js ignores. Stub it so the run stays free of jsdom "Not implemented".
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
  // renderPage fetches the pdf.js viewer stylesheets before building the blob.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PDF re-render (#6071)', () => {
  it('leaves the text layer alone when nothing affecting the render changed', async () => {
    const { onZoom, doc } = await openFirstPage();

    await onZoom({ doc, scale: 0.9424859427009213 });
    const spoken = doc.querySelector('.textLayer')!.firstChild!;
    expect(spoken.textContent).toBe(PAGE_TEXT[0]);

    // The ResizeObserver's second render, same page, same scale, same colours.
    await onZoom({ doc, scale: 0.9424859427009213 });

    // A TTS Range anchored in the first render must survive: a detached node
    // yields empty text, which is what makes TTS skip the paragraph.
    expect(spoken.isConnected).toBe(true);
    expect(textLayerBuilds).toBe(1);
  });

  it('rebuilds the text layer when the zoom changes', async () => {
    const { onZoom, doc } = await openFirstPage();

    await onZoom({ doc, scale: 1 });
    await onZoom({ doc, scale: 2 });

    expect(textLayerBuilds).toBe(2);
    expect(doc.querySelector('.textLayer')!.textContent).toContain(PAGE_TEXT[0]!.trim());
  });

  it('rebuilds the text layer when the page colours change', async () => {
    const { onZoom, doc } = await openFirstPage();

    await onZoom({ doc, scale: 1, pageColors: { background: '#fff', foreground: '#000' } });
    await onZoom({ doc, scale: 1, pageColors: { background: '#000', foreground: '#fff' } });

    expect(textLayerBuilds).toBe(2);
  });
});
