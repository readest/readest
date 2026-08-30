import { describe, expect, it, vi } from 'vitest';
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
