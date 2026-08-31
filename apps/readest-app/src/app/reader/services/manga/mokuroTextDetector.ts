import type { OcrBoundingBox } from '@/app/reader/services/ocr/types';
import {
  fetchVerifiedModelAsset,
  type ModelDownloadProgress,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';

export const MOKURO_TEXT_DETECTOR_INPUT_SIZE = 1024;
export const MOKURO_TEXT_DETECTOR_MODEL_BYTES = 94_669_756;
export const MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES = 95_000_000;
export const MOKURO_TEXT_DETECTOR_MODEL_URL =
  'https://huggingface.co/mayocream/koharu/resolve/15439cba09df388c51de6e47c6020bc31edab41f/comictextdetector.onnx';
export const MOKURO_TEXT_DETECTOR_MODEL_SHA256 =
  '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f';

type StaticModelAsset = Omit<VerifiedModelAsset, 'onProgress' | 'signal'>;

export const MOKURO_TEXT_DETECTOR_MODEL_ASSET: Readonly<StaticModelAsset> = {
  url: MOKURO_TEXT_DETECTOR_MODEL_URL,
  sha256: MOKURO_TEXT_DETECTOR_MODEL_SHA256,
  maximumDownloadBytes: MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES,
  maximumResultBytes: MOKURO_TEXT_DETECTOR_MAXIMUM_MODEL_BYTES,
};

export const MOKURO_TEXT_DETECTOR_OUTPUT_SHAPES = {
  blk: [1, 64_512, 7],
  seg: [1, 1, MOKURO_TEXT_DETECTOR_INPUT_SIZE, MOKURO_TEXT_DETECTOR_INPUT_SIZE],
  det: [1, 2, MOKURO_TEXT_DETECTOR_INPUT_SIZE, MOKURO_TEXT_DETECTOR_INPUT_SIZE],
} as const;

export type MokuroTextLanguage = 'eng' | 'ja' | 'unknown';

export interface MokuroPageSize {
  width: number;
  height: number;
}

export interface MokuroPoint {
  x: number;
  y: number;
}

/** A page-sized grayscale mask. Values are 0..255. */
export interface MokuroMask extends MokuroPageSize {
  data: Uint8Array;
}

export interface MokuroTextLine {
  polygon: readonly MokuroPoint[];
  box: OcrBoundingBox;
  score: number;
  vertical: boolean;
}

export interface MokuroTextBlock {
  box: OcrBoundingBox;
  score: number;
  language: MokuroTextLanguage;
  vertical: boolean;
  lines: readonly MokuroTextLine[];
}

export interface MokuroTextDetectionResult {
  page: MokuroPageSize;
  blocks: readonly MokuroTextBlock[];
  rawMask: MokuroMask;
  refinedMask: MokuroMask;
}

export interface MokuroDetectorTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}

export interface MokuroDetectorOutputs {
  blk: MokuroDetectorTensor;
  seg: MokuroDetectorTensor;
  det: MokuroDetectorTensor;
}

export interface MokuroTextDetectorRuntime {
  env: {
    wasm: {
      numThreads?: number;
      proxy?: boolean;
      wasmPaths?: string;
    };
  };
  Tensor: new (type: 'float32', data: Float32Array, dimensions: number[]) => unknown;
  InferenceSession: {
    create: (
      model: ArrayBuffer,
      options: {
        executionProviders: ['wasm'];
        executionMode: 'sequential';
        graphOptimizationLevel: 'all';
      },
    ) => Promise<MokuroDetectorSession>;
  };
}

export interface MokuroDetectorSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, MokuroDetectorTensor>>;
  release: () => Promise<void>;
}

