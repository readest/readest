import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMIC_TEXT_DETECTOR_INPUT_SIZE,
  COMIC_TEXT_DETECTOR_MODEL_ASSET,
  COMIC_TEXT_DETECTOR_MODEL_SHA256,
  COMIC_TEXT_DETECTOR_MODEL_URL,
  COMIC_TEXT_DETECTOR_OUTPUT_SHAPES,
  extractComicLinePolygons,
  postprocessComicDetectorOutputs,
} from '@/plugins/ocr/comicTextDetector';

const mocks = vi.hoisted(() => ({
  loadRuntime: vi.fn<() => Promise<ReturnType<typeof createRuntime>>>(),
  fetchModel: vi.fn<(asset: { signal?: AbortSignal }) => Promise<ArrayBuffer>>(),
  createSession: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createRuntime = () => {
  class Tensor {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: number[],
    ) {}
    dispose() {}
  }
  return {
    env: { wasm: {} },
    Tensor,
  };
};

const createDetectorOutputs = () => {
  class OutputTensor {
    readonly dims: number[];
    readonly data: Float32Array;
    constructor(dims: readonly number[]) {
      this.dims = [...dims];
      this.data = new Float32Array(dims.reduce((size, dimension) => size * dimension, 1));
    }
    dispose() {}
  }
  return {
    blk: new OutputTensor(COMIC_TEXT_DETECTOR_OUTPUT_SHAPES.blk),
    seg: new OutputTensor(COMIC_TEXT_DETECTOR_OUTPUT_SHAPES.seg),
    det: new OutputTensor(COMIC_TEXT_DETECTOR_OUTPUT_SHAPES.det),
  };
};

const mockCanvas = () => {
  const imageData = { data: new Uint8ClampedArray(COMIC_TEXT_DETECTOR_INPUT_SIZE ** 2 * 4) };
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageData),
  };
  vi.doMock('@/plugins/ocr/canvas', () => ({
    createOcrCanvas: (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      Object.defineProperty(canvas, 'getContext', { value: () => context });
      return canvas;
    },
    isHtmlCanvas: (canvas: unknown): canvas is HTMLCanvasElement =>
      canvas instanceof HTMLCanvasElement,
  }));
};

beforeEach(() => {
  mocks.loadRuntime.mockReset();
  mocks.fetchModel.mockReset();
  mocks.createSession.mockReset();
  vi.resetModules();
  vi.doMock('onnxruntime-web/wasm', async () => {
    const runtime = await mocks.loadRuntime();
    return {
      ...runtime,
      InferenceSession: { create: (...args: unknown[]) => mocks.createSession(...args) },
    };
  });
  vi.doMock('@/plugins/ocr/modelAssets', () => ({ fetchVerifiedModelAsset: mocks.fetchModel }));
});

const fillRectangle = (
  data: Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      data[y * COMIC_TEXT_DETECTOR_INPUT_SIZE + x] = 0.9;
    }
  }
};

