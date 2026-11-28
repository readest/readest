import { afterEach, describe, expect, it, vi } from 'vitest';
import { PSM } from 'tesseract.js';

import { makeMangaTextCrops } from '@/plugins/ocr/mangaTextCrop';
import {
  TesseractOcrEngine,
  type MangaRecognizerFactory,
  type MangaTextDetectorFactory,
  type TesseractWorker,
} from '@/plugins/ocr/tesseractEngine';
import { getTesseractLanguages } from '@/plugins/ocr/tesseractLanguages';

vi.mock('@/plugins/ocr/modelAssets', () => ({
  loadModelAsset: vi.fn(async () => new ArrayBuffer(1)),
}));

const page = { pageIndex: 2, width: 1200, height: 1800 };
const line = {
  box: { xMin: 900, yMin: 100, xMax: 960, yMax: 500 },
  polygon: [
    { x: 900, y: 100 },
    { x: 960, y: 100 },
    { x: 960, y: 500 },
    { x: 900, y: 500 },
  ],
  score: 0.9,
  vertical: true,
};
const secondLine = {
  ...line,
  box: { xMin: 840, yMin: 100, xMax: 900, yMax: 500 },
  polygon: [
    { x: 840, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 500 },
    { x: 840, y: 500 },
  ],
};
const blockBox = { xMin: 840, yMin: 100, xMax: 960, yMax: 500 };

const makeWorker = (): TesseractWorker => ({
  setParameters: vi.fn(async () => undefined),
  recognize: vi.fn(async () => ({ data: { text: '縦書き', confidence: 91 } })),
  terminate: vi.fn(async () => undefined),
});

const installCanvas = () =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
      width,
      height,
    })),
    putImageData: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);

const wholePageResult = {
  blocks: [
    {
      blocktype: 'FLOWING_TEXT',
      paragraphs: [
        {
          lines: [
            {
              text: 'fallback',
              confidence: 90,
              bbox: { x0: 10, y0: 20, x1: 210, y1: 60 },
            },
          ],
        },
      ],
    },
  ],
};