export interface MokuroDetectorCanvasContext {
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

export interface MokuroDetectorCanvas {
  width: number;
  height: number;
  getContext: (
    type: '2d',
    options?: { willReadFrequently?: boolean },
  ) => MokuroDetectorCanvasContext | null;
}

export interface MokuroTextDetectorOptions {
  blockConfidence?: number;
  blockIouThreshold?: number;
  lineConfidence?: number;
  lineThreshold?: number;
  maskThreshold?: number;
  maximumBlocks?: number;
  maximumLines?: number;
  onDownloadProgress?: (progress: ModelDownloadProgress) => void;
}

export interface MokuroTextDetectorDependencies {
  createCanvas: () => MokuroDetectorCanvas;
  loadRuntime: () => Promise<MokuroTextDetectorRuntime>;
  loadModel: (
    signal?: AbortSignal,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ) => Promise<ArrayBuffer>;
}

interface LetterboxTransform {
  width: number;
  height: number;
}

interface BlockCandidate extends MokuroTextBlock {
  lines: MokuroTextLine[];
}

interface LineComponent {
  pixels: readonly number[];
  count: number;
  score: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
}

const DEFAULT_BLOCK_CONFIDENCE = 0.4;
const DEFAULT_BLOCK_IOU_THRESHOLD = 0.35;
const DEFAULT_LINE_CONFIDENCE = 0.5;
const DEFAULT_LINE_THRESHOLD = 0.3;
const DEFAULT_MASK_THRESHOLD = 0.3;
const DEFAULT_MAXIMUM_BLOCKS = 300;
const DEFAULT_MAXIMUM_LINES = 1_000;
const MASK_CHANNEL_SIZE = MOKURO_TEXT_DETECTOR_INPUT_SIZE * MOKURO_TEXT_DETECTOR_INPUT_SIZE;

const defaultCreateCanvas = (): MokuroDetectorCanvas => document.createElement('canvas');

const defaultLoadRuntime = async (): Promise<MokuroTextDetectorRuntime> =>
  (await import('onnxruntime-web/wasm')) as unknown as MokuroTextDetectorRuntime;

const defaultLoadModel: MokuroTextDetectorDependencies['loadModel'] = (signal, onProgress) =>
  fetchVerifiedModelAsset({
    ...MOKURO_TEXT_DETECTOR_MODEL_ASSET,
    signal,
    onProgress,
  });

const validatePositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Mokuro text detector requires a positive integer ${name}`);
  }
};

const validatePage = (page: MokuroPageSize): void => {
  validatePositiveInteger('page width', page.width);
  validatePositiveInteger('page height', page.height);
  if (!Number.isSafeInteger(page.width * page.height)) {
    throw new Error('Mokuro text detector page is too large');
  }
};

const validateOption = (name: string, value: number, minimum: number, maximum: number): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Mokuro text detector ${name} is outside its supported range`);
  }
};

const resolveOptions = (options: MokuroTextDetectorOptions = {}) => {
  const resolved = {
    blockConfidence: options.blockConfidence ?? DEFAULT_BLOCK_CONFIDENCE,
    blockIouThreshold: options.blockIouThreshold ?? DEFAULT_BLOCK_IOU_THRESHOLD,
    lineConfidence: options.lineConfidence ?? DEFAULT_LINE_CONFIDENCE,
    lineThreshold: options.lineThreshold ?? DEFAULT_LINE_THRESHOLD,
    maskThreshold: options.maskThreshold ?? DEFAULT_MASK_THRESHOLD,
    maximumBlocks: options.maximumBlocks ?? DEFAULT_MAXIMUM_BLOCKS,
    maximumLines: options.maximumLines ?? DEFAULT_MAXIMUM_LINES,
  };
  validateOption('block confidence', resolved.blockConfidence, 0, 1);
  validateOption('block IoU threshold', resolved.blockIouThreshold, 0, 1);
  validateOption('line confidence', resolved.lineConfidence, 0, 1);
  validateOption('line threshold', resolved.lineThreshold, 0, 1);
  validateOption('mask threshold', resolved.maskThreshold, 0, 1);
  validatePositiveInteger('maximum blocks', resolved.maximumBlocks);
  validatePositiveInteger('maximum lines', resolved.maximumLines);
  return resolved;
};

const assertTensorShape = (
  name: keyof typeof MOKURO_TEXT_DETECTOR_OUTPUT_SHAPES,
  tensor: MokuroDetectorTensor,
): void => {
  const expected = MOKURO_TEXT_DETECTOR_OUTPUT_SHAPES[name];
  if (
    tensor.dims.length !== expected.length ||
    expected.some((dimension, index) => tensor.dims[index] !== dimension)
  ) {
    throw new Error(
      `Mokuro text detector output ${name} has invalid dimensions; expected [${expected.join(', ')}]`,
    );
  }
  let expectedLength = 1;
  for (const dimension of expected) expectedLength *= dimension;
  if (tensor.data.length !== expectedLength) {
    throw new Error(`Mokuro text detector output ${name} has incomplete data`);
  }
};

const assertOutputs = (outputs: MokuroDetectorOutputs): void => {
  assertTensorShape('blk', outputs.blk);
  assertTensorShape('seg', outputs.seg);
  assertTensorShape('det', outputs.det);
};

