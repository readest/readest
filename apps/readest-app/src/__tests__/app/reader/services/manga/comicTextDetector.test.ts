import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractComicLines,
  postprocessComicDetectorOutputs,
} from '@/plugins/ocr/comicTextDetector';

const mocks = vi.hoisted(() => ({
  loadRuntime: vi.fn<() => Promise<ReturnType<typeof createRuntime>>>(),
  fetchModel: vi.fn<(asset: unknown, options: { signal?: AbortSignal }) => Promise<ArrayBuffer>>(),
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
  }
  return {
    env: { wasm: {} },
    Tensor,
  };
};

/** What the model makes of a page without text: logits of its blocks, and its lines. */
const createDetectorOutputs = (width = 1024, height = 1024) => ({
  647: { data: new Float32Array((width * height * 21) / 64).fill(-10) },
  762: { data: new Float32Array((width * height * 21) / 256).fill(-10) },
  877: { data: new Float32Array((width * height * 21) / 1024).fill(-10) },
  1179: { data: new Float32Array(width * height) },
});

const mockCanvas = () => {
  const imageData = { data: new Uint8ClampedArray(1024 ** 2 * 4) };
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
  vi.doMock('@/plugins/ocr/modelAssets', () => ({ loadModelAsset: mocks.fetchModel }));
  vi.doMock('@/plugins/ocr/trimOnnxModel', () => ({ trimOnnxModel: (model: unknown) => model }));
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
      data[y * 1024 + x] = 0.9;
    }
  }
};

describe('Comic text detection', () => {
  it('starts runtime and model loading together and shares one session across pages', async () => {
    const runtime = deferred<ReturnType<typeof createRuntime>>();
    const model = deferred<ArrayBuffer>();
    const run = vi.fn(async (_: { images: { dims: number[] } }) => createDetectorOutputs(704));
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

      expect(firstResult).toEqual([]);
      expect(secondResult).toEqual([]);
      expect(run).toHaveBeenCalledTimes(2);
      // As wide as the page, not a square.
      expect(run.mock.calls[0]![0].images.dims).toEqual([1, 3, 1024, 704]);
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
      run: vi.fn(async () => createDetectorOutputs(704)),
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
      const failedSignal = mocks.fetchModel.mock.calls[0]?.[1].signal;
      failedAttempt.reject(new Error('model fetch failed'));
      await expect(failed).rejects.toThrow('model fetch failed');
      expect(failedSignal?.aborted).toBe(true);

      const retried = await detector.detect(source, { width: 1200, height: 1800 });
      expect(retried).toEqual([]);
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
      const signal = mocks.fetchModel.mock.calls[0]?.[1].signal;
      const termination = detector.terminate();
      expect(signal?.aborted).toBe(true);
      runtime.resolve(createRuntime());
      await expect(inFlight).rejects.toMatchObject({ name: 'AbortError' });
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
      await expect(inFlight).rejects.toMatchObject({ name: 'AbortError' });
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

    const [line] = extractComicLines(lines, { width: 1024, height: 1024 });

    expect(line?.vertical).toBe(true);
    expect(line?.box).toEqual({ xMin: 82, yMin: 82, xMax: 157, yMax: 177 });
  });

  it('maps the pinned detector output to ordered Japanese text lines', () => {
    const outputs = createDetectorOutputs();
    const blocks = outputs[877].data;
    // The block of the cell at 512, 384: 116 by 95, and Japanese.
    const cell = 12 * 32 + 16;
    for (const [value, logit] of [0, 0, 0, 0.041, 3, -3, 3].entries()) {
      blocks[value * 32 * 32 + cell] = logit;
    }
    const lines = outputs[1179].data;
    fillRectangle(lines, 480, 375, 544, 393);
    // A line outside of any block, and a block without a line.
    fillRectangle(lines, 100, 800, 200, 830);
    const other = 28 * 32 + 28;
    for (const [value, logit] of [0, 0, 0, 0, 3, -3, 3].entries()) {
      blocks[value * 32 * 32 + other] = logit;
    }

    const result = postprocessComicDetectorOutputs(
      [outputs[647].data, outputs[762].data, blocks, lines],
      { width: 1024, height: 1024 },
    );

    expect(result.map(({ language, lines }) => [language, lines.length])).toEqual([
      ['ja', 1],
      ['ja', 1],
      ['unknown', 1],
    ]);
    expect(result[0]!.lines[0]!.vertical).toBe(false);
    expect(result[1]!.box).toEqual({ xMin: 854, yMin: 867, xMax: 970, yMax: 957 });
  });
});
