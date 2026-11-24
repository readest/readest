import type { OcrBoundingBox } from '@/services/plugins/ocr';
import type { InferenceSession } from 'onnxruntime-web/wasm';
import { loadModelAsset, type ModelAsset } from './modelAssets';
import { createOnnxSession, loadOnnxRuntime, type OnnxRuntime } from './onnxRuntime';
import { createOcrCanvas, isHtmlCanvas } from './canvas';

export const COMIC_TEXT_DETECTOR_INPUT_SIZE = 1024;
const COMIC_TEXT_DETECTOR_MODEL: ModelAsset = {
  url: 'https://huggingface.co/mayocream/koharu/resolve/15439cba09df388c51de6e47c6020bc31edab41f/comictextdetector.onnx',
  sha256: '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f',
  bytes: 94_669_756,
};

export const COMIC_TEXT_DETECTOR_OUTPUT_SHAPES = {
  blk: [1, 64_512, 7],
  seg: [1, 1, COMIC_TEXT_DETECTOR_INPUT_SIZE, COMIC_TEXT_DETECTOR_INPUT_SIZE],
  det: [1, 2, COMIC_TEXT_DETECTOR_INPUT_SIZE, COMIC_TEXT_DETECTOR_INPUT_SIZE],
} as const;

export type ComicTextLanguage = 'eng' | 'ja' | 'unknown';

export interface ComicPageSize {
  width: number;
  height: number;
}

export interface ComicPoint {
  x: number;
  y: number;
}

/** A detector-resolution grayscale page mask. Values are 0..255. */
export interface ComicMask extends ComicPageSize {
  data: Uint8Array;
}

export interface ComicTextLine {
  polygon: readonly ComicPoint[];
  box: OcrBoundingBox;
  score: number;
  vertical: boolean;
}

export interface ComicTextBlock {
  box: OcrBoundingBox;
  score: number;
  language: ComicTextLanguage;
  vertical: boolean;
  lines: readonly ComicTextLine[];
}

export interface ComicTextDetectionResult {
  page: ComicPageSize;
  mask?: ComicMask;
  blocks: readonly ComicTextBlock[];
}

export interface ComicDetectorTensor {
  data: Float32Array;
  dims: readonly number[];
}

export interface ComicDetectorOutputs {
  blk: ComicDetectorTensor;
  seg: ComicDetectorTensor;
  det: ComicDetectorTensor;
}

export interface ComicTextDetectorOptions {
  blockConfidence?: number;
  blockIouThreshold?: number;
  lineConfidence?: number;
  lineThreshold?: number;
  maximumBlocks?: number;
  maximumLines?: number;
  onDownloadProgress?: (progress: number) => void;
}

interface LetterboxTransform {
  width: number;
  height: number;
}

interface BlockCandidate extends ComicTextBlock {
  lines: ComicTextLine[];
}

interface LineComponent {
  count: number;
  sum: number;
  minX: number;
  maxX: number;
  minY: number;
  /** The leftmost and rightmost pixel of each row, from `minY`. */
  edges: number[];
}

const DEFAULT_BLOCK_CONFIDENCE = 0.4;
const DEFAULT_BLOCK_IOU_THRESHOLD = 0.35;
const DEFAULT_LINE_CONFIDENCE = 0.5;
const DEFAULT_LINE_THRESHOLD = 0.3;
const DEFAULT_MAXIMUM_BLOCKS = 300;
const DEFAULT_MAXIMUM_LINES = 1_000;
const MASK_CHANNEL_SIZE = COMIC_TEXT_DETECTOR_INPUT_SIZE * COMIC_TEXT_DETECTOR_INPUT_SIZE;

const validatePositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Comic text detector requires a positive integer ${name}`);
  }
};

const validatePage = (page: ComicPageSize): void => {
  validatePositiveInteger('page width', page.width);
  validatePositiveInteger('page height', page.height);
  if (!Number.isSafeInteger(page.width * page.height)) {
    throw new Error('Comic text detector page is too large');
  }
};

const validateOption = (name: string, value: number, minimum: number, maximum: number): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Comic text detector ${name} is outside its supported range`);
  }
};