const getLetterboxTransform = (page: MokuroPageSize): LetterboxTransform => {
  const scale = Math.min(
    MOKURO_TEXT_DETECTOR_INPUT_SIZE / page.width,
    MOKURO_TEXT_DETECTOR_INPUT_SIZE / page.height,
  );
  return {
    width: Math.max(1, Math.min(MOKURO_TEXT_DETECTOR_INPUT_SIZE, Math.round(page.width * scale))),
    height: Math.max(1, Math.min(MOKURO_TEXT_DETECTOR_INPUT_SIZE, Math.round(page.height * scale))),
  };
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const mapInputPoint = (
  x: number,
  y: number,
  page: MokuroPageSize,
  transform: LetterboxTransform,
): MokuroPoint => ({
  x: clamp((x * page.width) / transform.width, 0, page.width),
  y: clamp((y * page.height) / transform.height, 0, page.height),
});

const mapInputBox = (
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  page: MokuroPageSize,
  transform: LetterboxTransform,
): OcrBoundingBox | null => {
  const left = clamp(xMin, 0, transform.width);
  const top = clamp(yMin, 0, transform.height);
  const right = clamp(xMax, 0, transform.width);
  const bottom = clamp(yMax, 0, transform.height);
  const box = {
    xMin: (left * page.width) / transform.width,
    yMin: (top * page.height) / transform.height,
    xMax: (right * page.width) / transform.width,
    yMax: (bottom * page.height) / transform.height,
  };
  return box.xMax > box.xMin && box.yMax > box.yMin ? box : null;
};

const boxArea = (box: OcrBoundingBox): number =>
  Math.max(0, box.xMax - box.xMin) * Math.max(0, box.yMax - box.yMin);

const intersectionArea = (left: OcrBoundingBox, right: OcrBoundingBox): number =>
  Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin)) *
  Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));

const intersectionOverUnion = (left: OcrBoundingBox, right: OcrBoundingBox): number => {
  const intersection = intersectionArea(left, right);
  const union = boxArea(left) + boxArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
};

const unionBoxes = (boxes: readonly OcrBoundingBox[]): OcrBoundingBox => ({
  xMin: Math.min(...boxes.map((box) => box.xMin)),
  yMin: Math.min(...boxes.map((box) => box.yMin)),
  xMax: Math.max(...boxes.map((box) => box.xMax)),
  yMax: Math.max(...boxes.map((box) => box.yMax)),
});

const blockLanguage = (classIndex: number): MokuroTextLanguage => {
  if (classIndex === 0) return 'eng';
  if (classIndex === 1) return 'ja';
  return 'unknown';
};

