import { afterEach, describe, expect, it, vi } from 'vitest';
import { OEM, PSM } from 'tesseract.js';

import {
  TesseractOcrEngine,
  type MangaTextDetectorFactory,
  type TesseractWorker,
  type TesseractWorkerFactory,
} from '@/app/reader/services/ocr/tesseractEngine';

const makeWorker = (): TesseractWorker => ({
  setParameters: vi.fn(async () => undefined),
  recognize: vi.fn(async () => ({
    data: {
      blocks: [
        {
          blocktype: 'FLOWING_TEXT',
          paragraphs: [
            {
              lines: [
                {
                  text: 'recognized text',
                  confidence: 92,
                  bbox: { x0: 10, y0: 20, x1: 210, y1: 60 },
                },
              ],
            },
          ],
        },
      ],
    },
  })),
  terminate: vi.fn(async () => undefined),
});

describe('TesseractOcrEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('creates one lazy local worker and converts recognition output', async () => {
    const worker = makeWorker();
    const progress = vi.fn();
    const createWorker = vi.fn<TesseractWorkerFactory>(async () => worker);
    const engine = new TesseractOcrEngine(
      {
        languages: ['jpn', 'jpn_vert'],
        pageSegmentationMode: PSM.SPARSE_TEXT,
        minimumConfidence: 40,
        onProgress: progress,
      },
      createWorker,
    );

    expect(createWorker).not.toHaveBeenCalled();
    const page = await engine.recognize('blob:page-1', {
      pageIndex: 1,
      width: 1200,
      height: 1800,
    });
    await engine.recognize('blob:page-2', { pageIndex: 2, width: 1200, height: 1800 });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith(
      ['jpn', 'jpn_vert'],
      OEM.LSTM_ONLY,
      expect.objectContaining({
        workerPath: '/vendor/tesseract/dist/worker.min.js',
        corePath: '/vendor/tesseract/core',
        workerBlobURL: false,
      }),
    );
    expect(worker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    expect(worker.recognize).toHaveBeenCalledWith('blob:page-1', {}, { text: true, blocks: true });
    expect(page.blocks).toEqual([
      expect.objectContaining({
        text: 'recognized text',
        confidence: 92,
        writingMode: 'horizontal-tb',
      }),
    ]);

    const logger = createWorker.mock.calls[0]?.[2].logger;
    logger?.({
      jobId: 'job-1',
      progress: 0.5,
      status: 'recognizing text',
      userJobId: 'job-1',
      workerId: 'worker-1',
    });
    expect(progress).toHaveBeenCalledWith({ status: 'recognizing text', progress: 0.5 });
  });

  it('retries worker initialization after a transient failure', async () => {
    const worker = makeWorker();
    const createWorker = vi
      .fn<TesseractWorkerFactory>()
      .mockRejectedValueOnce(new Error('model download failed'))
      .mockResolvedValue(worker);
    const engine = new TesseractOcrEngine({}, createWorker);

    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('model download failed');
    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).resolves.toMatchObject({ pageIndex: 0 });

    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('replaces a worker after recognition fails', async () => {
    const failedWorker = makeWorker();
    vi.mocked(failedWorker.recognize).mockRejectedValue(new Error('worker crashed'));
    const replacementWorker = makeWorker();
    const createWorker = vi
      .fn<TesseractWorkerFactory>()
      .mockResolvedValueOnce(failedWorker)
      .mockResolvedValue(replacementWorker);
    const engine = new TesseractOcrEngine({}, createWorker);

    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('worker crashed');
    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).resolves.toMatchObject({ pageIndex: 0 });

    expect(failedWorker.terminate).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('upscales a low-resolution canvas before recognition', async () => {
    const source = document.createElement('canvas');
    source.width = 391;
    source.height = 577;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);
    const worker = makeWorker();
    const engine = new TesseractOcrEngine(
      {},
      vi.fn(async () => worker),
    );

    const page = await engine.recognize(source, {
      pageIndex: 4,
      width: source.width,
      height: source.height,
    });

    const prepared = vi.mocked(worker.recognize).mock.calls[0]?.[0] as HTMLCanvasElement;
    expect(prepared).not.toBe(source);
    expect(prepared.width).toBe(1173);
    expect(prepared.height).toBe(1731);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1173, 1731);
    expect(page).toMatchObject({ width: 1173, height: 1731 });
  });

  it('prepares an iframe canvas in the reader document realm', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const source = iframe.contentDocument!.createElement('canvas');
    source.width = 391;
    source.height = 577;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);
    const worker = makeWorker();
    const engine = new TesseractOcrEngine(
      {},
      vi.fn(async () => worker),
    );

    await engine.recognize(source, {
      pageIndex: 4,
      width: source.width,
      height: source.height,
    });

    const prepared = vi.mocked(worker.recognize).mock.calls[0]?.[0] as HTMLCanvasElement;
    expect(prepared.ownerDocument).toBe(document);
  });

  it('keeps an already detailed canvas at its source resolution', async () => {
    const source = document.createElement('canvas');
    source.width = 1600;
    source.height = 2400;
    const worker = makeWorker();
    const engine = new TesseractOcrEngine(
      {},
      vi.fn(async () => worker),
    );

    const page = await engine.recognize(source, {
      pageIndex: 5,
      width: source.width,
      height: source.height,
    });

    expect(worker.recognize).toHaveBeenCalledWith(source, {}, { text: true, blocks: true });
    expect(page).toMatchObject({ width: 1600, height: 2400 });
  });

  it('detects manga bubbles and recognizes their text boxes with matching segmentation', async () => {
    const source = document.createElement('canvas');
    source.width = 1200;
    source.height = 1800;
    const getImageData = vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = 48;
        data[offset + 1] = 36;
        data[offset + 2] = 72;
        data[offset + 3] = 255;
      }
      return { data, width, height };
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      drawImage: vi.fn(),
      getImageData,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const worker = makeWorker();
    vi.mocked(worker.recognize)
      .mockResolvedValueOnce({ data: { text: '右', confidence: 90 } })
      .mockResolvedValueOnce({ data: { text: '左', confidence: 80 } })
      .mockResolvedValueOnce({ data: { text: '  ', confidence: 95 } });
    const detector = {
      detect: vi.fn(async () => [
        {
          id: 'manga-bubble-0',
          score: 0.94,
          bubbleBox: { xMin: 80, yMin: 100, xMax: 420, yMax: 620 },
          textBoxes: [
            { xMin: 260, yMin: 160, xMax: 360, yMax: 500 },
            { xMin: 120, yMin: 180, xMax: 220, yMax: 480 },
            { xMin: 365, yMin: 200, xMax: 395, yMax: 340 },
          ],
          writingMode: 'vertical-rl' as const,
        },
      ]),
      terminate: vi.fn(async () => undefined),
    };
    const createDetector = vi.fn<MangaTextDetectorFactory>(() => detector);
    const engine = new TesseractOcrEngine(
      { languages: ['jpn_vert'], mangaMode: true },
      vi.fn(async () => worker),
      createDetector,
    );

    const page = await engine.recognize(source, {
      pageIndex: 7,
      width: source.width,
      height: source.height,
    });

    expect(createDetector).toHaveBeenCalledOnce();
    expect(detector.detect).toHaveBeenCalledWith(source, {
      width: 1200,
      height: 1800,
    });
    expect(worker.recognize).toHaveBeenNthCalledWith(
      1,
      source,
      { rectangle: { left: 260, top: 160, width: 100, height: 340 } },
      { text: true, blocks: false },
    );
    expect(worker.recognize).toHaveBeenNthCalledWith(
      2,
      source,
      { rectangle: { left: 120, top: 180, width: 100, height: 300 } },
      { text: true, blocks: false },
    );
    expect(worker.setParameters).toHaveBeenNthCalledWith(2, {
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT,
      preserve_interword_spaces: '1',
    });
    expect(page.blocks).toEqual([
      {
        id: 'manga-bubble-0',
        text: '右\n左',
        confidence: 85,
        box: { xMin: 120, yMin: 160, xMax: 360, yMax: 500 },
        bubbleBox: { xMin: 80, yMin: 100, xMax: 420, yMax: 620 },
        maskBoxes: [
          { xMin: 260, yMin: 160, xMax: 360, yMax: 500 },
          { xMin: 120, yMin: 180, xMax: 220, yMax: 480 },
          { xMin: 365, yMin: 200, xMax: 395, yMax: 340 },
        ],
        backgroundColor: 'rgb(48 36 72)',
        writingMode: 'vertical-rl',
      },
    ]);
    const [, , sampledWidth = 0, sampledHeight = 0] = getImageData.mock.calls[0] ?? [];
    expect(sampledWidth * sampledHeight).toBeLessThanOrEqual(12_000);

    await engine.terminate();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(detector.terminate).toHaveBeenCalledOnce();
  });

  it('falls back to whole-page OCR when the manga detector finds no bubbles', async () => {
    const source = document.createElement('canvas');
    source.width = 1200;
    source.height = 1800;
    const worker = makeWorker();
    const detector = {
      detect: vi.fn(async () => []),
      terminate: vi.fn(async () => undefined),
    };
    const engine = new TesseractOcrEngine(
      { mangaMode: true },
      vi.fn(async () => worker),
      () => detector,
    );

    const page = await engine.recognize(source, {
      pageIndex: 2,
      width: source.width,
      height: source.height,
    });

    expect(worker.recognize).toHaveBeenCalledWith(source, {}, { text: true, blocks: true });
    expect(page.blocks[0]?.text).toBe('recognized text');
  });

  it('skips whole-page OCR when manga translation only accepts speech bubbles', async () => {
    const source = document.createElement('canvas');
    source.width = 1200;
    source.height = 1800;
    const createWorker = vi.fn<TesseractWorkerFactory>();
    const detector = {
      detect: vi.fn(async () => []),
      terminate: vi.fn(async () => undefined),
    };
    const engine = new TesseractOcrEngine(
      { mangaMode: true, wholePageFallback: false },
      createWorker,
      () => detector,
    );

    await expect(
      engine.recognize(source, { pageIndex: 2, width: source.width, height: source.height }),
    ).resolves.toEqual({ pageIndex: 2, width: 1200, height: 1800, blocks: [] });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('terminates a worker that fails during parameter setup', async () => {
    const failedWorker = makeWorker();
    vi.mocked(failedWorker.setParameters).mockRejectedValueOnce(new Error('setup failed'));
    const replacementWorker = makeWorker();
    const createWorker = vi
      .fn<TesseractWorkerFactory>()
      .mockResolvedValueOnce(failedWorker)
      .mockResolvedValue(replacementWorker);
    const engine = new TesseractOcrEngine({}, createWorker);

    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('setup failed');
    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).resolves.toMatchObject({ pageIndex: 0 });

    expect(failedWorker.terminate).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('terminates an initialized worker once and rejects later work', async () => {
    const worker = makeWorker();
    const createWorker = vi.fn<TesseractWorkerFactory>(async () => worker);
    const engine = new TesseractOcrEngine({}, createWorker);

    await engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 });
    await engine.terminate();
    await engine.terminate();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('terminated');
  });
});
