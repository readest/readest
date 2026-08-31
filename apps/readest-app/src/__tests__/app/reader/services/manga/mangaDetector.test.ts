import { describe, expect, it, vi } from 'vitest';

import {
  associateMangaBubbles,
  MangaDetector,
  parseMangaDetections,
  type MangaDetection,
} from '@/app/reader/services/manga/mangaDetector';

const box = (xMin: number, yMin: number, xMax: number, yMax: number) => ({
  xMin,
  yMin,
  xMax,
  yMax,
});

describe('parseMangaDetections', () => {
  it('maps model labels, clamps boxes, filters scores, and drops invalid output', () => {
    const detections = parseMangaDetections(
      new BigInt64Array([0n, 1n, 2n, 9n, 0n]),
      new Float32Array([
        -10,
        20,
        110,
        180,
        10,
        30,
        80,
        120,
        0,
        0,
        20,
        20,
        0,
        0,
        10,
        10,
        20,
        20,
        Number.POSITIVE_INFINITY,
        50,
      ]),
      new Float32Array([0.9, 0.7, 0.2, 0.99, 0.8]),
      { width: 100, height: 160 },
      0.45,
    );

    expect(detections).toEqual([
      { label: 'bubble', score: expect.closeTo(0.9), box: box(0, 20, 100, 160) },
      { label: 'text-bubble', score: expect.closeTo(0.7), box: box(10, 30, 80, 120) },
    ]);
  });

  it('removes near-identical detections of the same class', () => {
    const detections = parseMangaDetections(
      new BigInt64Array([0n, 0n]),
      new Float32Array([10, 10, 90, 90, 11, 11, 89, 89]),
      new Float32Array([0.95, 0.8]),
      { width: 100, height: 100 },
    );

    expect(detections).toHaveLength(1);
    expect(detections[0]?.score).toBeCloseTo(0.95);
  });

  it('keeps a slightly weaker container without lowering the text threshold', () => {
    const detections = parseMangaDetections(
      new BigInt64Array([0n, 1n, 2n]),
      new Float32Array([10, 10, 190, 290, 30, 30, 170, 270, 210, 10, 280, 80]),
      new Float32Array([0.404, 0.52, 0.44]),
      { width: 300, height: 300 },
    );

    expect(detections).toEqual([
      { label: 'text-bubble', score: expect.closeTo(0.52), box: box(30, 30, 170, 270) },
      { label: 'bubble', score: expect.closeTo(0.404), box: box(10, 10, 190, 290) },
    ]);
    expect(associateMangaBubbles(detections)).toHaveLength(1);
  });
});

describe('associateMangaBubbles', () => {
  it('attaches speech text to the smallest containing bubble and ignores sound effects', () => {
    const detections: MangaDetection[] = [
      { label: 'bubble', score: 0.99, box: box(0, 0, 200, 300) },
      { label: 'bubble', score: 0.9, box: box(20, 20, 180, 280) },
      { label: 'text-bubble', score: 0.8, box: box(90, 50, 140, 220) },
      { label: 'text-bubble', score: 0.75, box: box(40, 60, 80, 210) },
      { label: 'text-free', score: 0.98, box: box(220, 10, 280, 80) },
      { label: 'text-bubble', score: 0.95, box: box(250, 200, 290, 260) },
    ];

    const regions = associateMangaBubbles(detections);

    expect(regions).toEqual([
      {
        id: 'manga-bubble-0',
        score: 0.9,
        bubbleBox: box(20, 20, 180, 280),
        textBoxes: [box(90, 50, 140, 220), box(40, 60, 80, 210)],
        writingMode: 'vertical-rl',
      },
    ]);
  });

  it('uses overlap for a text box whose center falls just outside the bubble', () => {
    const regions = associateMangaBubbles([
      { label: 'bubble', score: 0.8, box: box(20, 20, 100, 100) },
      { label: 'text-bubble', score: 0.8, box: box(10, 30, 70, 90) },
    ]);

    expect(regions[0]?.textBoxes).toEqual([box(10, 30, 70, 90)]);
    expect(regions[0]?.writingMode).toBe('horizontal-tb');
  });
});

