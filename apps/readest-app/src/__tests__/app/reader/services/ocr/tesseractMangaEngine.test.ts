import { afterEach, describe, expect, it, vi } from 'vitest';
import { PSM } from 'tesseract.js';

import type { MokuroTextDetectionResult } from '@/app/reader/services/manga/mokuroTextDetector';
import {
  TesseractOcrEngine,
  type MangaTextDetectorFactory,
  type TesseractWorker,
} from '@/app/reader/services/ocr/tesseractEngine';

vi.mock('@/app/reader/services/manga/modelAssets', () => ({
  fetchVerifiedModelAsset: vi.fn(async () => new ArrayBuffer(1)),
}));

const page = { pageIndex: 2, width: 1200, height: 1800 };

const line = (
  box: { xMin: number; yMin: number; xMax: number; yMax: number },
  vertical: boolean,
) => ({
  box,
  polygon: [
    { x: box.xMin, y: box.yMin },
    { x: box.xMax, y: box.yMin },
    { x: box.xMax, y: box.yMax },
    { x: box.xMin, y: box.yMax },
  ],
  score: 0.9,
  vertical,
});

const detection = (blocks: MokuroTextDetectionResult['blocks']): MokuroTextDetectionResult => ({
  page,
  blocks,
});

const makeWorker = (): TesseractWorker => ({
  setParameters: vi.fn(async () => undefined),
  recognize: vi.fn(async () => ({ data: { text: '', confidence: 0 } })),
  terminate: vi.fn(async () => undefined),
});

const installCanvas = () => {
  const putImageData = vi.fn();
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
    putImageData,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return { putImageData };
};

describe('TesseractOcrEngine manga detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('recognizes Mokuro lines in reading order with matching Tesseract modes', async () => {
    installCanvas();
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const vertical = line({ xMin: 900, yMin: 100, xMax: 960, yMax: 500 }, true);
    const horizontal = line({ xMin: 100, yMin: 700, xMax: 500, yMax: 760 }, false);
    const detector = {
      detect: vi.fn(async () =>
        detection([
          {
            box: vertical.box,
            score: 0.9,
            language: 'ja',
            vertical: true,
            lines: [vertical],
          },
          {
            box: horizontal.box,
            score: 0.9,
            language: 'ja',
            vertical: false,
            lines: [horizontal],
          },
        ]),
      ),
      terminate: vi.fn(async () => undefined),
    };
    const createDetector = vi.fn<MangaTextDetectorFactory>(() => detector);
    const worker = makeWorker();
    vi.mocked(worker.recognize)
      .mockResolvedValueOnce({ data: { text: '縦書き', confidence: 91 } })
      .mockResolvedValueOnce({ data: { text: '横書き', confidence: 87 } });
    const engine = new TesseractOcrEngine(
      { languages: ['jpn', 'jpn_vert'], mangaMode: true },
      vi.fn(async () => worker),
      createDetector,
    );

    expect(createDetector).not.toHaveBeenCalled();
    const result = await engine.recognize(source, page);

    expect(detector.detect).toHaveBeenCalledWith(source, {
      width: page.width,
      height: page.height,
    });
    expect(worker.setParameters).toHaveBeenNthCalledWith(2, {
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT,
      preserve_interword_spaces: '1',
    });
    expect(worker.setParameters).toHaveBeenNthCalledWith(3, {
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      preserve_interword_spaces: '1',
    });
    const verticalCrop = vi.mocked(worker.recognize).mock.calls[0]?.[0] as HTMLCanvasElement;
    const horizontalCrop = vi.mocked(worker.recognize).mock.calls[1]?.[0] as HTMLCanvasElement;
    expect({ width: verticalCrop.width, height: verticalCrop.height }).toEqual({
      width: 80,
      height: 443,
    });
    expect({ width: horizontalCrop.width, height: horizontalCrop.height }).toEqual({
      width: 443,
      height: 80,
    });
    expect(result.blocks).toEqual([
      {
        id: 'mokuro-line-0-0',
        text: '縦書き',
        confidence: 91,
        box: vertical.box,
        writingMode: 'vertical-rl',
      },
      {
        id: 'mokuro-line-1-0',
        text: '横書き',
        confidence: 87,
        box: horizontal.box,
        writingMode: 'horizontal-tb',
      },
    ]);

    await engine.terminate();
    expect(detector.terminate).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('keeps readable lines when a neighboring line is empty', async () => {
    installCanvas();
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const first = line({ xMin: 900, yMin: 100, xMax: 960, yMax: 500 }, true);
    const second = line({ xMin: 820, yMin: 120, xMax: 880, yMax: 520 }, true);
    const detector = {
      detect: vi.fn(async () =>
        detection([
          {
            box: { xMin: 820, yMin: 100, xMax: 960, yMax: 520 },
            score: 0.9,
            language: 'ja',
            vertical: true,
            lines: [first, second],
          },
        ]),
      ),
      terminate: vi.fn(async () => undefined),
    };
    const worker = makeWorker();
    vi.mocked(worker.recognize)
      .mockResolvedValueOnce({ data: { text: '', confidence: 0 } })
      .mockResolvedValueOnce({ data: { text: '読める', confidence: 93 } });
    const engine = new TesseractOcrEngine(
      { mangaMode: true, minimumConfidence: 35 },
      vi.fn(async () => worker),
      () => detector,
    );

    const result = await engine.recognize(source, page);

    expect(result.blocks).toEqual([
      expect.objectContaining({ id: 'mokuro-line-0-1', text: '読める', box: second.box }),
    ]);
  });

  it('uses whole-page Tesseract when Mokuro finds no lines', async () => {
    const source = document.createElement('canvas');
    source.width = page.width;
    source.height = page.height;
    const detector = {
      detect: vi.fn(async () => detection([])),
      terminate: vi.fn(async () => undefined),
    };
    const worker = makeWorker();
    vi.mocked(worker.recognize).mockResolvedValueOnce({
      data: {
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
      },
    });
    const engine = new TesseractOcrEngine(
      { mangaMode: true },
      vi.fn(async () => worker),
      () => detector,
    );

    const result = await engine.recognize(source, page);

    expect(worker.recognize).toHaveBeenCalledOnce();
    expect(worker.recognize).toHaveBeenCalledWith(source, {}, { text: true, blocks: true });
    expect(result.blocks[0]?.text).toBe('fallback');
  });
});
