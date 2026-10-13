// readest/readest issue #6548: "Apply Theme Colors to PDF" crushed figures.
//
// pdf.js's own `pageColors` filter decodes the page to linear light and then
// posterizes it into six flat tones between the theme colors, so photos and
// shading turned into harsh splotches and every embedded image was recolored
// along with the text. foliate-js now recolors the rendered page itself with one
// smooth color matrix (luma mapped onto the foreground→background ramp, chroma
// kept) and, unless asked otherwise, puts embedded photos back untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pdf.js 4.7 operator ids the image tracking replays.
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
};

// A 600x800 page rendered at scale 1: pdf.js flips y with this viewport transform.
const VIEWPORT_TRANSFORM = [1, 0, 0, -1, 0, 800];

let operatorList: { fnArray: number[]; argsArray: unknown[][] };
let renderParams: Record<string, unknown>[];

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
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        transform: VIEWPORT_TRANSFORM.map((v) => v * scale),
      }),
      render: (params: Record<string, unknown>) => {
        renderParams.push(params);
        const task = { promise: Promise.resolve(), cancel: vi.fn() };
        page._intentStates.set('display', {
          renderTasks: new Set([{ task }]),
          operatorList,
        });
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

// Every drawImage render() makes, onto the page canvas or onto image snapshots.
type Draw = { dest: HTMLCanvasElement; src: unknown; filter: string; args: number[] };
let draws: Draw[];
const fakeContext = (canvas: HTMLCanvasElement) => {
  const ctx = {
    canvas,
    filter: 'none',
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    drawImage: (src: unknown, ...args: number[]) =>
      draws.push({ dest: canvas, src, filter: ctx.filter, args }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
};

const frames: HTMLIFrameElement[] = [];
let page: HTMLCanvasElement;
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
  const doc = frame.contentDocument!;
  doc.body.innerHTML =
    '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';
  await onZoom({ doc, scale: 1, pageColors });
  page = doc.querySelector('#canvas canvas') as HTMLCanvasElement;
};

// Copies of image regions taken from the page before it is recolored...
const snapshots = () => draws.filter((d) => d.src === page && d.dest !== page).map((d) => d.args);
// ...and drawn back over it afterwards.
const restores = () =>
  draws.filter((d) => d.dest === page && d.src !== page).map((d) => [d.filter, ...d.args]);

beforeEach(() => {
  draws = [];
  renderParams = [];
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
    return fakeContext(this);
  } as unknown as HTMLCanvasElement['getContext']);
});

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const apply = (matrix: (number | undefined)[], [r, g, b]: number[]) =>
  [0, 1, 2].map((i) => {
    const [mr, mg, mb, , offset] = matrix.slice(i * 5, i * 5 + 5) as number[];
    return Math.min(1, Math.max(0, mr! * r! + mg! * g! + mb! * b! + offset!));
  });

describe('getPageColorMatrix', () => {
  it('leaves a black-on-white theme alone', async () => {
    const { getPageColorMatrix } = await import('foliate-js/pdf.js');
    expect(getPageColorMatrix({ foreground: '#000000', background: '#ffffff' })).toBeNull();
  });

  it('turns paper into the theme background and ink into the theme foreground', async () => {
    const { getPageColorMatrix } = await import('foliate-js/pdf.js');
    const matrix = getPageColorMatrix({ foreground: '#ffd595', background: '#342e25' })!;
    const close = (got: number[], hex: string) =>
      got.forEach((v, i) =>
        expect(v).toBeCloseTo(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255, 5),
      );
    close(apply(matrix, [1, 1, 1]), '#342e25');
    close(apply(matrix, [0, 0, 0]), '#ffd595');
  });

  it('maps mid-grays smoothly instead of posterizing them', async () => {
    const { getPageColorMatrix } = await import('foliate-js/pdf.js');
    const matrix = getPageColorMatrix({ foreground: '#ffffff', background: '#000000' })!;
    // 64 evenly spaced grays must stay 64 distinct, evenly spaced tones.
    const tones = Array.from({ length: 64 }, (_, i) => apply(matrix, [i / 63, i / 63, i / 63])[0]!);
    expect(new Set(tones.map((t) => t.toFixed(4))).size).toBe(64);
    tones.forEach((t, i) => expect(t).toBeCloseTo(1 - i / 63, 5));
  });

  it('keeps the hue of colored ink when the page goes dark', async () => {
    const { getPageColorMatrix } = await import('foliate-js/pdf.js');
    const matrix = getPageColorMatrix({ foreground: '#e0e0e0', background: '#222222' })!;
    const [r, g, b] = apply(matrix, [0, 0, 0.93]); // a link blue
    expect(b).toBeGreaterThan(r! + 0.2);
    expect(b).toBeGreaterThan(g! + 0.2);
  });
});

