import { describe, expect, it, vi } from 'vitest';

import {
  decodeMokuroBlockPredictions,
  extractMokuroLinePolygons,
  groupMokuroText,
  MOKURO_TEXT_DETECTOR_INPUT_SIZE,
  MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES,
  MOKURO_TEXT_DETECTOR_MODEL_ASSET,
  MOKURO_TEXT_DETECTOR_MODEL_SHA256,
  MOKURO_TEXT_DETECTOR_MODEL_URL,
  MokuroTextDetector,
  postprocessMokuroDetectorOutputs,
  type MokuroDetectorTensor,
  type MokuroMask,
  type MokuroTextBlock,
} from '@/app/reader/services/manga/mokuroTextDetector';

const PAGE = { width: 1024, height: 1024 };
const MASK_SIZE = MOKURO_TEXT_DETECTOR_INPUT_SIZE ** 2;

const box = (xMin: number, yMin: number, xMax: number, yMax: number) => ({
  xMin,
  yMin,
  xMax,
  yMax,
});

const tensor = (dims: readonly number[], data?: Float32Array): MokuroDetectorTensor => ({
  dims,
  data: data ?? new Float32Array(dims.reduce((product, dimension) => product * dimension, 1)),
});

const detectorOutputs = (): {
  blk: MokuroDetectorTensor;
  seg: MokuroDetectorTensor;
  det: MokuroDetectorTensor;
} => ({
  blk: tensor([1, 64_512, 7]),
  seg: tensor([1, 1, 1024, 1024]),
  det: tensor([1, 2, 1024, 1024]),
});

const fillRectangle = (
  data: Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
  value: number,
  channelOffset = 0,
): void => {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      data[channelOffset + y * MOKURO_TEXT_DETECTOR_INPUT_SIZE + x] = value;
    }
  }
};

describe('Mokuro detector asset and postprocessing', () => {
  it('pins the verified comictextdetector ONNX artifact', () => {
    expect(MOKURO_TEXT_DETECTOR_MODEL_URL).toBe(
      'https://huggingface.co/mayocream/koharu/resolve/15439cba09df388c51de6e47c6020bc31edab41f/comictextdetector.onnx',
    );
    expect(MOKURO_TEXT_DETECTOR_MODEL_SHA256).toBe(
      '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f',
    );
    expect(MOKURO_TEXT_DETECTOR_MODEL_ASSET).toMatchObject({
      url: MOKURO_TEXT_DETECTOR_MODEL_URL,
      sha256: MOKURO_TEXT_DETECTOR_MODEL_SHA256,
      maximumDownloadBytes: MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES,
      maximumResultBytes: MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES,
    });
    expect(MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES).toBeGreaterThanOrEqual(94_669_756);
  });

  it('decodes YOLO block rows, maps them through the letterbox, and applies class-aware NMS', () => {
    const data = new Float32Array(64_512 * 7);
    data.set([512, 512, 200, 100, 0.9, 0.1, 0.9], 0);
    data.set([512, 512, 200, 100, 0.8, 0.1, 0.8], 7);
    data.set([100, 100, 40, 40, 0.9, 0.9, 0.1], 14);

    const blocks = decodeMokuroBlockPredictions(data, PAGE);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      language: 'ja',
      score: expect.closeTo(0.81),
      box: box(412, 462, 612, 562),
    });
    expect(blocks[1]).toMatchObject({ language: 'eng', box: box(80, 80, 120, 120) });
  });

  it('extracts an oriented line polygon from the first det channel', () => {
    const data = new Float32Array(MASK_SIZE * 2);
    fillRectangle(data, 300, 450, 500, 482, 0.9);

    const lines = extractMokuroLinePolygons(data, PAGE);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.vertical).toBe(false);
    expect(lines[0]?.polygon).toHaveLength(4);
    expect(lines[0]?.box.xMin).toBeLessThan(300);
    expect(lines[0]?.box.xMax).toBeGreaterThan(500);
    expect(lines[0]?.box.yMin).toBeLessThan(450);
    expect(lines[0]?.box.yMax).toBeGreaterThan(482);
  });

  it('drops weak line-map fragments before grouping', () => {
    const data = new Float32Array(MASK_SIZE * 2);
    fillRectangle(data, 100, 100, 160, 140, 0.4);
    fillRectangle(data, 300, 300, 380, 350, 0.9);

    const lines = extractMokuroLinePolygons(data, PAGE);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.box.xMin).toBeGreaterThan(250);
  });

  it('orders vertical polygons from top-left clockwise for perspective crops', () => {
    const data = new Float32Array(MASK_SIZE * 2);
    fillRectangle(data, 300, 400, 332, 620, 0.9);

    const [detected] = extractMokuroLinePolygons(data, PAGE);

    expect(detected?.vertical).toBe(true);
    const [topLeft, topRight, bottomRight, bottomLeft] = detected!.polygon;
    expect(topLeft!.x).toBeLessThan(topRight!.x);
    expect(topLeft!.y).toBeLessThan(bottomLeft!.y);
    expect(topRight!.y).toBeLessThan(bottomRight!.y);
    expect(bottomLeft!.x).toBeLessThan(bottomRight!.x);
  });

  it('keeps vertical Japanese lines and blocks in right-to-left reading order', () => {
    const rawMask: MokuroMask = { width: 100, height: 100, data: new Uint8Array(10_000).fill(255) };
    const blocks: MokuroTextBlock[] = [
      { box: box(10, 10, 30, 70), score: 0.9, language: 'ja', vertical: false, lines: [] },
      { box: box(70, 10, 90, 70), score: 0.8, language: 'ja', vertical: false, lines: [] },
    ];

    const grouped = groupMokuroText(blocks, [], rawMask, rawMask);

    expect(grouped.map((block) => block.box.xMin)).toEqual([70, 10]);
    expect(grouped.every((block) => block.vertical)).toBe(true);
  });

  it('groups detector outputs without retaining page masks', () => {
    const outputs = detectorOutputs();
    (outputs.blk.data as Float32Array).set([512, 400, 240, 120, 0.95, 0.05, 0.95], 0);
    fillRectangle(outputs.seg.data as Float32Array, 392, 340, 632, 460, 0.9);
    fillRectangle(outputs.det.data as Float32Array, 420, 360, 600, 420, 0.9);

    const result = postprocessMokuroDetectorOutputs(outputs, PAGE);

    expect(result.page).toEqual(PAGE);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.language).toBe('ja');
    expect(result.blocks[0]?.lines).not.toHaveLength(0);
  });
});

