import { afterEach, describe, expect, it, vi } from 'vitest';
import { OEM, PSM } from 'tesseract.js';

import {
  TesseractOcrEngine,
  type TesseractLanguageAssetLoader,
  type TesseractWorker,
  type TesseractWorkerFactory,
} from '@/app/reader/services/ocr/tesseractEngine';

vi.mock('@/app/reader/services/manga/modelAssets', () => ({
  fetchVerifiedModelAsset: vi.fn(async () => new ArrayBuffer(1)),
}));

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

  it('creates one lazy worker and converts recognition output', async () => {
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

    const languages = createWorker.mock.calls[0]?.[0];
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(languages).toEqual([
      { code: 'jpn', data: expect.any(Uint8Array) },
      { code: 'jpn_vert', data: expect.any(Uint8Array) },
    ]);
    expect(createWorker).toHaveBeenCalledWith(
      languages,
      OEM.LSTM_ONLY,
      expect.objectContaining({
        workerPath: '/vendor/tesseract/dist/worker.min.js',
        corePath: '/vendor/tesseract/core',
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: false,
      }),
    );
    expect(worker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    expect(page.blocks).toEqual([
      expect.objectContaining({
        text: 'recognized text',
        confidence: 92,
        writingMode: 'horizontal-tb',
      }),
    ]);

    createWorker.mock.calls[0]?.[2].logger?.({
      jobId: 'job-1',
      progress: 0.5,
      status: 'recognizing text',
      userJobId: 'job-1',
      workerId: 'worker-1',
    });
    expect(progress).toHaveBeenCalledWith({ status: 'recognizing text', progress: 0.5 });
  });

  it('loads every requested language before creating the worker', async () => {
    const events: string[] = [];
    const loadLanguageAsset = vi.fn<TesseractLanguageAssetLoader>(async (asset) => {
      events.push(`asset:${asset.url}`);
      return new Uint8Array([1, 2, 3]).buffer;
    });
    const createWorker = vi.fn<TesseractWorkerFactory>(async () => {
      events.push('worker');
      return makeWorker();
    });
    const engine = new TesseractOcrEngine(
      { languages: ['jpn', 'jpn_vert'] },
      createWorker,
      undefined,
      undefined,
      loadLanguageAsset,
    );

    await engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 });

    expect(loadLanguageAsset).toHaveBeenCalledTimes(2);
    expect(events.slice(0, 2).every((event) => event.startsWith('asset:'))).toBe(true);
    expect(events.at(-1)).toBe('worker');
  });

  it('retries after worker creation fails', async () => {
    const createWorker = vi
      .fn<TesseractWorkerFactory>()
      .mockRejectedValueOnce(new Error('model download failed'))
      .mockResolvedValue(makeWorker());
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

  it.each([
    { width: 391, height: 577, resized: true },
    { width: 1200, height: 1800, resized: false },
    { width: 8000, height: 12_000, resized: true },
  ])('bounds a $width x $height canvas before recognition', async ({ width, height, resized }) => {
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
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

    const page = await engine.recognize(source, { pageIndex: 4, width, height });
    const prepared = vi.mocked(worker.recognize).mock.calls[0]?.[0] as HTMLCanvasElement;

    expect(prepared === source).toBe(!resized);
    expect(prepared.width * prepared.height).toBeLessThanOrEqual(3_000_000);
    expect(page).toMatchObject({ width: prepared.width, height: prepared.height });
    if (resized)
      expect(drawImage).toHaveBeenCalledWith(source, 0, 0, prepared.width, prepared.height);
  });

  it('terminates an initialized worker once and rejects later work', async () => {
    const worker = makeWorker();
    const engine = new TesseractOcrEngine(
      {},
      vi.fn(async () => worker),
    );

    await engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 });
    await engine.terminate();
    await engine.terminate();

    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(
      engine.recognize('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('terminated');
  });

  it('does not wait for pending worker creation during termination', async () => {
    let resolveWorker!: (worker: TesseractWorker) => void;
    const workerCreation = new Promise<TesseractWorker>((resolve) => {
      resolveWorker = resolve;
    });
    const createWorker = vi.fn<TesseractWorkerFactory>(() => workerCreation);
    const engine = new TesseractOcrEngine({}, createWorker);
    const recognition = engine.recognize('blob:page', {
      pageIndex: 0,
      width: 100,
      height: 100,
    });

    await vi.waitFor(() => expect(createWorker).toHaveBeenCalledOnce());
    await expect(
      Promise.race([
        engine.terminate().then(() => 'terminated' as const),
        new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 20)),
      ]),
    ).resolves.toBe('terminated');

    const worker = makeWorker();
    resolveWorker(worker);
    await expect(recognition).rejects.toThrow('terminated');
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  });

  it('aborts language loading before a worker is created', async () => {
    const loadLanguageAsset = vi.fn<TesseractLanguageAssetLoader>(
      (asset) =>
        new Promise<ArrayBuffer>((resolve) => {
          asset.signal?.addEventListener('abort', () => resolve(new ArrayBuffer(1)), {
            once: true,
          });
        }),
    );
    const createWorker = vi.fn<TesseractWorkerFactory>(async () => makeWorker());
    const engine = new TesseractOcrEngine(
      {},
      createWorker,
      undefined,
      undefined,
      loadLanguageAsset,
    );
    const recognition = engine.recognize('blob:page', {
      pageIndex: 0,
      width: 100,
      height: 100,
    });

    await vi.waitFor(() => expect(loadLanguageAsset).toHaveBeenCalledOnce());
    await engine.terminate();

    await expect(recognition).rejects.toThrow('terminated');
    expect(createWorker).not.toHaveBeenCalled();
  });
});
