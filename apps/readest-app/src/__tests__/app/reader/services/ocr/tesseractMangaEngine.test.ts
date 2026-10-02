import { afterEach, describe, expect, it, vi } from 'vitest';
import { PSM } from 'tesseract.js';

import { makeMangaTextLineCrops } from '@/plugins/ocr/mangaTextCrop';
import {
  TesseractOcrEngine,
  type JapaneseMangaRecognizerFactory,
  type MangaTextDetectorFactory,
  type TesseractWorker,
} from '@/plugins/ocr/tesseractEngine';
import { getTesseractLanguages } from '@/plugins/ocr/tesseractLanguages';

vi.mock('@/plugins/ocr/modelAssets', () => ({
  fetchVerifiedModelAsset: vi.fn(async () => new ArrayBuffer(1)),
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
      detect: vi.fn(async () => ({
        page,
        blocks: [
          {
            box: blockBox,
            score: 0.9,
            language: 'ja' as const,
            vertical: true,
            lines: [line, secondLine],
          },
        ],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const worker = makeWorker();
    const createWorker = vi.fn(async () => worker);
    const recognizer = {
      recognize: vi
        .fn()
        .mockResolvedValueOnce({ text: '一行目', confidence: 91 })
        .mockResolvedValueOnce({ text: '二行目', confidence: 89 }),
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
    expect(recognizer.recognize).toHaveBeenCalledTimes(2);
    const [fastCrop, getMangaCrop] = recognizer.recognize.mock.calls[0]!;
    expect(fastCrop).toMatchObject({ width: 443, height: 80 });
    expect(getMangaCrop()).toMatchObject({ width: 64, height: 427 });
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
      return { text: '一行目', confidence: 91 };
    });
    await expect(engine.recognize(source, page, cancellation.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(recognizer.recognize).toHaveBeenCalledTimes(3);
    expect(recognizer.recognize.mock.calls[2]?.[2]).toBe(cancellation.signal);
    recognizer.recognize.mockResolvedValue({ text: '再開', confidence: 91 });
    expect((await engine.recognize(source, page)).blocks[0]?.text).toBe('再開再開');
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
        detect: vi.fn(async () => ({
          page,
          blocks: [
            {
              box: longLine.box,
              score: 0.9,
              language: 'ja' as const,
              vertical: true,
              lines: [longLine],
            },
          ],
        })),
        terminate: vi.fn(async () => undefined),
      };
      const worker = makeWorker();
      vi.mocked(worker.recognize).mockResolvedValue({
        data: { text: '二', confidence: 90 },
      });
      const recognizer = {
        recognize: vi
          .fn()
          .mockResolvedValueOnce({ text: '一', confidence: 90 })
          .mockImplementationOnce(async () => {
            if (failure === 'throws') throw new Error('recognizer failed');
            return { text: '弱い', confidence: 10 };
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

      expect(result).toMatchObject({ language: 'ja-JP', blocks: [{ text: '一二' }] });
      expect(recognizer.recognize).toHaveBeenCalledTimes(2);
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
      detect: vi.fn(async () => ({
        page,
        blocks: [
          {
            box: blockBox,
            score: 0.9,
            language: 'ja' as const,
            vertical: true,
            lines: [line],
          },
        ],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const recognizer = {
      recognize: vi.fn(async () => ({ text: '第1話DRAGON BALL', confidence: 89 })),
      terminate: vi.fn(async () => undefined),
    };
    const createRecognizer = vi.fn<JapaneseMangaRecognizerFactory>(() => recognizer);
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
    const contexts = installCanvas();
    const source = document.createElement('canvas');
    source.width = 64;
    for (const height of [256, 1280]) {
      contexts.mockClear();
      source.height = height;
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

      const data = new Uint8ClampedArray(source.width * source.height * 4);
      for (let i = 0; i < data.length; i++) data[i] = i % 251;
      const image = { data, width: source.width, height: source.height };
      const crops = makeMangaTextLineCrops(source, image, longLine, {
        keepVertical: true,
        vertical: true,
      });

      expect(crops).toHaveLength(height === 256 ? 1 : 2);
      expect(crops.every((crop) => crop.width === 80 && crop.height < 1_000)).toBe(true);
      makeMangaTextLineCrops(source, image, longLine, { vertical: true });
      const pixels = contexts.mock.results.map(({ value }) => value.putImageData.mock.calls[0][0]);
      for (let chunk = 0; chunk < crops.length; chunk++) {
        const upright = pixels[chunk];
        const rotated = pixels[chunk + crops.length];
        for (const y of [0, Math.floor(upright.height / 2), upright.height - 1]) {
          for (const x of [0, upright.width - 1]) {
            const from = (y * upright.width + x) * 4;
            const to = ((rotated.height - 1 - x) * rotated.width + y) * 4;
            expect(upright.data.subarray(from, from + 4)).toEqual(
              rotated.data.subarray(to, to + 4),
            );
          }
        }
      }
    }
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
