import type { OcrBoundingBox, OcrWritingMode } from '@/app/reader/services/ocr/types';
import {
  fetchVerifiedModelAsset,
  type ModelDownloadProgress,
} from '@/app/reader/services/manga/modelAssets';

const DETECTOR_SIZE = 640;
const MAXIMUM_DETECTIONS = 1_000;
const DEFAULT_CONFIDENCE = 0.45;
const DUPLICATE_IOU = 0.85;
const MODEL_URL =
  'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/16e8a622f91fabc6b5b65c96d32d1183f8843546/detector-v4-s_int8.onnx';
const MODEL_SHA256 = '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79';
const MAXIMUM_MODEL_BYTES = 12_000_000;

export type MangaDetectionLabel = 'bubble' | 'text-bubble' | 'text-free';

export interface MangaDetection {
  label: MangaDetectionLabel;
  score: number;
  box: OcrBoundingBox;
}

export interface MangaBubbleRegion {
  id: string;
  score: number;
  bubbleBox: OcrBoundingBox;
  textBoxes: readonly OcrBoundingBox[];
  writingMode: OcrWritingMode;
}

interface PageDimensions {
  width: number;
  height: number;
}

interface DetectorTensor {
  data: ArrayLike<number | bigint>;
}

interface DetectorSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, DetectorTensor>>;
  release: () => Promise<void>;
}

interface DetectorRuntime {
  env: {
    wasm: {
      numThreads?: number;
      wasmPaths?: string;
    };
  };
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dimensions: number[],
  ) => unknown;
  InferenceSession: {
    create: (
      model: ArrayBuffer,
      options: {
        executionProviders: ['wasm'];
        executionMode: 'sequential';
        graphOptimizationLevel: 'all';
      },
    ) => Promise<DetectorSession>;
  };
}

interface DetectorCanvasContext {
  drawImage: (
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  getImageData: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => { data: Uint8ClampedArray };
}

interface DetectorCanvas {
  width: number;
  height: number;
  getContext: (
    type: '2d',
    options?: { willReadFrequently?: boolean },
  ) => DetectorCanvasContext | null;
}

interface MangaDetectorOptions {
  minimumConfidence?: number;
  onDownloadProgress?: (progress: ModelDownloadProgress) => void;
}

interface MangaDetectorDependencies {
  createCanvas: () => DetectorCanvas;
  loadRuntime: () => Promise<DetectorRuntime>;
  loadModel: (
    signal?: AbortSignal,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ) => Promise<ArrayBuffer>;
}

const defaultCreateCanvas = (): DetectorCanvas => document.createElement('canvas');

const defaultLoadRuntime = async (): Promise<DetectorRuntime> =>
  (await import('onnxruntime-web/wasm')) as unknown as DetectorRuntime;

const defaultLoadModel = (
  signal?: AbortSignal,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<ArrayBuffer> =>
  fetchVerifiedModelAsset({
    url: MODEL_URL,
    sha256: MODEL_SHA256,
    maximumDownloadBytes: MAXIMUM_MODEL_BYTES,
    maximumResultBytes: MAXIMUM_MODEL_BYTES,
    signal,
    onProgress,
  });

const LABELS: Readonly<Record<number, MangaDetectionLabel>> = {
  0: 'bubble',
  1: 'text-bubble',
  2: 'text-free',
};

const clamp = (value: number, maximum: number): number => Math.min(maximum, Math.max(0, value));

const normalizeBox = (values: readonly number[], page: PageDimensions): OcrBoundingBox | null => {
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const box = {
    xMin: clamp(values[0]!, page.width),
    yMin: clamp(values[1]!, page.height),
    xMax: clamp(values[2]!, page.width),
    yMax: clamp(values[3]!, page.height),
  };
  return box.xMax > box.xMin && box.yMax > box.yMin ? box : null;
};

const area = (box: OcrBoundingBox): number => (box.xMax - box.xMin) * (box.yMax - box.yMin);

const intersectionArea = (left: OcrBoundingBox, right: OcrBoundingBox): number =>
  Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin)) *
  Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));

const intersectionOverUnion = (left: OcrBoundingBox, right: OcrBoundingBox): number => {
  const intersection = intersectionArea(left, right);
  return intersection / (area(left) + area(right) - intersection);
};

