import { describe, expect, it, vi } from 'vitest';

import {
  decodePaddleMangaOcr,
  PADDLE_MANGA_OCR_DICTIONARY_ASSET,
  PADDLE_MANGA_OCR_MODEL_ASSET,
  PaddleMangaOcrEngine,
  rotateRgbaCounterclockwise,
  type PaddleMangaOcrRuntime,
} from '@/app/reader/services/manga/paddleMangaOcrEngine';

const box = (xMin: number, yMin: number, xMax: number, yMax: number) => ({
  xMin,
  yMin,
  xMax,
  yMax,
});

const makePixels = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 20; y < Math.min(80, height); y += 1) {
    for (let x = 15; x < Math.min(55, width); x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 64;
      pixels[offset + 2] = 128;
    }
  }
  return pixels;
};

const makeOutput = (
  batch: number,
  indices: readonly number[] = [1, 1, 0, 2, 0],
  confidence = 0.9,
) => {
  const classes = 4;
  const data = new Float32Array(batch * indices.length * classes);
  for (let item = 0; item < batch; item += 1) {
    for (const [step, index] of indices.entries()) {
      data[(item * indices.length + step) * classes + index] = confidence;
    }
  }
  return { data, dims: [batch, indices.length, classes] };
};

const makeViewOutput = (items: readonly { indices: readonly number[]; confidence: number }[]) => {
  const classes = 4;
  const steps = Math.max(...items.map(({ indices }) => indices.length));
  const data = new Float32Array(items.length * steps * classes);
  for (const [item, { indices, confidence }] of items.entries()) {
    for (let step = 0; step < steps; step += 1) {
      const index = indices[step] ?? 0;
      data[(item * steps + step) * classes + index] = index === 0 ? 1 : confidence;
    }
  }
  return { data, dims: [items.length, steps, classes] };
};

const makeHarness = (width = 80, height = 120) => {
  class Tensor {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: number[],
    ) {}
  }
  const run = vi.fn(async (feeds: Record<string, unknown>) => {
    const input = feeds['x'] as Tensor;
    return { fetch_name_0: makeOutput(input.dims[0]!) };
  });
  const release = vi.fn(async () => undefined);
  const createSession = vi.fn(async () => ({ run, release }));
  const runtime = {
    env: { wasm: {} },
    Tensor,
    InferenceSession: { create: createSession },
  } as unknown as PaddleMangaOcrRuntime;
  const detector = {
    detect: vi.fn(async () => [
      {
        id: 'bubble-0',
        score: 0.9,
        bubbleBox: box(5, 5, 75, 110),
        textBoxes: [box(15, 20, 55, 80)],
        writingMode: 'horizontal-tb' as 'horizontal-tb' | 'vertical-rl',
      },
    ]),
    terminate: vi.fn(async () => undefined),
  };
  const loadModel = vi.fn(async () => new ArrayBuffer(4));
  const loadDictionary = vi.fn(async () => new TextEncoder().encode('あ\nい\n').buffer);
  const engine = new PaddleMangaOcrEngine(
    {},
    {
      createDetector: () => detector,
      loadRuntime: async () => runtime,
      loadModel,
      loadDictionary,
    },
  );
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const pixels = makePixels(source.width, source.height);
  vi.spyOn(source, 'getContext').mockReturnValue({
    getImageData: vi.fn(() => ({ data: pixels, width: source.width, height: source.height })),
  } as unknown as CanvasRenderingContext2D);
  return {
    createSession,
    detector,
    engine,
    loadDictionary,
    loadModel,
    release,
    run,
    pixels,
    source,
  };
};

describe('Paddle manga OCR assets', () => {
  it('pins the manga model and official dictionary to immutable revisions', () => {
    expect(PADDLE_MANGA_OCR_MODEL_ASSET).toMatchObject({
      url: expect.stringContaining('/resolve/1ef01f78c59f6f66389c9722fd2d0ab761680ea9/'),
      sha256: 'c5cc5038a98c3df3e2d37de5716f603e2b0bcd3536c74078fdd91876a48a25ef',
      maximumDownloadBytes: 22_000_000,
    });
    expect(PADDLE_MANGA_OCR_DICTIONARY_ASSET).toMatchObject({
      url: expect.stringContaining('/e5046169b225bcdfbe25d45b4e809ff0f1a69c2c/'),
      sha256: 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d',
      maximumDownloadBytes: 80_000,
    });
  });
});