const resolveOptions = (options: ComicTextDetectorOptions = {}) => {
  const resolved = {
    blockConfidence: options.blockConfidence ?? DEFAULT_BLOCK_CONFIDENCE,
    blockIouThreshold: options.blockIouThreshold ?? DEFAULT_BLOCK_IOU_THRESHOLD,
    lineConfidence: options.lineConfidence ?? DEFAULT_LINE_CONFIDENCE,
    lineThreshold: options.lineThreshold ?? DEFAULT_LINE_THRESHOLD,
    maximumBlocks: options.maximumBlocks ?? DEFAULT_MAXIMUM_BLOCKS,
    maximumLines: options.maximumLines ?? DEFAULT_MAXIMUM_LINES,
  };
  validateOption('block confidence', resolved.blockConfidence, 0, 1);
  validateOption('block IoU threshold', resolved.blockIouThreshold, 0, 1);
  validateOption('line confidence', resolved.lineConfidence, 0, 1);
  validateOption('line threshold', resolved.lineThreshold, 0, 1);
  validatePositiveInteger('maximum blocks', resolved.maximumBlocks);
  validatePositiveInteger('maximum lines', resolved.maximumLines);
  return resolved;
};

const assertTensorShape = (
  name: keyof typeof COMIC_TEXT_DETECTOR_OUTPUT_SHAPES,
  tensor: ComicDetectorTensor,
): void => {
  const expected = COMIC_TEXT_DETECTOR_OUTPUT_SHAPES[name];
  if (
    tensor.dims.length !== expected.length ||
    expected.some((dimension, index) => tensor.dims[index] !== dimension)
  ) {
    throw new Error(
      `Comic text detector output ${name} has invalid dimensions; expected [${expected.join(', ')}]`,
    );
  }
  let expectedLength = 1;
  for (const dimension of expected) expectedLength *= dimension;
  if (tensor.data.length !== expectedLength) {
    throw new Error(`Comic text detector output ${name} has incomplete data`);
  }
};

const assertOutputs = (outputs: ComicDetectorOutputs): void => {
  assertTensorShape('blk', outputs.blk);
  assertTensorShape('seg', outputs.seg);
  assertTensorShape('det', outputs.det);
};

