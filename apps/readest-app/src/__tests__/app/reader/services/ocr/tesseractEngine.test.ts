import { afterEach, describe, expect, it, vi } from 'vitest';
import { OEM, PSM } from 'tesseract.js';

import {
  TesseractOcrEngine,
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