export const parseMangaDetections = (
  labels: ArrayLike<number | bigint>,
  boxes: ArrayLike<number>,
  scores: ArrayLike<number>,
  page: PageDimensions,
  minimumConfidence = DEFAULT_CONFIDENCE,
): MangaDetection[] => {
  const count = Math.min(
    labels.length,
    scores.length,
    Math.floor(boxes.length / 4),
    MAXIMUM_DETECTIONS,
  );
  const candidates: MangaDetection[] = [];
  for (let index = 0; index < count; index += 1) {
    const score = Number(scores[index]);
    const label = LABELS[Number(labels[index])];
    if (!label || !Number.isFinite(score) || score < minimumConfidence) continue;
    const offset = index * 4;
    const box = normalizeBox(
      [
        Number(boxes[offset]),
        Number(boxes[offset + 1]),
        Number(boxes[offset + 2]),
        Number(boxes[offset + 3]),
      ],
      page,
    );
    if (box) candidates.push({ label, score, box });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates.filter(
    (candidate, index) =>
      !candidates
        .slice(0, index)
        .some(
          (accepted) =>
            accepted.label === candidate.label &&
            intersectionOverUnion(accepted.box, candidate.box) >= DUPLICATE_IOU,
        ),
  );
};

const centerInside = (inner: OcrBoundingBox, outer: OcrBoundingBox): boolean => {
  const x = (inner.xMin + inner.xMax) / 2;
  const y = (inner.yMin + inner.yMax) / 2;
  return x >= outer.xMin && x <= outer.xMax && y >= outer.yMin && y <= outer.yMax;
};

const unionBoxes = (boxes: readonly OcrBoundingBox[]): OcrBoundingBox => ({
  xMin: Math.min(...boxes.map((box) => box.xMin)),
  yMin: Math.min(...boxes.map((box) => box.yMin)),
  xMax: Math.max(...boxes.map((box) => box.xMax)),
  yMax: Math.max(...boxes.map((box) => box.yMax)),
});

const sortTextBoxes = (
  boxes: readonly OcrBoundingBox[],
  writingMode: OcrWritingMode,
): OcrBoundingBox[] =>
  [...boxes].sort((left, right) =>
    writingMode === 'vertical-rl'
      ? right.xMin - left.xMin || left.yMin - right.yMin
      : left.yMin - right.yMin || left.xMin - right.xMin,
  );

export const associateMangaBubbles = (
  detections: readonly MangaDetection[],
): MangaBubbleRegion[] => {
  const bubbles = detections.filter((detection) => detection.label === 'bubble');
  const groups = new Map<MangaDetection, OcrBoundingBox[]>();
  for (const text of detections.filter((detection) => detection.label === 'text-bubble')) {
    const candidates = bubbles
      .map((bubble) => ({
        bubble,
        containsCenter: centerInside(text.box, bubble.box),
        overlap: intersectionArea(text.box, bubble.box) / area(text.box),
      }))
      .filter(({ containsCenter, overlap }) => containsCenter || overlap >= 0.5)
      .sort(
        (left, right) =>
          Number(right.containsCenter) - Number(left.containsCenter) ||
          right.overlap - left.overlap ||
          area(left.bubble.box) - area(right.bubble.box),
      );
    const bubble = candidates[0]?.bubble;
    if (!bubble) continue;
    groups.set(bubble, [...(groups.get(bubble) ?? []), text.box]);
  }

  const regions: MangaBubbleRegion[] = [];
  for (const bubble of bubbles) {
    const textBoxes = groups.get(bubble);
    if (!textBoxes?.length) continue;
    const textBox = unionBoxes(textBoxes);
    const writingMode =
      textBox.yMax - textBox.yMin >= (textBox.xMax - textBox.xMin) * 1.05
        ? 'vertical-rl'
        : 'horizontal-tb';
    regions.push({
      id: `manga-bubble-${regions.length}`,
      score: bubble.score,
      bubbleBox: bubble.box,
      textBoxes: sortTextBoxes(textBoxes, writingMode),
      writingMode,
    });
  }
  return regions;
};

const validatePage = (page: PageDimensions): void => {
  if (
    !Number.isSafeInteger(page.width) ||
    !Number.isSafeInteger(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  ) {
    throw new Error('Manga detector requires positive integer page dimensions');
  }
};

const makeImageTensor = (pixels: Uint8ClampedArray): Float32Array => {
  const pixelCount = DETECTOR_SIZE * DETECTOR_SIZE;
  if (pixels.length !== pixelCount * 4) {
    throw new Error('Manga detector received incomplete image pixels');
  }
  const values = new Float32Array(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = pixels[rgba]! / 255;
    values[pixelCount + pixel] = pixels[rgba + 1]! / 255;
    values[pixelCount * 2 + pixel] = pixels[rgba + 2]! / 255;
  }
  return values;
};

export class MangaDetector {
  readonly #minimumConfidence: number;
  readonly #onDownloadProgress?: (progress: ModelDownloadProgress) => void;
  readonly #createCanvas: () => DetectorCanvas;
  readonly #loadRuntime: () => Promise<DetectorRuntime>;
  readonly #loadModel: MangaDetectorDependencies['loadModel'];
  readonly #abortController = new AbortController();
  #runtimePromise: Promise<DetectorRuntime> | null = null;
  #sessionPromise: Promise<DetectorSession> | null = null;
  #terminated = false;

  constructor(
    options: MangaDetectorOptions = {},
    dependencies: Partial<MangaDetectorDependencies> = {},
  ) {
    this.#minimumConfidence = options.minimumConfidence ?? DEFAULT_CONFIDENCE;
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#createCanvas = dependencies.createCanvas ?? defaultCreateCanvas;
    this.#loadRuntime = dependencies.loadRuntime ?? defaultLoadRuntime;
    this.#loadModel = dependencies.loadModel ?? defaultLoadModel;
  }

  async detect(source: CanvasImageSource, page: PageDimensions): Promise<MangaBubbleRegion[]> {
    validatePage(page);
    if (this.#terminated) throw new Error('Manga detector has been terminated');

    const canvas = this.#createCanvas();
    canvas.width = DETECTOR_SIZE;
    canvas.height = DETECTOR_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Manga detector could not create a canvas context');
    context.drawImage(source, 0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
    const pixels = context.getImageData(0, 0, DETECTOR_SIZE, DETECTOR_SIZE).data;
    const runtime = await this.#getRuntime();
    const session = await this.#getSession(runtime);
    if (this.#terminated) throw new Error('Manga detector has been terminated');

    const outputs = await session.run({
      images: new runtime.Tensor('float32', makeImageTensor(pixels), [
        1,
        3,
        DETECTOR_SIZE,
        DETECTOR_SIZE,
      ]),
      orig_target_sizes: new runtime.Tensor(
        'int64',
        new BigInt64Array([BigInt(page.width), BigInt(page.height)]),
        [1, 2],
      ),
    });
    if (this.#terminated) throw new Error('Manga detector has been terminated');
    const labels = outputs['labels']?.data;
    const boxes = outputs['boxes']?.data;
    const scores = outputs['scores']?.data;
    if (!labels || !boxes || !scores) throw new Error('Manga detector returned incomplete output');

    return associateMangaBubbles(
      parseMangaDetections(
        labels,
        boxes as ArrayLike<number>,
        scores as ArrayLike<number>,
        page,
        this.#minimumConfidence,
      ),
    );
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController.abort();
    const sessionPromise = this.#sessionPromise;
    this.#sessionPromise = null;
    if (!sessionPromise) return;
    try {
      const session = await sessionPromise;
      await session.release();
    } catch {
      return;
    }
  }

  #getSession(runtime: DetectorRuntime): Promise<DetectorSession> {
    if (this.#terminated) return Promise.reject(new Error('Manga detector has been terminated'));
    if (this.#sessionPromise) return this.#sessionPromise;

    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.wasmPaths = '/vendor/onnxruntime/';
    const sessionPromise = this.#loadModel(
      this.#abortController.signal,
      this.#onDownloadProgress,
    ).then(async (model) => {
      const session = await runtime.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
      });
      if (this.#terminated) {
        await session.release();
        throw new Error('Manga detector has been terminated');
      }
      return session;
    });
    this.#sessionPromise = sessionPromise;
    void sessionPromise.catch(() => {
      if (this.#sessionPromise === sessionPromise && !this.#terminated) {
        this.#sessionPromise = null;
      }
    });
    return sessionPromise;
  }

  #getRuntime(): Promise<DetectorRuntime> {
    if (this.#runtimePromise) return this.#runtimePromise;
    const runtimePromise = this.#loadRuntime();
    this.#runtimePromise = runtimePromise;
    void runtimePromise.catch(() => {
      if (this.#runtimePromise === runtimePromise && !this.#terminated) {
        this.#runtimePromise = null;
      }
    });
    return runtimePromise;
  }
}