describe('PDF render with page colors (#6548)', () => {
  it('recolors the page with a smooth filter instead of pdf.js pageColors', async () => {
    await renderWith({ foreground: '#e0e0e0', background: '#222222' });
    const filtered = draws.filter((d) => d.dest === page && d.src === page);
    expect(filtered.map((d) => d.filter)).toEqual([expect.stringMatching(/^url\(#/)]);
    expect(renderParams[0]).not.toHaveProperty('pageColors');
  });

  it('does not touch the page without page colors', async () => {
    await renderWith(undefined);
    expect(draws).toEqual([]);
  });

  it('puts embedded photos back untouched when keeping images', async () => {
    operatorList = {
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      // a 200x100 photo whose bottom-left corner sits at (50, 100) in PDF space
      argsArray: [[], [200, 0, 0, 100, 50, 100], ['img_p0_1', 1, 1], []],
    };
    await renderWith({ foreground: '#e0e0e0', background: '#222222', keepImages: true });
    // device space: x 50..250, y (800-200)..(800-100) = 600..700
    expect(snapshots()).toEqual([[50, 600, 200, 100, 0, 0, 200, 100]]);
    expect(restores()).toEqual([['none', 50, 600]]);
  });

  it('keeps only the pixels an image fully covers, so no paper rim outlines it', async () => {
    operatorList = {
      fnArray: [OPS.transform, OPS.paintImageXObject],
      argsArray: [
        [200.2, 0, 0, 100.2, 50.4, 99.6],
        ['img_p0_1', 1, 1],
      ],
    };
    await renderWith({ foreground: '#e0e0e0', background: '#222222', keepImages: true });
    // device space: x 50.4..250.6, y 600.2..700.4
    expect(snapshots().map((args) => args.slice(0, 4))).toEqual([[51, 601, 199, 99]]);
  });

  it('follows form and annotation transforms to the image', async () => {
    operatorList = {
      fnArray: [
        OPS.paintFormXObjectBegin,
        OPS.transform,
        OPS.paintInlineImageXObject,
        OPS.paintFormXObjectEnd,
        OPS.beginAnnotation,
        OPS.paintImageXObject,
        OPS.endAnnotation,
      ],
      argsArray: [
        [[1, 0, 0, 1, 100, 0], null],
        [10, 0, 0, 20, 0, 0],
        [{}],
        [],
        ['annot', [0, 0, 600, 800], [1, 0, 0, 1, 300, 400], [30, 0, 0, 40, 0, 0], false],
        ['img_p0_2', 1, 1],
        [],
      ],
    };
    await renderWith({ foreground: '#e0e0e0', background: '#222222', keepImages: true });
    expect(snapshots().map((args) => args.slice(0, 4))).toEqual([
      [100, 780, 10, 20],
      [300, 360, 30, 40],
    ]);
  });

  it('themes a page-sized scan and image masks like the text around them', async () => {
    operatorList = {
      fnArray: [
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
        OPS.paintImageMaskXObject,
      ],
      argsArray: [[], [600, 0, 0, 800, 0, 0], ['scan', 1, 1], [], [{}]],
    };
    await renderWith({ foreground: '#e0e0e0', background: '#222222', keepImages: true });
    expect(snapshots()).toEqual([]);
  });

  it('themes embedded images too when not keeping them', async () => {
    operatorList = {
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      argsArray: [[], [200, 0, 0, 100, 50, 100], ['img_p0_1', 1, 1], []],
    };
    await renderWith({ foreground: '#e0e0e0', background: '#222222', keepImages: false });
    expect(snapshots()).toEqual([]);
    expect(restores()).toEqual([]);
  });
});