describe('MangaDetector', () => {
  it('loads lazily, reuses the session, and waits for inference before release', async () => {
    const drawImage = vi.fn();
    const rgba = new Uint8ClampedArray(640 * 640 * 4);
    rgba.set([255, 128, 0, 255]);
    const getImageData = vi.fn(() => ({ data: rgba }));
    const createCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, getImageData }),
    }));
    class Tensor {
      constructor(
        public type: string,
        public data: Float32Array | BigInt64Array,
        public dims: number[],
      ) {}
    }
    const run = vi.fn(async (_feeds: Record<string, unknown>) => ({
      labels: { data: new BigInt64Array([0n, 1n]) },
      boxes: { data: new Float32Array([0, 0, 100, 200, 20, 30, 80, 180]) },
      scores: { data: new Float32Array([0.9, 0.8]) },
    }));
    const release = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({ run, release }));
    const wasm: { proxy?: boolean } = {};
    const runtime = {
      env: { wasm },
      Tensor,
      InferenceSession: { create: createSession },
    };
    const loadRuntime = vi.fn(async () => runtime);
    const loadModel = vi.fn(async () => new ArrayBuffer(4));
    const detector = new MangaDetector({}, { createCanvas, loadRuntime, loadModel });
    const source = document.createElement('canvas');

    expect(loadRuntime).not.toHaveBeenCalled();
    await detector.detect(source, { width: 100, height: 200 });
    await detector.detect(source, { width: 100, height: 200 });

    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(loadModel).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(wasm.proxy).toBe(true);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 640, 640);
    const firstFeeds = run.mock.calls[0]![0] as {
      images: Tensor;
      orig_target_sizes: Tensor;
    };
    expect(firstFeeds.images.dims).toEqual([1, 3, 640, 640]);
    expect(firstFeeds.images.data[0]).toBe(1);
    expect(firstFeeds.images.data[640 * 640]).toBeCloseTo(128 / 255);
    expect(firstFeeds.orig_target_sizes.data).toEqual(new BigInt64Array([100n, 200n]));

    let finishRun!: (output: Awaited<ReturnType<typeof run>>) => void;
    run.mockImplementationOnce(() => new Promise((resolve) => (finishRun = resolve)));
    const detecting = detector.detect(source, { width: 100, height: 200 });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));

    const terminating = detector.terminate();
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    finishRun({
      labels: { data: new BigInt64Array() },
      boxes: { data: new Float32Array() },
      scores: { data: new Float32Array() },
    });
    await expect(detecting).rejects.toThrow('terminated');
    await terminating;
    await detector.terminate();
    expect(release).toHaveBeenCalledOnce();
    await expect(detector.detect(source, { width: 100, height: 200 })).rejects.toThrow(
      'terminated',
    );
  });

  it('rejects invalid page dimensions before loading the model', async () => {
    const loadRuntime = vi.fn();
    const detector = new MangaDetector({}, { loadRuntime });

    await expect(
      detector.detect(document.createElement('canvas'), { width: 0, height: 100 }),
    ).rejects.toThrow('dimensions');
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it('recreates and releases the session after inference fails', async () => {
    const pixels = new Uint8ClampedArray(640 * 640 * 4);
    const createCanvas = () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({ data: pixels }),
      }),
    });
    class Tensor {
      constructor(
        public type: string,
        public data: Float32Array | BigInt64Array,
        public dims: number[],
      ) {}
    }
    const firstRelease = vi.fn(async () => undefined);
    const secondRelease = vi.fn(async () => undefined);
    const createSession = vi
      .fn()
      .mockResolvedValueOnce({
        run: vi.fn(async () => {
          throw new Error('inference failed');
        }),
        release: firstRelease,
      })
      .mockResolvedValueOnce({
        run: vi.fn(async () => ({
          labels: { data: new BigInt64Array() },
          boxes: { data: new Float32Array() },
          scores: { data: new Float32Array() },
        })),
        release: secondRelease,
      });
    const runtime = {
      env: { wasm: {} },
      Tensor,
      InferenceSession: { create: createSession },
    };
    const detector = new MangaDetector(
      {},
      {
        createCanvas,
        loadRuntime: async () => runtime,
        loadModel: async () => new ArrayBuffer(4),
      },
    );
    const source = document.createElement('canvas');

    await expect(detector.detect(source, { width: 100, height: 200 })).rejects.toThrow(
      'inference failed',
    );
    await expect(detector.detect(source, { width: 100, height: 200 })).resolves.toEqual([]);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(firstRelease).toHaveBeenCalledOnce();
    await detector.terminate();
    expect(secondRelease).toHaveBeenCalledOnce();
  });
});