describe('MokuroTextDetector', () => {
  it('uses the fixed input contract, loads lazily, reuses the session, and releases it', async () => {
    const pixels = new Uint8ClampedArray(MASK_SIZE * 4);
    pixels.set([255, 128, 0, 255]);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: pixels }));
    const createCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, getImageData }),
    }));
    class Tensor {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    }
    let feeds: Record<string, unknown> | undefined;
    const run = vi.fn(async (nextFeeds: Record<string, unknown>) => {
      feeds = nextFeeds;
      return detectorOutputs();
    });
    const release = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({ run, release }));
    const runtime = {
      env: { wasm: {} },
      Tensor,
      InferenceSession: { create: createSession },
    };
    const loadRuntime = vi.fn(async () => runtime);
    const loadModel = vi.fn(async () => new ArrayBuffer(8));
    const detector = new MokuroTextDetector({}, { createCanvas, loadRuntime, loadModel });
    const source = {} as CanvasImageSource;

    await detector.detect(source, PAGE);
    await detector.detect(source, PAGE);

    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(loadModel).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(runtime.env.wasm).toMatchObject({
      numThreads: 1,
      proxy: true,
      wasmPaths: '/vendor/onnxruntime/',
    });
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1024, 1024);
    const firstInput = feeds as { images: Tensor };
    expect(firstInput.images.type).toBe('float32');
    expect(firstInput.images.dims).toEqual([1, 3, 1024, 1024]);
    expect(firstInput.images.data[0]).toBe(1);
    expect(firstInput.images.data[MASK_SIZE]).toBeCloseTo(128 / 255);

    await detector.terminate();
    expect(release).toHaveBeenCalledOnce();
    await detector.terminate();
    await expect(detector.detect(source, PAGE)).rejects.toThrow('terminated');
  });

  it('rejects an output that does not match the pinned tensor contract', async () => {
    const pixels = new Uint8ClampedArray(MASK_SIZE * 4);
    const runtime = {
      env: { wasm: {} },
      Tensor: class {
        constructor(
          public type: string,
          public data: Float32Array,
          public dims: number[],
        ) {}
      },
      InferenceSession: {
        create: async () => ({
          run: async () => ({
            blk: tensor([1, 4, 7], new Float32Array(28)),
            seg: tensor([1, 1, 1024, 1024]),
            det: tensor([1, 2, 1024, 1024]),
          }),
          release: async () => undefined,
        }),
      },
    };
    const detector = new MokuroTextDetector(
      {},
      {
        createCanvas: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => undefined,
            getImageData: () => ({ data: pixels }),
          }),
        }),
        loadRuntime: async () => runtime,
        loadModel: async () => new ArrayBuffer(8),
      },
    );

    await expect(detector.detect({} as CanvasImageSource, PAGE)).rejects.toThrow(
      'invalid dimensions',
    );
    await detector.terminate();
  });
});