/** Decode the YOLOv5 block tensor into page-coordinate text block candidates. */
export const decodeMokuroBlockPredictions = (
  data: ArrayLike<number>,
  page: MokuroPageSize,
  transform = getLetterboxTransform(page),
  options: Pick<
    MokuroTextDetectorOptions,
    'blockConfidence' | 'blockIouThreshold' | 'maximumBlocks'
  > = {},
): MokuroTextBlock[] => {
  validatePage(page);
  const blockConfidence = options.blockConfidence ?? DEFAULT_BLOCK_CONFIDENCE;
  const blockIouThreshold = options.blockIouThreshold ?? DEFAULT_BLOCK_IOU_THRESHOLD;
  const maximumBlocks = options.maximumBlocks ?? DEFAULT_MAXIMUM_BLOCKS;
  validateOption('block confidence', blockConfidence, 0, 1);
  validateOption('block IoU threshold', blockIouThreshold, 0, 1);
  validatePositiveInteger('maximum blocks', maximumBlocks);

  const rowCount = Math.min(Math.floor(data.length / 7), MOKURO_TEXT_DETECTOR_OUTPUT_SHAPES.blk[1]);
  const candidates: Array<MokuroTextBlock & { classIndex: number; index: number }> = [];
  for (let index = 0; index < rowCount; index += 1) {
    const offset = index * 7;
    const centerX = Number(data[offset]);
    const centerY = Number(data[offset + 1]);
    const width = Number(data[offset + 2]);
    const height = Number(data[offset + 3]);
    const objectness = Number(data[offset + 4]);
    const englishScore = Number(data[offset + 5]);
    const japaneseScore = Number(data[offset + 6]);
    if (
      ![centerX, centerY, width, height, objectness, englishScore, japaneseScore].every(
        Number.isFinite,
      )
    ) {
      continue;
    }
    const classIndex = japaneseScore > englishScore ? 1 : 0;
    const classScore = Math.max(englishScore, japaneseScore);
    const score = objectness * classScore;
    if (score < blockConfidence || width <= 0 || height <= 0) continue;
    const box = mapInputBox(
      centerX - width / 2,
      centerY - height / 2,
      centerX + width / 2,
      centerY + height / 2,
      page,
      transform,
    );
    if (!box) continue;
    candidates.push({
      box,
      score,
      language: blockLanguage(classIndex),
      vertical: false,
      lines: [],
      classIndex,
      index,
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  const accepted: Array<MokuroTextBlock & { classIndex: number; index: number }> = [];
  for (const candidate of candidates) {
    if (
      accepted.some(
        (other) =>
          other.classIndex === candidate.classIndex &&
          intersectionOverUnion(other.box, candidate.box) >= blockIouThreshold,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
    if (accepted.length >= maximumBlocks) break;
  }
  return accepted.map(({ classIndex: _classIndex, index: _index, ...block }) => block);
};

const componentPolygon = (
  component: LineComponent,
  page: MokuroPageSize,
  transform: LetterboxTransform,
): { polygon: MokuroPoint[]; vertical: boolean } => {
  const meanX = component.sumX / component.count;
  const meanY = component.sumY / component.count;
  const covarianceXX = component.sumXX / component.count - meanX * meanX;
  const covarianceYY = component.sumYY / component.count - meanY * meanY;
  const covarianceXY = component.sumXY / component.count - meanX * meanY;
  const angle =
    Math.abs(covarianceXX - covarianceYY) + Math.abs(covarianceXY) > 1e-6
      ? 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
      : 0;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const pixel of component.pixels) {
    const x = pixel % MOKURO_TEXT_DETECTOR_INPUT_SIZE;
    const y = Math.floor(pixel / MOKURO_TEXT_DETECTOR_INPUT_SIZE);
    const centeredX = x - meanX;
    const centeredY = y - meanY;
    const projectionU = centeredX * ux + centeredY * uy;
    const projectionV = centeredX * vx + centeredY * vy;
    minU = Math.min(minU, projectionU);
    maxU = Math.max(maxU, projectionU);
    minV = Math.min(minV, projectionV);
    maxV = Math.max(maxV, projectionV);
  }
  const width = Math.max(1, maxU - minU + 1);
  const height = Math.max(1, maxV - minV + 1);
  const unclipDistance = (width * height * 1.5) / (2 * (width + height));
  minU -= unclipDistance;
  maxU += unclipDistance;
  minV -= unclipDistance;
  maxV += unclipDistance;
  const points = [
    { x: meanX + ux * minU + vx * minV, y: meanY + uy * minU + vy * minV },
    { x: meanX + ux * maxU + vx * minV, y: meanY + uy * maxU + vy * minV },
    { x: meanX + ux * maxU + vx * maxV, y: meanY + uy * maxU + vy * maxV },
    { x: meanX + ux * minU + vx * maxV, y: meanY + uy * minU + vy * maxV },
  ].sort((left, right) => left.x - right.x || left.y - right.y);
  const left = points.slice(0, 2).sort((first, second) => first.y - second.y);
  const right = points.slice(2).sort((first, second) => first.y - second.y);
  const inputPolygon = [left[0]!, right[0]!, right[1]!, left[1]!];
  const polygon = inputPolygon.map(({ x, y }) => mapInputPoint(x, y, page, transform));
  const vertical = Math.abs(uy) > Math.abs(ux);
  return { polygon, vertical };
};

const getLineBox = (polygon: readonly MokuroPoint[]): OcrBoundingBox => ({
  xMin: Math.min(...polygon.map((point) => point.x)),
  yMin: Math.min(...polygon.map((point) => point.y)),
  xMax: Math.max(...polygon.map((point) => point.x)),
  yMax: Math.max(...polygon.map((point) => point.y)),
});

const collectLineComponent = (
  seed: number,
  map: ArrayLike<number>,
  visited: Uint8Array,
  queue: Int32Array,
  threshold: number,
): LineComponent => {
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  visited[seed] = 1;
  let count = 0;
  let score = 0;
  let minX = MOKURO_TEXT_DETECTOR_INPUT_SIZE;
  let minY = MOKURO_TEXT_DETECTOR_INPUT_SIZE;
  let maxX = 0;
  let maxY = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  const pixels: number[] = [];
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % MOKURO_TEXT_DETECTOR_INPUT_SIZE;
    const y = Math.floor(pixel / MOKURO_TEXT_DETECTOR_INPUT_SIZE);
    const value = Number(map[pixel]);
    pixels.push(pixel);
    count += 1;
    score += Number.isFinite(value) ? value : threshold;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (
          nextX < 0 ||
          nextX >= MOKURO_TEXT_DETECTOR_INPUT_SIZE ||
          nextY < 0 ||
          nextY >= MOKURO_TEXT_DETECTOR_INPUT_SIZE
        ) {
          continue;
        }
        const next = nextY * MOKURO_TEXT_DETECTOR_INPUT_SIZE + nextX;
        if (!visited[next] && Number(map[next]) > threshold) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
  }
  return {
    pixels,
    count,
    score: score / Math.max(1, count),
    minX,
    minY,
    maxX,
    maxY,
    sumX,
    sumY,
    sumXX,
    sumYY,
    sumXY,
  };
};

/** Extract oriented DB text-line polygons from the first `det` channel. */
export const extractMokuroLinePolygons = (
  data: ArrayLike<number>,
  page: MokuroPageSize,
  transform = getLetterboxTransform(page),
  options: Pick<
    MokuroTextDetectorOptions,
    'lineConfidence' | 'lineThreshold' | 'maximumLines'
  > = {},
): MokuroTextLine[] => {
  validatePage(page);
  const lineConfidence = options.lineConfidence ?? DEFAULT_LINE_CONFIDENCE;
  const lineThreshold = options.lineThreshold ?? DEFAULT_LINE_THRESHOLD;
  const maximumLines = options.maximumLines ?? DEFAULT_MAXIMUM_LINES;
  validateOption('line confidence', lineConfidence, 0, 1);
  validateOption('line threshold', lineThreshold, 0, 1);
  validatePositiveInteger('maximum lines', maximumLines);
  if (data.length < MASK_CHANNEL_SIZE) {
    throw new Error('Mokuro text detector line output has incomplete data');
  }

  const visited = new Uint8Array(MASK_CHANNEL_SIZE);
  const queue = new Int32Array(MASK_CHANNEL_SIZE);
  const components: LineComponent[] = [];
  for (let pixel = 0; pixel < MASK_CHANNEL_SIZE; pixel += 1) {
    if (visited[pixel] || Number(data[pixel]) <= lineThreshold) continue;
    const component = collectLineComponent(pixel, data, visited, queue, lineThreshold);
    if (component.maxX - component.minX < 1 || component.maxY - component.minY < 1) continue;
    if (component.score < lineConfidence) continue;
    components.push(component);
  }

  const lines = components.map((component) => {
    const { polygon, vertical } = componentPolygon(component, page, transform);
    return { polygon, box: getLineBox(polygon), score: component.score, vertical };
  });
  return lines
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.box.yMin - right.box.yMin ||
        left.box.xMin - right.box.xMin,
    )
    .slice(0, maximumLines);
};

const sampleMaskCoverage = (mask: MokuroMask, box: OcrBoundingBox): number => {
  const xMin = clamp(Math.floor(box.xMin), 0, mask.width - 1);
  const yMin = clamp(Math.floor(box.yMin), 0, mask.height - 1);
  const xMax = clamp(Math.ceil(box.xMax), xMin + 1, mask.width);
  const yMax = clamp(Math.ceil(box.yMax), yMin + 1, mask.height);
  let sum = 0;
  let count = 0;
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < xMax; x += 1) {
      sum += mask.data[y * mask.width + x]!;
      count += 1;
    }
  }
  return count > 0 ? sum / count / 255 : 0;
};