describe('Comic text detection', () => {
  it('starts runtime and model loading together and shares one session across pages', async () => {
    const runtime = deferred<ReturnType<typeof createRuntime>>();
    const model = deferred<ArrayBuffer>();
    const run = vi.fn(async () => createDetectorOutputs());
    mocks.createSession.mockResolvedValue({
      run,
      release: vi.fn(async () => undefined),
    });
    mocks.loadRuntime.mockReturnValue(runtime.promise);
    mocks.fetchModel.mockReturnValue(model.promise);
    mockCanvas();
    const { ComicTextDetector } = await import('@/plugins/ocr/comicTextDetector');
    const detector = new ComicTextDetector();
    const page = { width: 1200, height: 1800 };
    const source = document.createElement('canvas');
    const requests: Promise<unknown>[] = [];
    try {
      const first = detector.detect(source, page);
      const second = detector.detect(source, page);
      requests.push(first, second);
      expect(mocks.fetchModel).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(mocks.loadRuntime).toHaveBeenCalledOnce());
      expect(mocks.createSession).not.toHaveBeenCalled();

      runtime.resolve(createRuntime());
      model.resolve(new ArrayBuffer(1));
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult).toMatchObject({ page, blocks: [] });
      expect(secondResult).toMatchObject({ page, blocks: [] });
      expect(run).toHaveBeenCalledTimes(2);
      expect(mocks.createSession).toHaveBeenCalledOnce();
    } finally {
      runtime.resolve(createRuntime());
      model.resolve(new ArrayBuffer(1));
      await Promise.allSettled(requests);
      await detector.terminate();
    }
  }, 10_000);

  it('aborts a failed model attempt and retries with a fresh attempt', async () => {
    mocks.createSession.mockResolvedValue({
      run: vi.fn(async () => createDetectorOutputs()),
      release: vi.fn(async () => undefined),
    });
    mocks.loadRuntime.mockResolvedValue(createRuntime());
    const failedAttempt = deferred<ArrayBuffer>();
    mocks.fetchModel
      .mockReturnValueOnce(failedAttempt.promise)
      .mockResolvedValueOnce(new ArrayBuffer(1));
    mockCanvas();
    const { ComicTextDetector } = await import('@/plugins/ocr/comicTextDetector');
    const detector = new ComicTextDetector();
    const source = document.createElement('canvas');
    const requests: Promise<unknown>[] = [];
    try {
      const failed = detector.detect(source, { width: 1200, height: 1800 });
      requests.push(failed);
      await vi.waitFor(() => expect(mocks.fetchModel).toHaveBeenCalledOnce());
      const failedSignal = mocks.fetchModel.mock.calls[0]?.[0].signal;
      failedAttempt.reject(new Error('model fetch failed'));
      await expect(failed).rejects.toThrow('model fetch failed');
      expect(failedSignal?.aborted).toBe(true);

      const retried = await detector.detect(source, { width: 1200, height: 1800 });
      expect(retried.blocks).toEqual([]);
      expect(mocks.fetchModel).toHaveBeenCalledTimes(2);
      expect(mocks.createSession).toHaveBeenCalledOnce();
    } finally {
      failedAttempt.reject(new Error('test cleanup'));
      await Promise.allSettled(requests);
      await detector.terminate();
    }
  });

  it('does not create a session if termination wins while the runtime is pending', async () => {
    const runtime = deferred<ReturnType<typeof createRuntime>>();
    mocks.loadRuntime.mockReturnValue(runtime.promise);
    mocks.fetchModel.mockResolvedValue(new ArrayBuffer(1));
    mockCanvas();
    const { ComicTextDetector } = await import('@/plugins/ocr/comicTextDetector');
    const detector = new ComicTextDetector();
    const source = document.createElement('canvas');
    let inFlight: Promise<unknown> | undefined;
    try {
      inFlight = detector.detect(source, { width: 1200, height: 1800 });
      expect(mocks.fetchModel).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(mocks.loadRuntime).toHaveBeenCalledOnce());
      const signal = mocks.fetchModel.mock.calls[0]?.[0].signal;
      const termination = detector.terminate();
      expect(signal?.aborted).toBe(true);
      runtime.resolve(createRuntime());
      await expect(inFlight).rejects.toThrow('Comic text detector has been terminated');
      await termination;
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally {
      runtime.resolve(createRuntime());
      if (inFlight) await Promise.allSettled([inFlight]);
      await detector.terminate();
    }
  });

  it('releases a session that finishes initializing after termination', async () => {
    const session = deferred<unknown>();
    const release = vi.fn(async () => undefined);
    mocks.loadRuntime.mockResolvedValue(createRuntime());
    mocks.fetchModel.mockResolvedValue(new ArrayBuffer(1));
    mocks.createSession.mockReturnValue(session.promise);
    mockCanvas();
    const { ComicTextDetector } = await import('@/plugins/ocr/comicTextDetector');
    const detector = new ComicTextDetector();
    const source = document.createElement('canvas');
    let inFlight: Promise<unknown> | undefined;
    try {
      inFlight = detector.detect(source, { width: 1200, height: 1800 });
      await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce());
      const termination = detector.terminate();
      session.resolve({ release });
      await expect(inFlight).rejects.toThrow('Comic text detector has been terminated');
      await termination;
      expect(release).toHaveBeenCalledOnce();
    } finally {
      session.resolve({ release });
      if (inFlight) await Promise.allSettled([inFlight]);
      await detector.terminate();
    }
  });

  it('keeps an uneven text component in its minimum enclosing rectangle', () => {
    const lines = new Float32Array(1024 * 1024);
    fillRectangle(lines, 100, 100, 120, 160);
    fillRectangle(lines, 100, 100, 140, 110);

    const [line] = extractComicLinePolygons(lines, { width: 1024, height: 1024 });

    expect(line?.vertical).toBe(true);
    expect(line?.box).toEqual({ xMin: 82, yMin: 82, xMax: 157, yMax: 177 });
  });

  it('maps the pinned detector output to ordered Japanese text lines', () => {
    expect(COMIC_TEXT_DETECTOR_MODEL_ASSET).toMatchObject({
      url: COMIC_TEXT_DETECTOR_MODEL_URL,
      sha256: COMIC_TEXT_DETECTOR_MODEL_SHA256,
    });

    const blocks = new Float32Array(64_512 * 7);
    const segmentation = new Float32Array(1024 * 1024);
    const lines = new Float32Array(2 * 1024 * 1024);
    blocks.set([512, 400, 240, 120, 0.95, 0.05, 0.95]);
    fillRectangle(segmentation, 392, 340, 632, 460);
    fillRectangle(lines, 420, 360, 600, 420);

    const result = postprocessComicDetectorOutputs(
      {
        blk: { dims: [1, 64_512, 7], data: blocks },
        seg: { dims: [1, 1, 1024, 1024], data: segmentation },
        det: { dims: [1, 2, 1024, 1024], data: lines },
      },
      { width: 1024, height: 1024 },
    );

    expect(result.blocks).toEqual([
      expect.objectContaining({
        language: 'ja',
        lines: [expect.objectContaining({ vertical: false })],
      }),
    ]);
  });
});
