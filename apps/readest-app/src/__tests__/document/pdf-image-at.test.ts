// readest/readest issues #6558, #6562, #6563: a PDF page is one canvas under a
// full-page text layer, so nothing marked where its images are for a right-click
// to copy or save. foliate-js now records where the page paints each embedded
// image and, on request, renders just that region in its original colors.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pdf.js 4.7 operator ids the image tracking replays.
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintImageXObject: 85,
};

// a 200x100 photo whose bottom-left corner sits at (50, 100) in PDF space,
// i.e. x 50..250, y 600..700 on a 600x800 page at scale 1
const PHOTO = {
  fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
  argsArray: [[], [200, 0, 0, 100, 50, 100], ['img_p0_1', 1, 1], []],
};

type Viewport = { width: number; height: number; transform: number[]; offsetX: number };
let operatorList: { fnArray: number[]; argsArray: unknown[][] };
let renders: { canvasContext: CanvasRenderingContext2D; viewport: Viewport; size?: number[] }[];

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }
  class TextLayer {
    async render() {}
  }
  class AnnotationLayer {
    async render() {}
  }

  // Mirrors PDFPageProxy: render() files its internal task, whose `task` is the
  // returned RenderTask, under the intent state that owns the operator list.
  const makePage = () => {
    const page = {
      _intentStates: new Map(),
      getViewport: ({ scale, offsetX = 0, offsetY = 0 }: Record<string, number>) => ({
        width: 600 * scale!,
        height: 800 * scale!,
        offsetX,
        offsetY,
        transform: [scale!, 0, 0, -scale!, offsetX, 800 * scale! + offsetY],
      }),
      render: (params: (typeof renders)[number]) => {
        // the canvas is released once rendered, so note its size now
        const { width, height } = params.canvasContext.canvas;
        renders.push({ ...params, size: [width, height] });
        const task = { promise: Promise.resolve(), cancel: vi.fn() };
        page._intentStates.set('display', { renderTasks: new Set([{ task }]), operatorList });
        return task;
      },
      streamTextContent: vi.fn(async () => ({})),
      getAnnotations: vi.fn(async () => []),
    };
    return page;
  };

  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    OPS,
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => makePage()),
        getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
        getViewerPreferences: vi.fn(async () => null),
        getOutline: vi.fn(async () => null),
        getPageLabels: vi.fn(async () => null),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
        destroy: vi.fn(),
      }),
    })),
    TextLayer,
    AnnotationLayer,
  };
  return {};
});

type ImageDoc = Document & { getImageAt?: (x: number, y: number) => (() => Promise<Blob>) | null };

const frames: HTMLIFrameElement[] = [];
const renderWith = async (pageColors?: object) => {
  const { makePDF } = await import('foliate-js/pdf.js');
  const file = { size: 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  const book = (await makePDF(file as unknown as File)) as unknown as {
    sections: { load: () => Promise<{ onZoom: (arg: unknown) => Promise<void> }> }[];
  };
  const { onZoom } = await book.sections[0]!.load();
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const doc = frame.contentDocument! as ImageDoc;
  doc.body.innerHTML =
    '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';
  await onZoom({ doc, scale: 1, pageColors });
  return doc;
};

const png = new Blob(['png'], { type: 'image/png' });

beforeEach(() => {
  renders = [];
  operatorList = { fnArray: [], argsArray: [] };
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      canvas: this,
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(png));
});

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PDF getImageAt (#6558)', () => {
  it('finds the embedded image under a point', async () => {
    operatorList = PHOTO;
    const doc = await renderWith();
    expect(doc.getImageAt!(100, 650)).toEqual(expect.any(Function));
    expect(doc.getImageAt!(10, 10)).toBeNull();
    expect(doc.getImageAt!(260, 650)).toBeNull();
  });

  it('renders just that region, in its original colors, on request', async () => {
    operatorList = PHOTO;
    const doc = await renderWith({ foreground: '#e0e0e0', background: '#222222' });
    renders = [];
    await expect(doc.getImageAt!(100, 650)!()).resolves.toBe(png);
    const [{ size, viewport }] = renders as [(typeof renders)[number]];
    expect(size).toEqual([200, 100]);
    expect(viewport.transform.slice(4)).toEqual([-50, 200]);
    expect(renders[0]).not.toHaveProperty('pageColors');
  });

  it('works at the oversampled render scale', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    operatorList = PHOTO;
    const doc = await renderWith();
    renders = [];
    await doc.getImageAt!(100, 650)!();
    const { size, viewport } = renders[0]!;
    expect(size).toEqual([400, 200]);
    expect(viewport.transform.slice(4)).toEqual([-100, 400]);
  });

  it('covers a page-sized scan too', async () => {
    operatorList = {
      fnArray: [OPS.transform, OPS.paintImageXObject],
      argsArray: [
        [600, 0, 0, 800, 0, 0],
        ['scan', 1, 1],
      ],
    };
    const doc = await renderWith();
    expect(doc.getImageAt!(300, 400)).toEqual(expect.any(Function));
  });
});