const getLetterboxTransform = (page: ComicPageSize): LetterboxTransform => {
  const scale = Math.min(
    COMIC_TEXT_DETECTOR_INPUT_SIZE / page.width,
    COMIC_TEXT_DETECTOR_INPUT_SIZE / page.height,
  );
  return {
    width: Math.max(1, Math.min(COMIC_TEXT_DETECTOR_INPUT_SIZE, Math.round(page.width * scale))),
    height: Math.max(1, Math.min(COMIC_TEXT_DETECTOR_INPUT_SIZE, Math.round(page.height * scale))),
  };
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const mapInputPoint = (
  x: number,
  y: number,
  page: ComicPageSize,
  transform: LetterboxTransform,
): ComicPoint => ({
  x: clamp((x * page.width) / transform.width, 0, page.width),
  y: clamp((y * page.height) / transform.height, 0, page.height),
});

const mapInputBox = (
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  page: ComicPageSize,
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

const blockLanguage = (classIndex: number): ComicTextLanguage => {
  if (classIndex === 0) return 'eng';
  if (classIndex === 1) return 'ja';
  return 'unknown';
};

/** Decode the YOLOv5 block tensor into page-coordinate text block candidates. */
export const decodeComicBlockPredictions = (
  data: Float32Array,
  page: ComicPageSize,
  transform = getLetterboxTransform(page),
  options: Pick<
    ComicTextDetectorOptions,
    'blockConfidence' | 'blockIouThreshold' | 'maximumBlocks'
  > = {},
): ComicTextBlock[] => {
  validatePage(page);
  const blockConfidence = options.blockConfidence ?? DEFAULT_BLOCK_CONFIDENCE;
  const blockIouThreshold = options.blockIouThreshold ?? DEFAULT_BLOCK_IOU_THRESHOLD;
  const maximumBlocks = options.maximumBlocks ?? DEFAULT_MAXIMUM_BLOCKS;
  validateOption('block confidence', blockConfidence, 0, 1);
  validateOption('block IoU threshold', blockIouThreshold, 0, 1);
  validatePositiveInteger('maximum blocks', maximumBlocks);

  const candidates: Array<ComicTextBlock & { classIndex: number; index: number }> = [];
  for (let index = 0; index < data.length / 7; index += 1) {
    const offset = index * 7;
    const englishScore = data[offset + 5]!;
    const japaneseScore = data[offset + 6]!;
    const score = data[offset + 4]! * Math.max(englishScore, japaneseScore);
    if (!(score >= blockConfidence)) continue;
    const centerX = data[offset]!;
    const centerY = data[offset + 1]!;
    const halfWidth = data[offset + 2]! / 2;
    const halfHeight = data[offset + 3]! / 2;
    const box = mapInputBox(
      centerX - halfWidth,
      centerY - halfHeight,
      centerX + halfWidth,
      centerY + halfHeight,
      page,
      transform,
    );
    if (!box) continue;
    const classIndex = japaneseScore > englishScore ? 1 : 0;
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
  const accepted: Array<ComicTextBlock & { classIndex: number; index: number }> = [];
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
  page: ComicPageSize,
  transform: LetterboxTransform,
): { polygon: ComicPoint[]; vertical: boolean } => {
  // Row endpoints preserve the pixel hull without sorting every foreground pixel.
  const { edges, minY } = component;
  const endpoints: ComicPoint[] = [];
  for (let index = 0; index < edges.length; index += 2) {
    const y = minY + index / 2;
    endpoints.push({ x: edges[index]!, y });
    if (edges[index + 1] !== edges[index]) endpoints.push({ x: edges[index + 1]!, y });
  }
  endpoints.sort((a, b) => a.x - b.x || a.y - b.y);
  const hull: ComicPoint[] = [];
  for (const chain of [endpoints, [...endpoints].reverse()]) {
    const start = hull.length;
    for (const point of chain) {
      while (hull.length >= start + 2) {
        const a = hull[hull.length - 2]!;
        const b = hull[hull.length - 1]!;
        if ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) > 0) break;
        hull.pop();
      }
      hull.push(point);
    }
    hull.pop();
  }

  // Rotating calipers visit each support point once per axis around the hull.
  const supports = [0, 0, 0, 0];
  let area = Number.POSITIVE_INFINITY;
  let ux = 1;
  let uy = 0;
  let minU = 0;
  let maxU = 0;
  let minV = 0;
  let maxV = 0;
  for (let edge = 0; edge < hull.length; edge += 1) {
    const a = hull[edge]!;
    const b = hull[(edge + 1) % hull.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const bounds = [
      [dx, dy],
      [-dx, -dy],
      [-dy, dx],
      [dy, -dx],
    ].map(([x, y], axis) => {
      const dot = (index: number) => hull[index]!.x * x! + hull[index]!.y * y!;
      let support = supports[axis]!;
      if (edge === 0) {
        for (let index = 1; index < hull.length; index += 1) {
          if (dot(index) > dot(support)) support = index;
        }
      } else {
        while (dot((support + 1) % hull.length) > dot(support) + 1e-9) {
          support = (support + 1) % hull.length;
        }
      }
      supports[axis] = support;
      return dot(support);
    });
    const candidateArea = (bounds[0]! + bounds[1]!) * (bounds[2]! + bounds[3]!);
    if (candidateArea < area) {
      area = candidateArea;
      ux = dx;
      uy = dy;
      [maxU, minU, maxV, minV] = [bounds[0]!, -bounds[1]!, bounds[2]!, -bounds[3]!];
    }
  }
  const vx = -uy;
  const vy = ux;
  const width = Math.max(1, maxU - minU + 1);
  const height = Math.max(1, maxV - minV + 1);
  const unclipDistance = (width * height * 1.5) / (2 * (width + height));
  minU -= unclipDistance;
  maxU += unclipDistance;
  minV -= unclipDistance;
  maxV += unclipDistance;
  const points = [
    { x: ux * minU + vx * minV, y: uy * minU + vy * minV },
    { x: ux * maxU + vx * minV, y: uy * maxU + vy * minV },
    { x: ux * maxU + vx * maxV, y: uy * maxU + vy * maxV },
    { x: ux * minU + vx * maxV, y: uy * minU + vy * maxV },
  ].sort((left, right) => left.x - right.x || left.y - right.y);
  const left = points.slice(0, 2).sort((first, second) => first.y - second.y);
  const right = points.slice(2).sort((first, second) => first.y - second.y);
  const inputPolygon = [left[0]!, right[0]!, right[1]!, left[1]!];
  const polygon = inputPolygon.map(({ x, y }) => mapInputPoint(x, y, page, transform));
  const vertical = width >= height ? Math.abs(uy) > Math.abs(ux) : Math.abs(vy) > Math.abs(vx);
  return { polygon, vertical };
};

const getLineBox = (polygon: readonly ComicPoint[]): OcrBoundingBox => ({
  xMin: Math.min(...polygon.map((point) => point.x)),
  yMin: Math.min(...polygon.map((point) => point.y)),
  xMax: Math.max(...polygon.map((point) => point.x)),
  yMax: Math.max(...polygon.map((point) => point.y)),
});

/**
 * The connected areas above the threshold, in the order their first pixel is
 * met. Rows are read once into runs of pixels, which join the runs they touch in
 * the row above.
 */
const findLineComponents = (map: Float32Array, threshold: number): LineComponent[] => {
  const size = COMIC_TEXT_DETECTOR_INPUT_SIZE;
  // Each run's first pixel, the pixel after its last, its sum, and an earlier run
  // of the same area (itself for the first).
  const starts: number[] = [];
  const ends: number[] = [];
  const sums: number[] = [];
  const parents: number[] = [];
  const findRoot = (run: number): number => {
    while (parents[run] !== run) run = parents[run] = parents[parents[run]!]!;
    return run;
  };
  let rowAbove = 0;
  for (let y = 0; y < size; y += 1) {
    const row = starts.length;
    const rowEnd = (y + 1) * size;
    let above = rowAbove;
    for (let pixel = y * size; pixel < rowEnd; pixel += 1) {
      if (!(map[pixel]! > threshold)) continue;
      const start = pixel;
      let sum = 0;
      for (; pixel < rowEnd && map[pixel]! > threshold; pixel += 1) sum += map[pixel]!;
      let root = starts.length;
      starts.push(start);
      ends.push(pixel);
      sums.push(sum);
      parents.push(root);
      while (above < row && ends[above]! + size < start) above += 1;
      for (let run = above; run < row && starts[run]! + size <= pixel; run += 1) {
        const other = findRoot(run);
        const first = Math.min(root, other);
        parents[root] = parents[other] = root = first;
      }
    }
    rowAbove = row;
  }

  const components = new Map<number, LineComponent>();
  for (let run = 0; run < starts.length; run += 1) {
    const root = findRoot(run);
    const y = Math.floor(starts[run]! / size);
    const left = starts[run]! - y * size;
    const right = ends[run]! - 1 - y * size;
    let component = components.get(root);
    if (!component) {
      component = { count: 0, sum: 0, minX: left, maxX: right, minY: y, edges: [] };
      components.set(root, component);
    }
    component.count += right - left + 1;
    component.sum += sums[run]!;
    component.minX = Math.min(component.minX, left);
    component.maxX = Math.max(component.maxX, right);
    const edge = (y - component.minY) * 2;
    component.edges[edge] ??= left;
    component.edges[edge + 1] = right;
  }
  return [...components.values()];
};

/** Extract oriented DB text-line polygons from the first `det` channel. */
export const extractComicLinePolygons = (
  data: Float32Array,
  page: ComicPageSize,
  transform = getLetterboxTransform(page),
  options: Pick<ComicTextDetectorOptions, 'lineConfidence' | 'lineThreshold' | 'maximumLines'> = {},
): ComicTextLine[] => {
  validatePage(page);
  const lineConfidence = options.lineConfidence ?? DEFAULT_LINE_CONFIDENCE;
  const lineThreshold = options.lineThreshold ?? DEFAULT_LINE_THRESHOLD;
  const maximumLines = options.maximumLines ?? DEFAULT_MAXIMUM_LINES;
  validateOption('line confidence', lineConfidence, 0, 1);
  validateOption('line threshold', lineThreshold, 0, 1);
  validatePositiveInteger('maximum lines', maximumLines);
  if (data.length < MASK_CHANNEL_SIZE) {
    throw new Error('Comic text detector line output has incomplete data');
  }

  const lines: ComicTextLine[] = [];
  for (const component of findLineComponents(data, lineThreshold)) {
    const score = component.sum / component.count;
    if (component.maxX === component.minX || component.edges.length === 2) continue;
    if (score < lineConfidence) continue;
    const { polygon, vertical } = componentPolygon(component, page, transform);
    lines.push({ polygon, box: getLineBox(polygon), score, vertical });
  }
  return lines
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.box.yMin - right.box.yMin ||
        left.box.xMin - right.box.xMin,
    )
    .slice(0, maximumLines);
};

const sampleMaskCoverage = (mask: ComicMask, box: OcrBoundingBox, page: ComicPageSize): number => {
  const xMin = clamp(Math.floor((box.xMin * mask.width) / page.width), 0, mask.width - 1);
  const yMin = clamp(Math.floor((box.yMin * mask.height) / page.height), 0, mask.height - 1);
  const xMax = clamp(Math.ceil((box.xMax * mask.width) / page.width), xMin + 1, mask.width);
  const yMax = clamp(Math.ceil((box.yMax * mask.height) / page.height), yMin + 1, mask.height);
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

const readInputMask = (data: Float32Array, transform: LetterboxTransform): ComicMask => {
  const result = new Uint8Array(transform.width * transform.height);
  for (let y = 0; y < transform.height; y += 1) {
    const sourceOffset = y * COMIC_TEXT_DETECTOR_INPUT_SIZE;
    const targetOffset = y * transform.width;
    for (let x = 0; x < transform.width; x += 1) {
      result[targetOffset + x] = clamp(data[sourceOffset + x]!, 0, 1) * 255 + 0.5;
    }
  }
  return { width: transform.width, height: transform.height, data: result };
};

const sortLines = (lines: readonly ComicTextLine[], vertical: boolean): ComicTextLine[] =>
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

const sortBlocks = (blocks: readonly BlockCandidate[], page: ComicPageSize): BlockCandidate[] => {
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

const rectangleLine = (box: OcrBoundingBox, score: number): ComicTextLine => ({
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
export const groupComicText = (
  blocks: readonly ComicTextBlock[],
  lines: readonly ComicTextLine[],
  rawMask: ComicMask,
  page: ComicPageSize,
): ComicTextBlock[] => {
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
    } else if (sampleMaskCoverage(rawMask, line.box, page) >= 0.1) {
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
      if (sampleMaskCoverage(rawMask, block.box, page) < 0.1) continue;
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

export const postprocessComicDetectorOutputs = (
  outputs: ComicDetectorOutputs,
  page: ComicPageSize,
  options: ComicTextDetectorOptions = {},
): ComicTextDetectionResult => {
  validatePage(page);
  assertOutputs(outputs);
  const resolved = resolveOptions(options);
  const transform = getLetterboxTransform(page);
  const rawMask = readInputMask(outputs.seg.data, transform);
  const blocks = decodeComicBlockPredictions(outputs.blk.data, page, transform, resolved);
  const lines = extractComicLinePolygons(outputs.det.data, page, transform, resolved);
  const grouped = groupComicText(blocks, lines, rawMask, page);
  return {
    page: { ...page },
    mask: rawMask,
    blocks: grouped,
  };
};

const PIXEL_VALUES = Float32Array.from({ length: 256 }, (_, value) => value / 255);

const makeImageTensor = (pixels: Uint8ClampedArray): Float32Array => {
  const pixelCount = pixels.length / 4;
  const values = new Float32Array(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = PIXEL_VALUES[pixels[rgba]!]!;
    values[pixelCount + pixel] = PIXEL_VALUES[pixels[rgba + 1]!]!;
    values[pixelCount * 2 + pixel] = PIXEL_VALUES[pixels[rgba + 2]!]!;
  }
  return values;
};

const getOutput = (
  outputs: InferenceSession.ReturnType,
  name: keyof ComicDetectorOutputs,
): ComicDetectorTensor => {
  const output = outputs[name];
  if (!output) throw new Error(`Comic text detector returned no ${name} output`);
  if (!(output.data instanceof Float32Array)) {
    throw new Error(`Comic text detector returned non-float ${name} output`);
  }
  return { data: output.data, dims: output.dims };
};

export class ComicTextDetector {
  readonly #options: ComicTextDetectorOptions;
  readonly #onDownloadProgress?: (progress: number) => void;
  #abortController: AbortController | null = null;
  readonly #activeRuns = new Set<Promise<InferenceSession.ReturnType>>();
  #sessionPromise: Promise<{
    runtime: OnnxRuntime;
    session: InferenceSession;
  }> | null = null;
  #terminated = false;

  constructor(options: ComicTextDetectorOptions = {}) {
    this.#options = { ...options };
    this.#onDownloadProgress = options.onDownloadProgress;
  }

  async detect(source: CanvasImageSource, page: ComicPageSize): Promise<ComicTextDetectionResult> {
    validatePage(page);
    if (this.#terminated) throw new Error('Comic text detector has been terminated');
    const transform = getLetterboxTransform(page);
    const canvas = createOcrCanvas(
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
      isHtmlCanvas(source) ? source : undefined,
    );
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Comic text detector could not create a canvas context');
    context.drawImage(source, 0, 0, transform.width, transform.height);
    const pixels = context.getImageData(
      0,
      0,
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
    ).data;
    const { runtime, session } = await this.#getSession();
    if (this.#terminated) throw new Error('Comic text detector has been terminated');
    const input = new runtime.Tensor('float32', makeImageTensor(pixels), [
      1,
      3,
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
      COMIC_TEXT_DETECTOR_INPUT_SIZE,
    ]);
    let run: Promise<InferenceSession.ReturnType>;
    try {
      run = session.run({ images: input });
    } catch (error) {
      input.dispose();
      throw error;
    }
    this.#activeRuns.add(run);
    let rawOutputs: InferenceSession.ReturnType;
    try {
      rawOutputs = await run;
    } catch (error) {
      await this.#discardSession(session);
      throw error;
    } finally {
      this.#activeRuns.delete(run);
      input.dispose();
    }
    try {
      if (this.#terminated) throw new Error('Comic text detector has been terminated');
      const outputs = {
        blk: getOutput(rawOutputs, 'blk'),
        seg: getOutput(rawOutputs, 'seg'),
        det: getOutput(rawOutputs, 'det'),
      };
      return postprocessComicDetectorOutputs(outputs, page, this.#options);
    } finally {
      for (const output of Object.values(rawOutputs)) output.dispose();
    }
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController?.abort();
    const sessionPromise = this.#sessionPromise;
    this.#sessionPromise = null;
    if (!sessionPromise) return;
    try {
      const { session } = await sessionPromise;
      await Promise.allSettled([...this.#activeRuns]);
      await session.release();
    } catch {
      return;
    }
  }

  #getSession(): Promise<{
    runtime: OnnxRuntime;
    session: InferenceSession;
  }> {
    if (this.#terminated)
      return Promise.reject(new Error('Comic text detector has been terminated'));
    if (this.#sessionPromise) return this.#sessionPromise;

    const controller = new AbortController();
    this.#abortController = controller;

    const sessionPromise = Promise.all([
      loadOnnxRuntime(),
      loadModelAsset(COMIC_TEXT_DETECTOR_MODEL, {
        signal: controller.signal,
        onProgress: (loaded) =>
          this.#onDownloadProgress?.(loaded / COMIC_TEXT_DETECTOR_MODEL.bytes),
      }),
    ])
      .then(async ([runtime, model]) => {
        if (this.#terminated) throw new Error('Comic text detector has been terminated');
        const session = await createOnnxSession(runtime, model);
        if (this.#terminated) {
          await session.release();
          throw new Error('Comic text detector has been terminated');
        }
        return { runtime, session };
      })
      .catch((error: unknown) => {
        controller.abort(error);
        throw error;
      });
    this.#sessionPromise = sessionPromise;
    void sessionPromise.catch(() => {
      if (this.#sessionPromise === sessionPromise && !this.#terminated) this.#sessionPromise = null;
    });
    return sessionPromise;
  }

  async #discardSession(session: InferenceSession): Promise<void> {
    const sessionPromise = this.#sessionPromise;
    if (!sessionPromise) return;
    let activeSession: InferenceSession;
    try {
      activeSession = (await sessionPromise).session;
    } catch {
      return;
    }
    if (activeSession !== session || this.#sessionPromise !== sessionPromise) return;
    this.#sessionPromise = null;
    await activeSession.release().catch(() => undefined);
  }
}