const resampleMask = (
  data: ArrayLike<number>,
  page: MokuroPageSize,
  transform: LetterboxTransform,
): MokuroMask => {
  const result = new Uint8Array(page.width * page.height);
  const inputWidth = MOKURO_TEXT_DETECTOR_INPUT_SIZE;
  for (let y = 0; y < page.height; y += 1) {
    const sourceY = ((y + 0.5) * transform.height) / page.height - 0.5;
    const y0 = clamp(Math.floor(sourceY), 0, transform.height - 1);
    const y1 = clamp(y0 + 1, 0, transform.height - 1);
    const yWeight = clamp(sourceY - Math.floor(sourceY), 0, 1);
    for (let x = 0; x < page.width; x += 1) {
      const sourceX = ((x + 0.5) * transform.width) / page.width - 0.5;
      const x0 = clamp(Math.floor(sourceX), 0, transform.width - 1);
      const x1 = clamp(x0 + 1, 0, transform.width - 1);
      const xWeight = clamp(sourceX - Math.floor(sourceX), 0, 1);
      const topLeft = Number(data[y0 * inputWidth + x0]);
      const topRight = Number(data[y0 * inputWidth + x1]);
      const bottomLeft = Number(data[y1 * inputWidth + x0]);
      const bottomRight = Number(data[y1 * inputWidth + x1]);
      const top = topLeft + (topRight - topLeft) * xWeight;
      const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
      const value = clamp(top + (bottom - top) * yWeight, 0, 1);
      result[y * page.width + x] = Math.round(value * 255);
    }
  }
  return { width: page.width, height: page.height, data: result };
};

