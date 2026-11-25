import type { OcrBoundingBox } from '@/services/plugins/ocr';
import type { InferenceSession } from 'onnxruntime-web/wasm';
import { loadModelAsset, type ModelAsset } from './modelAssets';
import { LazyModel } from './lazyModel';
import { createOnnxSession, loadOnnxRuntime, type OnnxRuntime } from './onnxRuntime';
import { createOcrCanvas, isHtmlCanvas } from './canvas';
import { trimOnnxModel } from './trimOnnxModel';

const INPUT_SIZE = 1024;
const MODEL: ModelAsset = {
  url: 'https://huggingface.co/mayocream/koharu/resolve/15439cba09df388c51de6e47c6020bc31edab41f/comictextdetector.onnx',
  sha256: '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f',
  bytes: 94_669_756,
};

// The model reads square pages only, and goes on to a text mask and to line borders
// that aren't needed. Read before that, its blocks and lines come for any page.
const BLOCK_LEVELS = [
  {
    output: '647',
    stride: 8,
    anchors: [
      [10, 13],
      [16, 30],
      [33, 23],
    ],
  },
  {
    output: '762',
    stride: 16,
    anchors: [
      [30, 61],
      [62, 45],
      [59, 119],
    ],
  },
  {
    output: '877',
    stride: 32,
    anchors: [
      [116, 90],
      [156, 198],
      [373, 326],
    ],
  },
];
const BLOCK_VALUES = 7;
const LINES_OUTPUT = '1179';
const OUTPUTS = [...BLOCK_LEVELS.map(({ output }) => output), LINES_OUTPUT];
// What the sides of the model's input are multiples of.
const INPUT_STEP = 64;

type ComicTextLanguage = 'eng' | 'ja' | 'unknown';

export interface ComicPageSize {
  width: number;
  height: number;
}