describe('decodePaddleMangaOcr', () => {
  it('collapses CTC repeats and blanks and converts confidence to percent', () => {
    expect(decodePaddleMangaOcr(makeOutput(1).data, [1, 5, 4], ['あ', 'い', ' '])).toEqual([
      { text: 'あい', confidence: expect.closeTo(90) },
    ]);
  });

  it('rejects malformed output dimensions', () => {
    expect(() => decodePaddleMangaOcr(new Float32Array(3), [1, 2], ['あ'])).toThrow('output');
  });
});

describe('rotateRgbaCounterclockwise', () => {
  it('rotates vertical text into left-to-right model input', () => {
    const source = new Uint8ClampedArray([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
    ]);

    const rotated = rotateRgbaCounterclockwise({ data: source, width: 2, height: 3 });

    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(2);
    expect(Array.from(rotated.data.filter((_, index) => index % 4 === 0))).toEqual([
      2, 4, 6, 1, 3, 5,
    ]);
  });
});

describe('PaddleMangaOcrEngine', () => {
  it('loads lazily, reuses one model session, and returns detector geometry', async () => {
    const harness = makeHarness();

    const first = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });
    const second = await harness.engine.recognize(harness.source, {
      pageIndex: 8,
      width: 80,
      height: 120,
    });

    expect(first).toEqual({
      pageIndex: 7,
      width: 80,
      height: 120,
      blocks: [
        {
          id: 'bubble-0',
          text: 'あい',
          confidence: expect.closeTo(90),
          box: box(15, 20, 55, 80),
          bubbleBox: box(5, 5, 75, 110),
          maskBoxes: [box(15, 20, 55, 80)],
          backgroundColor: 'rgb(255 255 255)',
          writingMode: 'horizontal-tb',
        },
      ],
    });
    expect(second.pageIndex).toBe(8);
    expect(harness.loadModel).toHaveBeenCalledOnce();
    expect(harness.loadDictionary).toHaveBeenCalledOnce();
    expect(harness.createSession).toHaveBeenCalledOnce();
    expect(harness.run).toHaveBeenCalledTimes(2);
    const input = harness.run.mock.calls[0]![0]['x'] as {
      data: Float32Array;
      dims: number[];
    };
    expect(input.dims).toEqual([3, 3, 48, 320]);
    expect(input.data.includes(-1)).toBe(true);
    expect(input.data.some((value) => value > 0)).toBe(true);

    await harness.engine.terminate();
    await harness.engine.terminate();
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.detector.terminate).toHaveBeenCalledOnce();
    await expect(
      harness.engine.recognize(harness.source, { pageIndex: 9, width: 80, height: 120 }),
    ).rejects.toThrow('terminated');
  });

  it('skips the whole bubble when any detected text part is unreadable', async () => {
    const harness = makeHarness();
    harness.detector.detect.mockResolvedValueOnce([
      {
        id: 'bubble-0',
        score: 0.9,
        bubbleBox: box(0, 0, 80, 120),
        textBoxes: [box(5, 5, 35, 55), box(45, 60, 75, 110)],
        writingMode: 'horizontal-tb',
      },
    ]);
    harness.run
      .mockImplementationOnce(async (feeds: Record<string, unknown>) => {
        const batch = (feeds['x'] as { dims: number[] }).dims[0]!;
        return { fetch_name_0: makeOutput(batch) };
      })
      .mockImplementationOnce(async (feeds: Record<string, unknown>) => {
        const batch = (feeds['x'] as { dims: number[] }).dims[0]!;
        return { fetch_name_0: makeOutput(batch, [0, 0, 0], 0.9) };
      });

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });

    expect(page.blocks).toEqual([]);
    await harness.engine.terminate();
  });

  it('keeps a readable column when a much narrower punctuation column is unreadable', async () => {
    const harness = makeHarness();
    harness.pixels.fill(255);
    for (const [left, right] of [
      [15, 20],
      [45, 60],
    ] as const) {
      for (let y = 20; y < 90; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * 80 + x) * 4;
          harness.pixels.fill(0, offset, offset + 3);
          harness.pixels[offset + 3] = 255;
        }
      }
    }
    harness.detector.detect.mockResolvedValueOnce([
      {
        id: 'bubble-0',
        score: 0.9,
        bubbleBox: box(5, 5, 75, 115),
        textBoxes: [box(10, 10, 70, 100)],
        writingMode: 'vertical-rl',
      },
    ]);
    harness.run
      .mockImplementationOnce(async (feeds: Record<string, unknown>) => {
        const batch = (feeds['x'] as { dims: number[] }).dims[0]!;
        return { fetch_name_0: makeOutput(batch) };
      })
      .mockImplementationOnce(async (feeds: Record<string, unknown>) => {
        const batch = (feeds['x'] as { dims: number[] }).dims[0]!;
        return { fetch_name_0: makeOutput(batch, [0, 0, 0], 0.9) };
      });

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(page.blocks[0]?.text).toBe('あい');
    await harness.engine.terminate();
  });

  it('prefers a longer recognition view when its confidence is close', async () => {
    const harness = makeHarness();
    harness.run.mockImplementationOnce(async () => ({
      fetch_name_0: makeViewOutput([
        { indices: [1, 0, 2, 0, 1], confidence: 0.2 },
        { indices: [1, 0, 2, 0, 0], confidence: 0.9 },
        { indices: [1, 0, 0, 0, 0], confidence: 0.94 },
      ]),
    }));

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });

    expect(page.blocks[0]).toMatchObject({ text: 'あい', confidence: expect.closeTo(90) });
    await harness.engine.terminate();
  });

  it('recognizes horizontal dialogue one line at a time in reading order', async () => {
    const harness = makeHarness();
    harness.pixels.fill(255);
    for (const top of [20, 65]) {
      for (let y = top; y < top + 12; y += 1) {
        for (let x = 15; x < 60; x += 1) {
          const offset = (y * 80 + x) * 4;
          harness.pixels.fill(0, offset, offset + 3);
          harness.pixels[offset + 3] = 255;
        }
      }
    }
    harness.detector.detect.mockResolvedValueOnce([
      {
        id: 'bubble-0',
        score: 0.9,
        bubbleBox: box(5, 5, 75, 110),
        textBoxes: [box(10, 10, 70, 100)],
        writingMode: 'horizontal-tb',
      },
    ]);

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(page.blocks[0]?.text).toBe('あい\nあい');
    await harness.engine.terminate();
  });

  it('splits framed vertical narration without treating the border as text', async () => {
    const harness = makeHarness();
    harness.pixels.fill(255);
    for (let y = 5; y < 115; y += 1) {
      for (let x = 5; x < 75; x += 1) {
        const border = y < 15 || y >= 105;
        const column = y >= 25 && y < 95 && ((x >= 15 && x < 22) || (x >= 35 && x < 42));
        if (!border && !column) continue;
        const offset = (y * 80 + x) * 4;
        harness.pixels.fill(0, offset, offset + 3);
        harness.pixels[offset + 3] = 255;
      }
    }
    harness.detector.detect.mockResolvedValueOnce([
      {
        id: 'caption-0',
        score: 0.41,
        bubbleBox: box(2, 2, 78, 118),
        textBoxes: [box(5, 5, 75, 115)],
        writingMode: 'vertical-rl',
      },
    ]);

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(page.blocks[0]?.text).toBe('あい\nあい');
    await harness.engine.terminate();
  });

  it('keeps tightly spaced narration columns separate', async () => {
    const harness = makeHarness(200, 160);
    harness.pixels.fill(255);
    for (let y = 10; y < 150; y += 1) {
      for (let x = 10; x < 190; x += 1) {
        const border = y < 24 || y >= 136;
        const column = y >= 35 && y < 125 && ((x >= 40 && x < 60) || (x >= 70 && x < 90));
        if (!border && !column) continue;
        const offset = (y * 200 + x) * 4;
        harness.pixels.fill(0, offset, offset + 3);
        harness.pixels[offset + 3] = 255;
      }
    }
    harness.detector.detect.mockResolvedValueOnce([
      {
        id: 'caption-0',
        score: 0.41,
        bubbleBox: box(5, 5, 195, 155),
        textBoxes: [box(10, 10, 190, 150)],
        writingMode: 'vertical-rl',
      },
    ]);

    const page = await harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 200,
      height: 160,
    });

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(page.blocks[0]?.text).toBe('あい\nあい');
    await harness.engine.terminate();
  });

  it('waits for active inference before releasing the model session', async () => {
    const harness = makeHarness();
    let finishRun!: (output: { fetch_name_0: ReturnType<typeof makeOutput> }) => void;
    harness.run.mockImplementationOnce(() => new Promise((resolve) => (finishRun = resolve)));

    const recognizing = harness.engine.recognize(harness.source, {
      pageIndex: 7,
      width: 80,
      height: 120,
    });
    await vi.waitFor(() => expect(harness.run).toHaveBeenCalledOnce());

    const terminating = harness.engine.terminate();
    await Promise.resolve();
    expect(harness.release).not.toHaveBeenCalled();

    finishRun({ fetch_name_0: makeOutput(2) });
    await expect(recognizing).rejects.toThrow('terminated');
    await terminating;
    expect(harness.release).toHaveBeenCalledOnce();
  });
});