const fillPolygon = (mask: MokuroMask, polygon: readonly MokuroPoint[]): void => {
  if (polygon.length < 3) return;
  const minY = clamp(Math.floor(Math.min(...polygon.map((point) => point.y))), 0, mask.height - 1);
  const maxY = clamp(
    Math.ceil(Math.max(...polygon.map((point) => point.y))),
    minY + 1,
    mask.height,
  );
  for (let y = minY; y < maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const left = polygon[index]!;
      const right = polygon[(index + 1) % polygon.length]!;
      if ((left.y <= scanY && right.y > scanY) || (right.y <= scanY && left.y > scanY)) {
        intersections.push(left.x + ((scanY - left.y) * (right.x - left.x)) / (right.y - left.y));
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const xMin = clamp(Math.ceil(intersections[index]!), 0, mask.width - 1);
      const xMax = clamp(Math.floor(intersections[index + 1]!), xMin, mask.width - 1);
      for (let x = xMin; x <= xMax; x += 1) mask.data[y * mask.width + x] = 255;
    }
  }
};

const fillBox = (mask: MokuroMask, box: OcrBoundingBox): void => {
  const xMin = clamp(Math.floor(box.xMin), 0, mask.width - 1);
  const yMin = clamp(Math.floor(box.yMin), 0, mask.height - 1);
  const xMax = clamp(Math.ceil(box.xMax), xMin + 1, mask.width);
  const yMax = clamp(Math.ceil(box.yMax), yMin + 1, mask.height);
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < xMax; x += 1) mask.data[y * mask.width + x] = 255;
  }
};

const sortLines = (lines: readonly MokuroTextLine[], vertical: boolean): MokuroTextLine[] =>
  [...lines].sort((left, right) =>
    vertical
      ? right.box.xMin - left.box.xMin || left.box.yMin - right.box.yMin
      : left.box.yMin - right.box.yMin || left.box.xMin - right.box.xMin,
  );

const getBlockVertical = (block: BlockCandidate): boolean => {
  if (block.lines.length === 0) {
    return block.box.yMax - block.box.yMin > (block.box.xMax - block.box.xMin) * 1.5;
  }
  const verticalCount = block.lines.filter((line) => line.vertical).length;
  if (block.language === 'ja') return verticalCount >= block.lines.length / 2;
  return verticalCount > block.lines.length * 0.66;
};

const sortBlocks = (blocks: readonly BlockCandidate[], page: MokuroPageSize): BlockCandidate[] => {
  const japaneseCount = blocks.filter((block) => block.language === 'ja').length;
  const flipLeftRight = japaneseCount > blocks.length / 2;
  const originalWidth = page.width;
  const gridWidth = page.width > page.height ? page.width / 2 : page.width;
  const imageArea = page.height * gridWidth;
  const gridXCount = 3;
  const gridYCount = 4;
  return [...blocks]
    .map((block, index) => {
      const centerX = (block.box.xMin + block.box.xMax) / 2;
      const centerY = (block.box.yMin + block.box.yMax) / 2;
      const logicalX = flipLeftRight ? originalWidth - centerX : centerX;
      const gridX = Math.floor((logicalX / gridWidth) * gridXCount);
      const gridY = Math.floor((centerY / page.height) * gridYCount);
      let weight =
        (gridY * gridXCount + gridX) * imageArea +
        1.2 * (logicalX - (gridX * gridWidth) / gridXCount) +
        (centerY - (gridY * page.height) / gridYCount);
      if (gridWidth !== originalWidth && gridX >= gridXCount) {
        weight += imageArea * gridYCount * gridXCount;
      }
      return { block, weight, index };
    })
    .sort((left, right) => left.weight - right.weight || left.index - right.index)
    .map(({ block }) => block);
};

const rectangleLine = (box: OcrBoundingBox, score: number): MokuroTextLine => ({
  polygon: [
    { x: box.xMin, y: box.yMin },
    { x: box.xMax, y: box.yMin },
    { x: box.xMax, y: box.yMax },
    { x: box.xMin, y: box.yMax },
  ],
  box,
  score,
  vertical: box.yMax - box.yMin > box.xMax - box.xMin,
});