export interface ComicPoint {
  x: number;
  y: number;
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

const BLOCK_CONFIDENCE = 0.4;
const BLOCK_IOU_THRESHOLD = 0.35;
const LINE_CONFIDENCE = 0.5;
const LINE_THRESHOLD = 0.3;
const MAXIMUM_BLOCKS = 300;
const MAXIMUM_LINES = 1_000;

/** The size of the page inside the model's input, which starts with it. */
const getInputSize = (page: ComicPageSize): ComicPageSize => {
  const scale = Math.min(INPUT_SIZE / page.width, INPUT_SIZE / page.height);
  return {
    width: Math.max(1, Math.min(INPUT_SIZE, Math.round(page.width * scale))),
    height: Math.max(1, Math.min(INPUT_SIZE, Math.round(page.height * scale))),
  };
};

const padInputSize = ({ width, height }: ComicPageSize): ComicPageSize => ({
  width: Math.ceil(width / INPUT_STEP) * INPUT_STEP,
  height: Math.ceil(height / INPUT_STEP) * INPUT_STEP,
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const mapInputPoint = (
  x: number,
  y: number,
  page: ComicPageSize,
  input: ComicPageSize,
): ComicPoint => ({
  x: clamp((x * page.width) / input.width, 0, page.width),
  y: clamp((y * page.height) / input.height, 0, page.height),
});

const mapInputBox = (
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  page: ComicPageSize,
  input: ComicPageSize,
): OcrBoundingBox | null => {
  const left = clamp(xMin, 0, input.width);
  const top = clamp(yMin, 0, input.height);
  const right = clamp(xMax, 0, input.width);
  const bottom = clamp(yMax, 0, input.height);
  const box = {
    xMin: (left * page.width) / input.width,
    yMin: (top * page.height) / input.height,
    xMax: (right * page.width) / input.width,
    yMax: (bottom * page.height) / input.height,
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

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

/** Decode the YOLOv5 block levels into page-coordinate text block candidates. */
const decodeBlocks = (
  levels: readonly Float32Array[],
  page: ComicPageSize,
  input: ComicPageSize,
): ComicTextBlock[] => {
  const candidates: ComicTextBlock[] = [];
  const padded = padInputSize(input);
  for (const [level, { stride, anchors }] of BLOCK_LEVELS.entries()) {
    const data = levels[level]!;
    const columns = padded.width / stride;
    const cells = columns * (padded.height / stride);
    for (const [anchor, [anchorWidth, anchorHeight]] of anchors.entries()) {
      for (let cell = 0; cell < cells; cell += 1) {
        const read = (value: number) =>
          sigmoid(data[(anchor * BLOCK_VALUES + value) * cells + cell]!);
        const objectness = read(4);
        if (!(objectness >= BLOCK_CONFIDENCE)) continue;
        const englishScore = read(5);
        const japaneseScore = read(6);
        const score = objectness * Math.max(englishScore, japaneseScore);
        if (!(score >= BLOCK_CONFIDENCE)) continue;
        const centerX = (read(0) * 2 - 0.5 + (cell % columns)) * stride;
        const centerY = (read(1) * 2 - 0.5 + Math.floor(cell / columns)) * stride;
        const halfWidth = ((read(2) * 2) ** 2 * anchorWidth!) / 2;
        const halfHeight = ((read(3) * 2) ** 2 * anchorHeight!) / 2;
        const box = mapInputBox(
          centerX - halfWidth,
          centerY - halfHeight,
          centerX + halfWidth,
          centerY + halfHeight,
          page,
          input,
        );
        if (!box) continue;
        const language = japaneseScore > englishScore ? 'ja' : 'eng';
        candidates.push({ box, score, language, vertical: false, lines: [] });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const accepted: ComicTextBlock[] = [];
  for (const candidate of candidates) {
    const repeated = accepted.some(
      (other) =>
        other.language === candidate.language &&
        intersectionOverUnion(other.box, candidate.box) >= BLOCK_IOU_THRESHOLD,
    );
    if (!repeated) accepted.push(candidate);
    if (accepted.length === MAXIMUM_BLOCKS) break;
  }
  return accepted;
};

const componentPolygon = (
  component: LineComponent,
  page: ComicPageSize,
  input: ComicPageSize,
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
  const polygon = inputPolygon.map(({ x, y }) => mapInputPoint(x, y, page, input));
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
const findLineComponents = (map: Float32Array, width: number): LineComponent[] => {
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
  for (let y = 0; y * width < map.length; y += 1) {
    const row = starts.length;
    const rowEnd = (y + 1) * width;
    let above = rowAbove;
    for (let pixel = y * width; pixel < rowEnd; pixel += 1) {
      if (!(map[pixel]! > LINE_THRESHOLD)) continue;
      const start = pixel;
      let sum = 0;
      for (; pixel < rowEnd && map[pixel]! > LINE_THRESHOLD; pixel += 1) sum += map[pixel]!;
      let root = starts.length;
      starts.push(start);
      ends.push(pixel);
      sums.push(sum);
      parents.push(root);
      while (above < row && ends[above]! + width < start) above += 1;
      for (let run = above; run < row && starts[run]! + width <= pixel; run += 1) {
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
    const y = Math.floor(starts[run]! / width);
    const left = starts[run]! - y * width;
    const right = ends[run]! - 1 - y * width;
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

/** Extract oriented DB text-line polygons. */
export const extractComicLines = (
  data: Float32Array,
  page: ComicPageSize,
  input = getInputSize(page),
): ComicTextLine[] => {
  const lines: ComicTextLine[] = [];
  for (const component of findLineComponents(data, padInputSize(input).width)) {
    const score = component.sum / component.count;
    if (component.maxX === component.minX || component.edges.length === 2) continue;
    if (score < LINE_CONFIDENCE) continue;
    const { polygon, vertical } = componentPolygon(component, page, input);
    lines.push({ polygon, box: getLineBox(polygon), score, vertical });
  }
  return lines
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.box.yMin - right.box.yMin ||
        left.box.xMin - right.box.xMin,
    )
    .slice(0, MAXIMUM_LINES);
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
const groupComicText = (
  blocks: readonly ComicTextBlock[],
  lines: readonly ComicTextLine[],
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
    } else {
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
    if (block.lines.length === 0) block.lines.push(rectangleLine(block.box, block.score));
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

/** The text blocks of the model's outputs, the block levels first. */
export const postprocessComicDetectorOutputs = (
  outputs: readonly Float32Array[],
  page: ComicPageSize,
): ComicTextBlock[] => {
  const input = getInputSize(page);
  const blocks = decodeBlocks(outputs, page, input);
  const lines = extractComicLines(outputs[BLOCK_LEVELS.length]!, page, input);
  return groupComicText(blocks, lines, page);
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

interface Model {
  runtime: OnnxRuntime;
  session: InferenceSession;
}

const loadModel = async (
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Model> => {
  const [runtime, model] = await Promise.all([
    loadOnnxRuntime(),
    loadModelAsset(MODEL, {
      signal,
      onProgress: (loaded) => onProgress?.(loaded / MODEL.bytes),
    }),
  ]);
  signal.throwIfAborted();
  return { runtime, session: await createOnnxSession(runtime, trimOnnxModel(model, OUTPUTS)) };
};

export class ComicTextDetector {
  readonly #model: LazyModel<Model>;

  constructor(options: { onDownloadProgress?: (progress: number) => void } = {}) {
    this.#model = new LazyModel(
      (signal) => loadModel(signal, options.onDownloadProgress),
      ({ session }) => session.release(),
    );
  }

  detect(source: CanvasImageSource, page: ComicPageSize): Promise<ComicTextBlock[]> {
    return this.#model.use((model) => this.#detect(model, source, page));
  }

  terminate(): Promise<void> {
    return this.#model.terminate();
  }

  async #detect(
    { runtime, session }: Model,
    source: CanvasImageSource,
    page: ComicPageSize,
  ): Promise<ComicTextBlock[]> {
    const input = getInputSize(page);
    const { width, height } = padInputSize(input);
    const canvas = createOcrCanvas(width, height, isHtmlCanvas(source) ? source : undefined);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Comic text detector could not create a canvas context');
    context.drawImage(source, 0, 0, input.width, input.height);
    const { data: pixels } = context.getImageData(0, 0, width, height);
    const shape = [1, 3, height, width];
    const images = new runtime.Tensor('float32', makeImageTensor(pixels), shape);
    const outputs = await session.run({ images });
    this.#model.throwIfTerminated();
    return postprocessComicDetectorOutputs(
      OUTPUTS.map((name) => outputs[name]!.data as Float32Array),
      page,
    );
  }
}