describe('Tesseract manga OCR', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps Japanese OCR isolated from the English model', () => {
    expect(getTesseractLanguages(undefined, { mangaFallback: true })).toEqual(['jpn', 'jpn_vert']);
    expect(getTesseractLanguages('ja')).toEqual(['jpn', 'jpn_vert']);
  });

  it('recognizes Japanese text blocks without loading Tesseract', async () => {
    installCanvas();
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const detector = {
      detect: vi.fn(async () => [
        {
          box: blockBox,
          score: 0.9,
          language: 'ja' as const,
          vertical: true,
          lines: [line, secondLine],
        },
      ]),
      terminate: vi.fn(async () => undefined),
    };
    const worker = makeWorker();
    const createWorker = vi.fn(async () => worker);
    const recognizer = {
      prepare: vi.fn(),
      recognize: vi.fn().mockResolvedValueOnce([
        { text: '一行目', confidence: 91 },
        { text: '二行目', confidence: 89 },
      ]),
      terminate: vi.fn(async () => undefined),
    };
    const onProgress = vi.fn();
    const engine = new TesseractOcrEngine(
      { mangaMode: true, textLanguage: 'ja', onProgress },
      createWorker,
      () => detector,
      undefined,
      undefined,
      () => recognizer,
    );

    const result = await engine.recognize(source, page);

    expect(createWorker).not.toHaveBeenCalled();
    expect(recognizer.recognize).toHaveBeenCalledOnce();
    expect(recognizer.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      detector.detect.mock.invocationCallOrder[0]!,
    );
    expect(recognizer.recognize.mock.calls[0]![0]).toMatchObject([
      { width: 64, height: 427, vertical: true },
      { width: 64, height: 427, vertical: true },
    ]);
    expect(onProgress).toHaveBeenCalledWith({ status: 'recognizing text', progress: 0.5 });
    expect(result).toMatchObject({
      language: 'ja',
      blocks: [
        {
          id: 'manga-block-0',
          text: '一行目二行目',
          lines: ['一行目', '二行目'],
          confidence: 90,
          fontSize: 60,
          box: blockBox,
          writingMode: 'vertical-rl',
        },
      ],
    });

    const cancellation = new AbortController();
    recognizer.recognize.mockImplementationOnce(async () => {
      cancellation.abort();
      return [null, null];
    });
    await expect(engine.recognize(source, page, cancellation.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(recognizer.recognize.mock.calls[1]?.[1]?.signal).toBe(cancellation.signal);
    recognizer.recognize.mockResolvedValue([
      { text: '再', confidence: 91 },
      { text: '開', confidence: 91 },
    ]);
    expect((await engine.recognize(source, page)).blocks[0]?.text).toBe('再開');
    expect(recognizer.terminate).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
    await engine.terminate();
  });

  it('uses vertical Tesseract crops when Japanese recognition is unavailable', async () => {
    installCanvas();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const longLine = {
      ...line,
      box: { xMin: 900, yMin: 100, xMax: 960, yMax: 1380 },
      polygon: [
        { x: 900, y: 100 },
        { x: 960, y: 100 },
        { x: 960, y: 1380 },
        { x: 900, y: 1380 },
      ],
    };

    for (const failure of ['low confidence', 'throws'] as const) {
      const source = document.createElement('canvas');
      source.width = page.width;
      source.height = page.height;
      const detector = {
        detect: vi.fn(async () => [
          {
            box: longLine.box,
            score: 0.9,
            language: 'ja' as const,
            vertical: true,
            lines: [longLine],
          },
        ]),
        terminate: vi.fn(async () => undefined),
      };
      const worker = makeWorker();
      vi.mocked(worker.recognize).mockResolvedValue({
        data: { text: '二', confidence: 90 },
      });
      const recognizer = {
        prepare: vi.fn(),
        recognize: vi.fn(async () => {
          if (failure === 'throws') throw new Error('recognizer failed');
          return [
            { text: '一', confidence: 90 },
            { text: '弱い', confidence: 10 },
          ];
        }),
        terminate: vi.fn(async () => undefined),
      };
      const engine = new TesseractOcrEngine(
        { mangaMode: true, textLanguage: 'ja-JP' },
        vi.fn(async () => worker),
        () => detector,
        undefined,
        undefined,
        () => recognizer,
      );

      const result = await engine.recognize(source, page);
      const fallbackCrop = vi.mocked(worker.recognize).mock.calls[0]?.[0] as HTMLCanvasElement;

      const text = failure === 'throws' ? '二二' : '一二';
      expect(result).toMatchObject({ language: 'ja-JP', blocks: [{ text }] });
      expect(recognizer.recognize).toHaveBeenCalledOnce();
      expect(fallbackCrop.width).toBeLessThan(fallbackCrop.height);
      expect(worker.setParameters).toHaveBeenCalledWith({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT,
        preserve_interword_spaces: '1',
      });
      await engine.terminate();
    }
  });

  it('preserves confident mixed-script text in Japanese manga', async () => {
    installCanvas();
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const detector = {
      detect: vi.fn(async () => [
        {
          box: blockBox,
          score: 0.9,
          language: 'ja' as const,
          vertical: true,
          lines: [line],
        },
      ]),
      terminate: vi.fn(async () => undefined),
    };
    const recognizer = {
      prepare: vi.fn(),
      recognize: vi.fn(async () => [{ text: '第1話DRAGON BALL', confidence: 89 }]),
      terminate: vi.fn(async () => undefined),
    };
    const createRecognizer = vi.fn<MangaRecognizerFactory>(() => recognizer);
    const engine = new TesseractOcrEngine(
      { mangaMode: true, textLanguage: 'ja' },
      vi.fn(async () => makeWorker()),
      () => detector,
      undefined,
      undefined,
      createRecognizer,
    );

    const result = await engine.recognize(source, page);

    expect(createRecognizer).toHaveBeenCalledOnce();
    expect(result.blocks).toMatchObject([{ text: '第1話DRAGON BALL' }]);
  });

  it('keeps vertical crops upright and splits long text before recognition', () => {
    for (const height of [256, 1280]) {
      const longLine = {
        box: { xMin: 0, yMin: 0, xMax: 64, yMax: height },
        polygon: [
          { x: 0, y: 0 },
          { x: 64, y: 0 },
          { x: 64, y: height },
          { x: 0, y: height },
        ],
        score: 0.9,
        vertical: true,
      };
      const data = new Uint8ClampedArray(64 * height * 4);
      for (let i = 0; i < data.length; i++) data[i] = i % 251;
      const image = { data, width: 64, height };
      const crops = makeMangaTextCrops(image, longLine);

      expect(crops).toHaveLength(height === 256 ? 1 : 2);
      expect(crops.every((crop) => crop.width === 64 && crop.height < 1_000)).toBe(true);
      const [whole] = makeMangaTextCrops(image, longLine, { split: false });
      expect(crops.flatMap((crop) => [...crop.data])).toEqual([...whole!.data]);
    }
  });

  it('finds no text on a page without any', async () => {
    installCanvas();
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const worker = makeWorker();
    vi.mocked(worker.recognize).mockResolvedValue({ data: wholePageResult });
    const engine = new TesseractOcrEngine(
      { mangaMode: true },
      vi.fn(async () => worker),
      () => ({
        detect: async () => [],
        terminate: async () => undefined,
      }),
    );

    expect((await engine.recognize(source, page)).blocks).toEqual([]);
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it('falls back to whole-page Tesseract for the rest of the session after detector failure', async () => {
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const detector = {
      detect: vi.fn(async () => {
        throw new Error('detector download failed');
      }),
      terminate: vi.fn(async () => undefined),
    };
    const worker = makeWorker();
    vi.mocked(worker.recognize).mockResolvedValue({ data: wholePageResult });
    const createDetector = vi.fn<MangaTextDetectorFactory>(() => detector);
    const engine = new TesseractOcrEngine(
      { mangaMode: true },
      vi.fn(async () => worker),
      createDetector,
    );

    const first = await engine.recognize(source, page);
    const second = await engine.recognize(source, { ...page, pageIndex: 3 });

    expect(first.blocks[0]?.text).toBe('fallback');
    expect(second.blocks[0]?.text).toBe('fallback');
    expect(createDetector).toHaveBeenCalledOnce();
    expect(detector.terminate).toHaveBeenCalledOnce();
  });
});