/** Associate DB lines with blocks and apply Mokuro's Japanese reading order. */
export const groupMokuroText = (
  blocks: readonly MokuroTextBlock[],
  lines: readonly MokuroTextLine[],
  rawMask: MokuroMask,
  page: MokuroPageSize,
): MokuroTextBlock[] => {
  const grouped: BlockCandidate[] = blocks.map((block) => ({ ...block, lines: [] }));
  for (const line of lines) {
    const lineArea = boxArea(line.box);
    let bestIndex = -1;
    let bestCoverage = 0;
    if (lineArea > 0) {
      grouped.forEach((block, index) => {
        const coverage = intersectionArea(line.box, block.box) / lineArea;
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestIndex = index;
        }
      });
    }
    if (bestIndex >= 0 && bestCoverage > 0.4) {
      grouped[bestIndex]!.lines.push(line);
    } else if (sampleMaskCoverage(rawMask, line.box) >= 0.1) {
      grouped.push({
        box: line.box,
        score: line.score,
        language: 'unknown',
        vertical: line.vertical,
        lines: [line],
      });
    }
  }

  const finalBlocks: BlockCandidate[] = [];
  for (const block of grouped) {
    if (block.lines.length === 0) {
      if (sampleMaskCoverage(rawMask, block.box) < 0.1) continue;
      block.lines.push(rectangleLine(block.box, block.score));
    }
    block.vertical = getBlockVertical(block);
    block.lines = sortLines(block.lines, block.vertical);
    block.box = unionBoxes([block.box, ...block.lines.map((line) => line.box)]);
    finalBlocks.push(block);
  }

  return sortBlocks(finalBlocks, page).map((block) => ({
    box: block.box,
    score: block.score,
    language: block.language,
    vertical: block.vertical,
    lines: block.lines,
  }));
};

const makeRefinedMask = (
  rawMask: MokuroMask,
  blocks: readonly MokuroTextBlock[],
  threshold: number,
): MokuroMask => {
  const data = new Uint8Array(rawMask.data.length);
  for (let index = 0; index < rawMask.data.length; index += 1) {
    data[index] = rawMask.data[index]! / 255 >= threshold ? 255 : 0;
  }
  const refined = { width: rawMask.width, height: rawMask.height, data };
  for (const block of blocks) {
    if (block.lines.length === 0) fillBox(refined, block.box);
    else for (const line of block.lines) fillPolygon(refined, line.polygon);
  }
  return refined;
};

export const postprocessMokuroDetectorOutputs = (
  outputs: MokuroDetectorOutputs,
  page: MokuroPageSize,
  options: MokuroTextDetectorOptions = {},
): MokuroTextDetectionResult => {
  validatePage(page);
  assertOutputs(outputs);
  const resolved = resolveOptions(options);
  const transform = getLetterboxTransform(page);
  const rawMask = resampleMask(outputs.seg.data, page, transform);
  const blocks = decodeMokuroBlockPredictions(outputs.blk.data, page, transform, resolved);
  const lines = extractMokuroLinePolygons(outputs.det.data, page, transform, resolved);
  const grouped = groupMokuroText(blocks, lines, rawMask, page);
  return {
    page: { ...page },
    blocks: grouped,
    rawMask,
    refinedMask: makeRefinedMask(rawMask, grouped, resolved.maskThreshold),
  };
};

const makeImageTensor = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  if (pixels.length !== width * height * 4) {
    throw new Error('Mokuro text detector received incomplete image pixels');
  }
  const pixelCount = width * height;
  const values = new Float32Array(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = pixels[rgba]! / 255;
    values[pixelCount + pixel] = pixels[rgba + 1]! / 255;
    values[pixelCount * 2 + pixel] = pixels[rgba + 2]! / 255;
  }
  return values;
};

const getOutput = (
  outputs: Record<string, MokuroDetectorTensor>,
  name: keyof MokuroDetectorOutputs,
): MokuroDetectorTensor => {
  const output = outputs[name];
  if (!output) throw new Error(`Mokuro text detector returned no ${name} output`);
  return output;
};

