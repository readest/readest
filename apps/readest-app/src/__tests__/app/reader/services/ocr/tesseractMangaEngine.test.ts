import { afterEach, describe, expect, it, vi } from 'vitest';
import { PSM } from 'tesseract.js';

import {
  TesseractOcrEngine,
  type MangaTextDetectorFactory,
  type TesseractWorker,
} from '@/app/reader/services/ocr/tesseractEngine';

vi.mock('@/app/reader/services/manga/modelAssets', () => ({
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
  afterEach(() => vi.restoreAllMocks());

  it('recognizes Mokuro blocks with the matching Tesseract line mode', async () => {
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
    vi.mocked(worker.recognize)
      .mockResolvedValueOnce({ data: { text: '一行目', confidence: 91 } })
      .mockResolvedValueOnce({ data: { text: '二行目', confidence: 89 } });
    const engine = new TesseractOcrEngine(
      { mangaMode: true, textLanguage: 'ja' },
      vi.fn(async () => worker),
      () => detector,
    );

    const result = await engine.recognize(source, page);

    expect(worker.setParameters).toHaveBeenLastCalledWith({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT,
      preserve_interword_spaces: '1',
    });
    expect(result).toMatchObject({
      language: 'ja',
      blocks: [
        {
          id: 'mokuro-block-0',
          text: '一行目二行目',
          lines: ['一行目', '二行目'],
          confidence: 90,
          fontSize: 60,
          box: blockBox,
          writingMode: 'vertical-rl',
        },
      ],
    });
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