export class MokuroTextDetector {
  readonly #options: MokuroTextDetectorOptions;
  readonly #onDownloadProgress?: (progress: ModelDownloadProgress) => void;
  readonly #createCanvas: () => MokuroDetectorCanvas;
  readonly #loadRuntime: () => Promise<MokuroTextDetectorRuntime>;
  readonly #loadModel: MokuroTextDetectorDependencies['loadModel'];
  readonly #abortController = new AbortController();
  readonly #activeRuns = new Set<Promise<Record<string, MokuroDetectorTensor>>>();
  #runtimePromise: Promise<MokuroTextDetectorRuntime> | null = null;
  #sessionPromise: Promise<MokuroDetectorSession> | null = null;
  #terminated = false;

  constructor(
    options: MokuroTextDetectorOptions = {},
    dependencies: Partial<MokuroTextDetectorDependencies> = {},
  ) {
    this.#options = { ...options };
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#createCanvas = dependencies.createCanvas ?? defaultCreateCanvas;
    this.#loadRuntime = dependencies.loadRuntime ?? defaultLoadRuntime;
    this.#loadModel = dependencies.loadModel ?? defaultLoadModel;
  }

  async detect(
    source: CanvasImageSource,
    page: MokuroPageSize,
  ): Promise<MokuroTextDetectionResult> {
    validatePage(page);
    if (this.#terminated) throw new Error('Mokuro text detector has been terminated');
    const transform = getLetterboxTransform(page);
    const canvas = this.#createCanvas();
    canvas.width = MOKURO_TEXT_DETECTOR_INPUT_SIZE;
    canvas.height = MOKURO_TEXT_DETECTOR_INPUT_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Mokuro text detector could not create a canvas context');
    context.drawImage(source, 0, 0, transform.width, transform.height);
    const pixels = context.getImageData(
      0,
      0,
      MOKURO_TEXT_DETECTOR_INPUT_SIZE,
      MOKURO_TEXT_DETECTOR_INPUT_SIZE,
    ).data;
    const runtime = await this.#getRuntime();
    const session = await this.#getSession(runtime);
    if (this.#terminated) throw new Error('Mokuro text detector has been terminated');
    const run = session.run({
      images: new runtime.Tensor(
        'float32',
        makeImageTensor(pixels, MOKURO_TEXT_DETECTOR_INPUT_SIZE, MOKURO_TEXT_DETECTOR_INPUT_SIZE),
        [1, 3, MOKURO_TEXT_DETECTOR_INPUT_SIZE, MOKURO_TEXT_DETECTOR_INPUT_SIZE],
      ),
    });
    this.#activeRuns.add(run);
    let rawOutputs: Record<string, MokuroDetectorTensor>;
    try {
      rawOutputs = await run;
    } catch (error) {
      await this.#discardSession(session);
      throw error;
    } finally {
      this.#activeRuns.delete(run);
    }
    if (this.#terminated) throw new Error('Mokuro text detector has been terminated');
    const outputs = {
      blk: getOutput(rawOutputs, 'blk'),
      seg: getOutput(rawOutputs, 'seg'),
      det: getOutput(rawOutputs, 'det'),
    };
    return postprocessMokuroDetectorOutputs(outputs, page, this.#options);
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
      await Promise.allSettled([...this.#activeRuns]);
      await session.release();
    } catch {
      return;
    }
  }

  #getRuntime(): Promise<MokuroTextDetectorRuntime> {
    if (this.#runtimePromise) return this.#runtimePromise;
    const runtimePromise = this.#loadRuntime();
    this.#runtimePromise = runtimePromise;
    void runtimePromise.catch(() => {
      if (this.#runtimePromise === runtimePromise && !this.#terminated) this.#runtimePromise = null;
    });
    return runtimePromise;
  }

  #getSession(runtime: MokuroTextDetectorRuntime): Promise<MokuroDetectorSession> {
    if (this.#terminated)
      return Promise.reject(new Error('Mokuro text detector has been terminated'));
    if (this.#sessionPromise) return this.#sessionPromise;
    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.proxy = true;
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
        throw new Error('Mokuro text detector has been terminated');
      }
      return session;
    });
    this.#sessionPromise = sessionPromise;
    void sessionPromise.catch(() => {
      if (this.#sessionPromise === sessionPromise && !this.#terminated) this.#sessionPromise = null;
    });
    return sessionPromise;
  }

  async #discardSession(session: MokuroDetectorSession): Promise<void> {
    const sessionPromise = this.#sessionPromise;
    if (!sessionPromise) return;
    let activeSession: MokuroDetectorSession;
    try {
      activeSession = await sessionPromise;
    } catch {
      return;
    }
    if (activeSession !== session || this.#sessionPromise !== sessionPromise) return;
    this.#sessionPromise = null;
    await activeSession.release().catch(() => undefined);
  }
}
