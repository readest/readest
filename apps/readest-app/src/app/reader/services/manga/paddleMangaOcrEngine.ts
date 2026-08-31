import { MangaDetector, type MangaBubbleRegion } from '@/app/reader/services/manga/mangaDetector';
import {
  fetchVerifiedModelAsset,
  type ModelDownloadProgress,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';
import type {
  OcrBoundingBox,
  OcrPage,
  OcrTextBlock,
  OcrWritingMode,
} from '@/app/reader/services/ocr/types';

const MODEL_REVISION = '1ef01f78c59f6f66389c9722fd2d0ab761680ea9';
const DICTIONARY_REVISION = 'e5046169b225bcdfbe25d45b4e809ff0f1a69c2c';
const RECOGNITION_HEIGHT = 48;
const MINIMUM_INPUT_WIDTH = 320;
const MAXIMUM_INPUT_WIDTH = 3_200;
const MAXIMUM_PAGE_PIXELS = 4_000_000;
const MAXIMUM_BACKGROUND_SAMPLES = 12_000;
const DEFAULT_MINIMUM_CONFIDENCE = 35;
const MAXIMUM_RECOGNITION_VIEW_CONFIDENCE_GAP = 10;
const MAXIMUM_IGNORED_PART_THICKNESS_RATIO = 0.5;

type StaticModelAsset = Omit<VerifiedModelAsset, 'onProgress' | 'signal'>;

export const PADDLE_MANGA_OCR_MODEL_ASSET: Readonly<StaticModelAsset> = {
  url: `https://huggingface.co/fumetodev/PP-OCRv6_small_rec_manga_ONNX/resolve/${MODEL_REVISION}/ppocr-rec-v6-small-manga.onnx`,
  sha256: 'c5cc5038a98c3df3e2d37de5716f603e2b0bcd3536c74078fdd91876a48a25ef',
  maximumDownloadBytes: 22_000_000,
  maximumResultBytes: 22_000_000,
};

export const PADDLE_MANGA_OCR_DICTIONARY_ASSET: Readonly<StaticModelAsset> = {
  url: `https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/${DICTIONARY_REVISION}/ppocr/utils/dict/ppocrv6_dict.txt`,
  sha256: 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d',
  maximumDownloadBytes: 80_000,
  maximumResultBytes: 80_000,
};

interface PageIdentity {
  pageIndex: number;
  width: number;
  height: number;
}

interface LoadedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface PreparedPage {
  image: HTMLCanvasElement;
  page: PageIdentity;
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface PixelRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ImageView extends PixelRectangle {}

interface PaddleTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface PaddleMangaOcrSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, PaddleTensor>>;
  release: () => Promise<void>;
}

export interface PaddleMangaOcrRuntime {
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
    ) => Promise<PaddleMangaOcrSession>;
  };
}

interface BubbleDetector {
  detect: (
    source: CanvasImageSource,
    page: Pick<PageIdentity, 'width' | 'height'>,
  ) => Promise<readonly MangaBubbleRegion[]>;
  terminate: () => Promise<void>;
}

interface PaddleMangaOcrEngineDependencies {
  createCanvas: (source?: HTMLCanvasElement) => HTMLCanvasElement;
  createDetector: (
    onDownloadProgress?: (progress: ModelDownloadProgress) => void,
  ) => BubbleDetector;
  loadDictionary: (
    signal?: AbortSignal,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ) => Promise<ArrayBuffer>;
  loadImage: (source: string) => Promise<LoadedImage>;
  loadModel: (
    signal?: AbortSignal,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ) => Promise<ArrayBuffer>;
  loadRuntime: () => Promise<PaddleMangaOcrRuntime>;
}

export interface PaddleMangaOcrEngineOptions {
  minimumConfidence?: number;
  onProgress?: (progress: { status: string; progress: number }) => void;
}

interface Recognizer {
  characters: readonly string[];
  runtime: PaddleMangaOcrRuntime;
  session: PaddleMangaOcrSession;
}

interface RecognizedText {
  text: string;
  confidence: number;
}

interface RecognizedTextPart {
  box: OcrBoundingBox;
  result: RecognizedText;
}

const getCanvasDocument = (source?: HTMLCanvasElement): Document =>
  source?.ownerDocument.defaultView?.frameElement?.ownerDocument ??
  source?.ownerDocument ??
  document;

const defaultCreateCanvas = (source?: HTMLCanvasElement): HTMLCanvasElement =>
  getCanvasDocument(source).createElement('canvas');

const defaultCreateDetector = (
  onDownloadProgress?: (progress: ModelDownloadProgress) => void,
): BubbleDetector => new MangaDetector({ onDownloadProgress });

const defaultLoadImage = (source: string): Promise<LoadedImage> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Manga OCR could not decode the page image'));
    image.src = source;
  });

const defaultLoadRuntime = async (): Promise<PaddleMangaOcrRuntime> =>
  (await import('onnxruntime-web/wasm')) as unknown as PaddleMangaOcrRuntime;

const defaultLoadModel: PaddleMangaOcrEngineDependencies['loadModel'] = (signal, onProgress) =>
  fetchVerifiedModelAsset({ ...PADDLE_MANGA_OCR_MODEL_ASSET, signal, onProgress });

const defaultLoadDictionary: PaddleMangaOcrEngineDependencies['loadDictionary'] = (
  signal,
  onProgress,
) => fetchVerifiedModelAsset({ ...PADDLE_MANGA_OCR_DICTIONARY_ASSET, signal, onProgress });

const isHtmlCanvas = (source: string | HTMLCanvasElement): source is HTMLCanvasElement =>
  typeof source === 'object' && source !== null && source.tagName === 'CANVAS';

const validateDimensions = (width: number, height: number): void => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Manga OCR requires positive integer page dimensions');
  }
};

const toRectangle = (
  box: OcrBoundingBox,
  page: Pick<PageIdentity, 'width' | 'height'>,
): PixelRectangle | null => {
  const left = Math.max(0, Math.floor(box.xMin));
  const top = Math.max(0, Math.floor(box.yMin));
  const right = Math.min(page.width, Math.ceil(box.xMax));
  const bottom = Math.min(page.height, Math.ceil(box.yMax));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
};

const unionBoxes = (boxes: readonly OcrBoundingBox[]): OcrBoundingBox => ({
  xMin: Math.min(...boxes.map((box) => box.xMin)),
  yMin: Math.min(...boxes.map((box) => box.yMin)),
  xMax: Math.max(...boxes.map((box) => box.xMax)),
  yMax: Math.max(...boxes.map((box) => box.yMax)),
});

const textPartThickness = (box: OcrBoundingBox, writingMode: OcrWritingMode): number =>
  writingMode === 'vertical-rl' ? box.xMax - box.xMin : box.yMax - box.yMin;

const chooseRecognitionView = (results: readonly RecognizedText[]): RecognizedText => {
  const maximumConfidence = Math.max(...results.map(({ confidence }) => confidence));
  return results
    .filter(
      ({ confidence }) => confidence >= maximumConfidence - MAXIMUM_RECOGNITION_VIEW_CONFIDENCE_GAP,
    )
    .reduce<RecognizedText>(
      (best, result) => {
        const bestLength = Array.from(best.text.replace(/\s/gu, '')).length;
        const resultLength = Array.from(result.text.replace(/\s/gu, '')).length;
        return resultLength > bestLength ||
          (resultLength === bestLength && result.confidence > best.confidence)
          ? result
          : best;
      },
      { text: '', confidence: 0 },
    );
};

const pixelOffset = (image: Pick<RgbaImage, 'width'>, x: number, y: number): number =>
  (y * image.width + x) * 4;

const luminanceAt = (image: RgbaImage, x: number, y: number): number => {
  const offset = pixelOffset(image, x, y);
  return (
    image.data[offset]! * 0.2126 +
    image.data[offset + 1]! * 0.7152 +
    image.data[offset + 2]! * 0.0722
  );
};

interface InkRun {
  start: number;
  end: number;
}

const splitTextBox = (
  image: RgbaImage,
  box: OcrBoundingBox,
  writingMode: OcrWritingMode,
): OcrBoundingBox[] => {
  const rectangle = toRectangle(box, image);
  const vertical = writingMode === 'vertical-rl';
  const length = vertical ? rectangle?.width : rectangle?.height;
  const crossLength = vertical ? rectangle?.height : rectangle?.width;
  if (!rectangle || !length || !crossLength || length < 24) return [box];
  const crossInset = Math.min(
    Math.floor(crossLength / 4),
    Math.max(1, Math.round(crossLength * 0.08)),
  );
  const density = Array.from({ length }, (_, position) => {
    let ink = 0;
    for (let cross = crossInset; cross < crossLength - crossInset; cross += 1) {
      const x = vertical ? rectangle.left + position : rectangle.left + cross;
      const y = vertical ? rectangle.top + cross : rectangle.top + position;
      if (luminanceAt(image, x, y) < 128) ink += 1;
    }
    return ink;
  });
  const smoothingRadius = Math.max(1, Math.round(length * 0.012));
  const smoothed = density.map((_, position) => {
    let sum = 0;
    let count = 0;
    for (
      let sample = Math.max(0, position - smoothingRadius);
      sample <= Math.min(length - 1, position + smoothingRadius);
      sample += 1
    ) {
      sum += density[sample]!;
      count += 1;
    }
    return sum / count;
  });
  const peak = Math.max(...smoothed);
  if (!Number.isFinite(peak) || peak <= 0) return [box];
  const threshold = Math.max(2, crossLength * 0.012, peak * 0.14);
  const runs: InkRun[] = [];
  let start = -1;
  for (let position = 0; position <= length; position += 1) {
    if (position < length && smoothed[position]! >= threshold) {
      if (start < 0) start = position;
    } else if (start >= 0) {
      runs.push({ start, end: position - 1 });
      start = -1;
    }
  }

  const maximumGap = Math.max(2, Math.round(length * 0.012));
  const merged: InkRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && run.start - previous.end - 1 <= maximumGap) previous.end = run.end;
    else merged.push({ ...run });
  }
  const edgeWidth = Math.max(2, Math.round(length * 0.04));
  const minimumRunWidth = Math.max(2, Math.round(length * 0.04));
  const textRuns = merged.filter((run) => {
    const width = run.end - run.start + 1;
    const touchesEdge = run.start <= edgeWidth || run.end >= length - 1 - edgeWidth;
    return width >= minimumRunWidth && (!touchesEdge || width >= length * 0.14);
  });
  if (!textRuns.length || textRuns.length > 8) return [box];
  if (textRuns.length === 1 && textRuns[0]!.end - textRuns[0]!.start + 1 >= length * 0.8) {
    return [box];
  }
  return textRuns
    .map((run) => {
      const padding = Math.max(2, Math.round((run.end - run.start + 1) * 0.25));
      const start = Math.max(0, run.start - padding);
      const end = Math.min(length, run.end + 1 + padding);
      return vertical
        ? {
            xMin: rectangle.left + start,
            yMin: rectangle.top,
            xMax: rectangle.left + end,
            yMax: rectangle.top + rectangle.height,
          }
        : {
            xMin: rectangle.left,
            yMin: rectangle.top + start,
            xMax: rectangle.left + rectangle.width,
            yMax: rectangle.top + end,
          };
    })
    .sort((left, right) => (vertical ? right.xMin - left.xMin : left.yMin - right.yMin));
};

const cropRgba = (image: RgbaImage, box: OcrBoundingBox): RgbaImage | null => {
  const rectangle = toRectangle(box, image);
  if (!rectangle) return null;
  const data = new Uint8ClampedArray(rectangle.width * rectangle.height * 4);
  for (let y = 0; y < rectangle.height; y += 1) {
    const sourceStart = pixelOffset(image, rectangle.left, rectangle.top + y);
    const sourceEnd = sourceStart + rectangle.width * 4;
    data.set(image.data.subarray(sourceStart, sourceEnd), y * rectangle.width * 4);
  }
  return { data, width: rectangle.width, height: rectangle.height };
};

export const rotateRgbaCounterclockwise = (source: RgbaImage): RgbaImage => {
  const data = new Uint8ClampedArray(source.data.length);
  const width = source.height;
  const height = source.width;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = source.width - 1 - y;
      const sourceY = x;
      const sourceOffset = pixelOffset(source, sourceX, sourceY);
      const targetOffset = (y * width + x) * 4;
      data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { data, width, height };
};

const dominantBorderColor = (image: RgbaImage): [number, number, number] => {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== image.width - 1 && y !== image.height - 1) continue;
      const offset = pixelOffset(image, x, y);
      const red = image.data[offset]!;
      const green = image.data[offset + 1]!;
      const blue = image.data[offset + 2]!;
      const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
      const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      buckets.set(key, bucket);
    }
  }
  const dominant = [...buckets.values()].reduce<
    { count: number; red: number; green: number; blue: number } | undefined
  >((largest, bucket) => (!largest || bucket.count > largest.count ? bucket : largest), undefined);
  if (!dominant) return [255, 255, 255];
  return [
    dominant.red / dominant.count,
    dominant.green / dominant.count,
    dominant.blue / dominant.count,
  ];
};

const getRecognitionViews = (image: RgbaImage): ImageView[] => {
  const [backgroundRed, backgroundGreen, backgroundBlue] = dominantBorderColor(image);
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image, x, y);
      const redDifference = image.data[offset]! - backgroundRed;
      const greenDifference = image.data[offset + 1]! - backgroundGreen;
      const blueDifference = image.data[offset + 2]! - backgroundBlue;
      if (
        redDifference * redDifference +
          greenDifference * greenDifference +
          blueDifference * blueDifference <
        40 * 40
      ) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const tight =
    right >= left && bottom >= top
      ? { left, top, width: right - left + 1, height: bottom - top + 1 }
      : { left: 0, top: 0, width: image.width, height: image.height };
  const padding = Math.max(1, Math.round(Math.min(tight.width, tight.height) * 0.1));
  const paddedLeft = Math.max(0, tight.left - padding);
  const paddedTop = Math.max(0, tight.top - padding);
  const paddedRight = Math.min(image.width, tight.left + tight.width + padding);
  const paddedBottom = Math.min(image.height, tight.top + tight.height + padding);
  const inset = Math.max(1, Math.round(Math.min(tight.width, tight.height) * 0.06));
  const inner =
    tight.width > inset * 2 && tight.height > inset * 2
      ? {
          left: tight.left + inset,
          top: tight.top + inset,
          width: tight.width - inset * 2,
          height: tight.height - inset * 2,
        }
      : tight;
  return [
    tight,
    {
      left: paddedLeft,
      top: paddedTop,
      width: paddedRight - paddedLeft,
      height: paddedBottom - paddedTop,
    },
    inner,
  ];
};

const getPixelChannel = (image: RgbaImage, x: number, y: number, channel: number): number => {
  const offset = pixelOffset(image, x, y);
  const alpha = image.data[offset + 3]! / 255;
  return image.data[offset + channel]! * alpha + 255 * (1 - alpha);
};

const makeRecognitionInput = (
  image: RgbaImage,
  views: readonly ImageView[],
): { data: Float32Array; dimensions: number[] } => {
  const resizedWidths = views.map((view) =>
    Math.max(
      1,
      Math.min(MAXIMUM_INPUT_WIDTH, Math.ceil((RECOGNITION_HEIGHT * view.width) / view.height)),
    ),
  );
  const width = Math.max(MINIMUM_INPUT_WIDTH, ...resizedWidths);
  const channelSize = RECOGNITION_HEIGHT * width;
  const batchSize = channelSize * 3;
  const data = new Float32Array(views.length * batchSize);

  for (const [item, view] of views.entries()) {
    const resizedWidth = resizedWidths[item]!;
    for (let y = 0; y < RECOGNITION_HEIGHT; y += 1) {
      const sourceY = view.top + ((y + 0.5) * view.height) / RECOGNITION_HEIGHT - 0.5;
      const y0 = Math.max(view.top, Math.floor(sourceY));
      const y1 = Math.min(view.top + view.height - 1, y0 + 1);
      const yWeight = sourceY - Math.floor(sourceY);
      for (let x = 0; x < resizedWidth; x += 1) {
        const sourceX = view.left + ((x + 0.5) * view.width) / resizedWidth - 0.5;
        const x0 = Math.max(view.left, Math.floor(sourceX));
        const x1 = Math.min(view.left + view.width - 1, x0 + 1);
        const xWeight = sourceX - Math.floor(sourceX);
        for (let channel = 0; channel < 3; channel += 1) {
          const topValue =
            getPixelChannel(image, x0, y0, channel) * (1 - xWeight) +
            getPixelChannel(image, x1, y0, channel) * xWeight;
          const bottomValue =
            getPixelChannel(image, x0, y1, channel) * (1 - xWeight) +
            getPixelChannel(image, x1, y1, channel) * xWeight;
          const value = topValue * (1 - yWeight) + bottomValue * yWeight;
          data[item * batchSize + channel * channelSize + y * width + x] = value / 127.5 - 1;
        }
      }
    }
  }
  return { data, dimensions: [views.length, 3, RECOGNITION_HEIGHT, width] };
};

export const decodePaddleMangaOcr = (
  values: ArrayLike<number>,
  dimensions: readonly number[],
  characters: readonly string[],
): RecognizedText[] => {
  if (
    dimensions.length !== 3 ||
    !dimensions.every((value) => Number.isSafeInteger(value) && value > 0)
  ) {
    throw new Error('Paddle manga OCR returned invalid output dimensions');
  }
  const [batch = 0, steps = 0, classes = 0] = dimensions;
  if (classes !== characters.length + 1 || values.length !== batch * steps * classes) {
    throw new Error('Paddle manga OCR returned invalid output data');
  }

  const results: RecognizedText[] = [];
  for (let item = 0; item < batch; item += 1) {
    let previous = -1;
    const text: string[] = [];
    const scores: number[] = [];
    for (let step = 0; step < steps; step += 1) {
      const offset = (item * steps + step) * classes;
      let index = 0;
      let score = Number(values[offset]);
      for (let candidate = 1; candidate < classes; candidate += 1) {
        const candidateScore = Number(values[offset + candidate]);
        if (candidateScore > score) {
          index = candidate;
          score = candidateScore;
        }
      }
      if (index > 0 && index !== previous) {
        text.push(characters[index - 1]!);
        scores.push(score);
      }
      previous = index;
    }
    const confidence = scores.length
      ? (scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100
      : 0;
    results.push({ text: text.join(''), confidence: Math.min(100, Math.max(0, confidence)) });
  }
  return results;
};

const isInsideBox = (x: number, y: number, box: OcrBoundingBox): boolean =>
  x >= box.xMin && x <= box.xMax && y >= box.yMin && y <= box.yMax;

const sampleBackgroundChannels = (
  image: RgbaImage,
  bubbleBox: OcrBoundingBox,
  textBoxes: readonly OcrBoundingBox[],
): [number, number, number] => {
  const rectangle = toRectangle(bubbleBox, image);
  if (!rectangle) return [255, 255, 255];
  const textBounds = toRectangle(unionBoxes(textBoxes), image);
  const padding = textBounds
    ? Math.max(4, Math.round(Math.max(textBounds.width, textBounds.height) * 0.45))
    : 0;
  const nearText = textBounds
    ? {
        left: Math.max(rectangle.left, textBounds.left - padding),
        top: Math.max(rectangle.top, textBounds.top - padding),
        width:
          Math.min(rectangle.left + rectangle.width, textBounds.left + textBounds.width + padding) -
          Math.max(rectangle.left, textBounds.left - padding),
        height:
          Math.min(rectangle.top + rectangle.height, textBounds.top + textBounds.height + padding) -
          Math.max(rectangle.top, textBounds.top - padding),
      }
    : rectangle;

  const sample = (area: PixelRectangle) => {
    const stride = Math.max(
      1,
      Math.ceil(Math.sqrt((area.width * area.height) / MAXIMUM_BACKGROUND_SAMPLES)),
    );
    const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
    for (let y = area.top; y < area.top + area.height; y += stride) {
      for (let x = area.left; x < area.left + area.width; x += stride) {
        if (textBoxes.some((box) => isInsideBox(x, y, box))) continue;
        const offset = pixelOffset(image, x, y);
        if (image.data[offset + 3]! < 128) continue;
        const red = image.data[offset]!;
        const green = image.data[offset + 1]!;
        const blue = image.data[offset + 2]!;
        const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
        const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
        bucket.count += 1;
        bucket.red += red;
        bucket.green += green;
        bucket.blue += blue;
        buckets.set(key, bucket);
      }
    }
    return [...buckets.values()].reduce<
      { count: number; red: number; green: number; blue: number } | undefined
    >(
      (largest, bucket) => (!largest || bucket.count > largest.count ? bucket : largest),
      undefined,
    );
  };

  const dominant = sample(nearText) ?? sample(rectangle);
  if (!dominant) return [255, 255, 255];
  return [
    Math.round(dominant.red / dominant.count),
    Math.round(dominant.green / dominant.count),
    Math.round(dominant.blue / dominant.count),
  ];
};

const sampleBackground = (
  image: RgbaImage,
  bubbleBox: OcrBoundingBox,
  textBoxes: readonly OcrBoundingBox[],
): string => {
  const [red, green, blue] = sampleBackgroundChannels(image, bubbleBox, textBoxes);
  return `rgb(${red} ${green} ${blue})`;
};

export const findSafeBubbleContentBox = (
  image: RgbaImage,
  bubbleBox: OcrBoundingBox,
  textBoxes: readonly OcrBoundingBox[],
): OcrBoundingBox | null => {
  const bubble = toRectangle(bubbleBox, image);
  if (!bubble || !textBoxes.length) return null;
  const source = toRectangle(unionBoxes(textBoxes), image);
  if (!source) return null;
  const sourceLeft = Math.max(bubble.left, source.left);
  const sourceTop = Math.max(bubble.top, source.top);
  const sourceRight = Math.min(bubble.left + bubble.width, source.left + source.width);
  const sourceBottom = Math.min(bubble.top + bubble.height, source.top + source.height);
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) return null;

  const cellSize = Math.max(1, Math.ceil(Math.max(bubble.width, bubble.height) / 128));
  const columns = Math.ceil(bubble.width / cellSize);
  const rows = Math.ceil(bubble.height / cellSize);
  const [backgroundRed, backgroundGreen, backgroundBlue] = sampleBackgroundChannels(
    image,
    bubbleBox,
    textBoxes,
  );
  const unsafePrefix = new Uint32Array((columns + 1) * (rows + 1));
  const prefixWidth = columns + 1;
  const maximumColorDistanceSquared = 58 * 58;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(image.width - 1, bubble.left + column * cellSize + cellSize / 2);
      const y = Math.min(image.height - 1, bubble.top + row * cellSize + cellSize / 2);
      const offset = pixelOffset(image, Math.floor(x), Math.floor(y));
      const redDifference = image.data[offset]! - backgroundRed;
      const greenDifference = image.data[offset + 1]! - backgroundGreen;
      const blueDifference = image.data[offset + 2]! - backgroundBlue;
      const colorDistanceSquared =
        redDifference * redDifference +
        greenDifference * greenDifference +
        blueDifference * blueDifference;
      const safe =
        textBoxes.some((box) => isInsideBox(x, y, box)) ||
        (image.data[offset + 3]! >= 128 && colorDistanceSquared <= maximumColorDistanceSquared);
      const prefixIndex = (row + 1) * prefixWidth + column + 1;
      unsafePrefix[prefixIndex] =
        Number(!safe) +
        unsafePrefix[prefixIndex - 1]! +
        unsafePrefix[prefixIndex - prefixWidth]! -
        unsafePrefix[prefixIndex - prefixWidth - 1]!;
    }
  }

  const isSafeRectangle = (left: number, top: number, right: number, bottom: number): boolean => {
    const unsafe =
      unsafePrefix[bottom * prefixWidth + right]! -
      unsafePrefix[top * prefixWidth + right]! -
      unsafePrefix[bottom * prefixWidth + left]! +
      unsafePrefix[top * prefixWidth + left]!;
    return unsafe === 0;
  };
  let left = Math.max(0, Math.floor((sourceLeft - bubble.left) / cellSize));
  let top = Math.max(0, Math.floor((sourceTop - bubble.top) / cellSize));
  let right = Math.min(columns, Math.ceil((sourceRight - bubble.left) / cellSize));
  let bottom = Math.min(rows, Math.ceil((sourceBottom - bubble.top) / cellSize));
  if (!isSafeRectangle(left, top, right, bottom)) {
    return {
      xMin: sourceLeft,
      yMin: sourceTop,
      xMax: sourceRight,
      yMax: sourceBottom,
    };
  }

  for (;;) {
    const candidates = [
      left > 0 ? { left: left - 1, top, right, bottom } : null,
      top > 0 ? { left, top: top - 1, right, bottom } : null,
      right < columns ? { left, top, right: right + 1, bottom } : null,
      bottom < rows ? { left, top, right, bottom: bottom + 1 } : null,
    ]
      .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
      .filter((candidate) =>
        isSafeRectangle(candidate.left, candidate.top, candidate.right, candidate.bottom),
      )
      .sort(
        (first, second) =>
          (second.right - second.left) * (second.bottom - second.top) -
          (first.right - first.left) * (first.bottom - first.top),
      );
    const next = candidates[0];
    if (!next) break;
    ({ left, top, right, bottom } = next);
  }

  return {
    xMin: bubble.left + left * cellSize,
    yMin: bubble.top + top * cellSize,
    xMax: Math.min(bubble.left + bubble.width, bubble.left + right * cellSize),
    yMax: Math.min(bubble.top + bubble.height, bubble.top + bottom * cellSize),
  };
};

const parseDictionary = (buffer: ArrayBuffer): string[] => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/\r/gu, '');
  const characters = text.split('\n');
  if (characters.at(-1) === '') characters.pop();
  if (!characters.length || characters.some((character) => !character)) {
    throw new Error('Paddle manga OCR dictionary is malformed');
  }
  return [...characters, ' '];
};

export class PaddleMangaOcrEngine {
  readonly #minimumConfidence: number;
  readonly #onProgress?: (progress: { status: string; progress: number }) => void;
  readonly #createCanvas: PaddleMangaOcrEngineDependencies['createCanvas'];
  readonly #createDetector: PaddleMangaOcrEngineDependencies['createDetector'];
  readonly #loadDictionary: PaddleMangaOcrEngineDependencies['loadDictionary'];
  readonly #loadImage: PaddleMangaOcrEngineDependencies['loadImage'];
  readonly #loadModel: PaddleMangaOcrEngineDependencies['loadModel'];
  readonly #loadRuntime: PaddleMangaOcrEngineDependencies['loadRuntime'];
  readonly #abortController = new AbortController();
  readonly #activeRuns = new Set<Promise<Record<string, PaddleTensor>>>();
  #detector: BubbleDetector | null = null;
  #recognizerPromise: Promise<Recognizer> | null = null;
  #runtimePromise: Promise<PaddleMangaOcrRuntime> | null = null;
  #terminated = false;

  constructor(
    options: PaddleMangaOcrEngineOptions = {},
    dependencies: Partial<PaddleMangaOcrEngineDependencies> = {},
  ) {
    this.#minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE;
    this.#onProgress = options.onProgress;
    this.#createCanvas = dependencies.createCanvas ?? defaultCreateCanvas;
    this.#createDetector = dependencies.createDetector ?? defaultCreateDetector;
    this.#loadDictionary = dependencies.loadDictionary ?? defaultLoadDictionary;
    this.#loadImage = dependencies.loadImage ?? defaultLoadImage;
    this.#loadModel = dependencies.loadModel ?? defaultLoadModel;
    this.#loadRuntime = dependencies.loadRuntime ?? defaultLoadRuntime;
  }

  async recognize(source: string | HTMLCanvasElement, page: PageIdentity): Promise<OcrPage> {
    validateDimensions(page.width, page.height);
    if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
    const prepared = await this.#preparePage(source, page);
    if (this.#terminated) throw new Error('Manga OCR engine has been terminated');

    this.#onProgress?.({ status: 'detecting speech bubbles', progress: 0 });
    const regions = await this.#getDetector().detect(prepared.image, prepared.page);
    this.#onProgress?.({ status: 'detecting speech bubbles', progress: 1 });
    if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
    if (!regions.length) return { ...prepared.page, blocks: [] };

    const context = prepared.image.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Manga OCR could not read the page canvas');
    const imageData = context.getImageData(0, 0, prepared.page.width, prepared.page.height);
    const image = {
      data: imageData.data,
      width: prepared.page.width,
      height: prepared.page.height,
    };
    if (image.data.length !== image.width * image.height * 4) {
      throw new Error('Manga OCR received incomplete page pixels');
    }

    const recognizer = await this.#getRecognizer();
    const preparedRegions = regions.map((region) => ({
      region,
      boxes: region.textBoxes.flatMap((textBox) =>
        splitTextBox(image, textBox, region.writingMode),
      ),
    }));
    const totalBoxes = preparedRegions.reduce((sum, { boxes }) => sum + boxes.length, 0);
    let completedBoxes = 0;
    this.#onProgress?.({ status: 'recognizing speech bubbles', progress: 0 });
    const blocks: OcrTextBlock[] = [];
    for (const { region, boxes } of preparedRegions) {
      const recognizedParts: RecognizedTextPart[] = [];
      for (const textBox of boxes) {
        if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
        const result = await this.#recognizeTextBox(recognizer, image, textBox, region.writingMode);
        recognizedParts.push({ box: textBox, result });
        completedBoxes += 1;
        this.#onProgress?.({
          status: 'recognizing speech bubbles',
          progress: Math.min(1, completedBoxes / Math.max(1, totalBoxes)),
        });
      }
      const readableParts = recognizedParts.filter(
        ({ result }) => result.text && result.confidence >= this.#minimumConfidence,
      );
      if (!readableParts.length) continue;
      const minimumReadableThickness = Math.min(
        ...readableParts.map(({ box }) => textPartThickness(box, region.writingMode)),
      );
      const hasUnreadableText = recognizedParts.some(
        ({ box, result }) =>
          (!result.text || result.confidence < this.#minimumConfidence) &&
          textPartThickness(box, region.writingMode) >
            minimumReadableThickness * MAXIMUM_IGNORED_PART_THICKNESS_RATIO,
      );
      if (hasUnreadableText) continue;
      const parts = readableParts.map(({ result }) => result);
      blocks.push({
        id: region.id,
        text: parts.map((part) => part.text).join('\n'),
        confidence:
          parts.reduce((sum, part) => sum + part.confidence, 0) / Math.max(1, parts.length),
        box: unionBoxes(boxes),
        bubbleBox: region.bubbleBox,
        contentBox:
          findSafeBubbleContentBox(image, region.bubbleBox, region.textBoxes) ?? undefined,
        maskBoxes: region.textBoxes,
        backgroundColor: sampleBackground(image, region.bubbleBox, region.textBoxes),
        writingMode: region.writingMode,
      });
    }
    this.#onProgress?.({ status: 'recognizing speech bubbles', progress: 1 });
    return { ...prepared.page, blocks };
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController.abort();
    const detector = this.#detector;
    const recognizerPromise = this.#recognizerPromise;
    this.#detector = null;
    this.#recognizerPromise = null;
    const releaseRecognizer = recognizerPromise?.then(
      async ({ session }) => {
        await Promise.allSettled([...this.#activeRuns]);
        await session.release().catch(() => undefined);
      },
      () => undefined,
    );
    await Promise.all([detector?.terminate(), releaseRecognizer]);
  }

  async #preparePage(
    source: string | HTMLCanvasElement,
    page: PageIdentity,
  ): Promise<PreparedPage> {
    let canvasSource: HTMLCanvasElement | undefined;
    let loaded: LoadedImage;
    if (isHtmlCanvas(source)) {
      canvasSource = source;
      loaded = { image: source, width: source.width, height: source.height };
    } else {
      loaded = await this.#loadImage(source);
    }
    validateDimensions(loaded.width, loaded.height);
    const scale = Math.min(1, Math.sqrt(MAXIMUM_PAGE_PIXELS / (loaded.width * loaded.height)));
    const width = Math.max(1, Math.floor(loaded.width * scale));
    const height = Math.max(1, Math.floor(loaded.height * scale));
    if (canvasSource && width === loaded.width && height === loaded.height) {
      return { image: canvasSource, page: { ...page, width, height } };
    }
    const image = this.#createCanvas(canvasSource);
    image.width = width;
    image.height = height;
    const context = image.getContext('2d');
    if (!context) throw new Error('Manga OCR could not prepare the page canvas');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(loaded.image, 0, 0, width, height);
    return { image, page: { ...page, width, height } };
  }

  #getDetector(): BubbleDetector {
    if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
    this.#detector ??= this.#createDetector(({ loaded, total }) => {
      this.#onProgress?.({
        status: 'loading manga detector',
        progress: total && total > 0 ? Math.min(1, loaded / total) : 0,
      });
    });
    return this.#detector;
  }

  #getRuntime(): Promise<PaddleMangaOcrRuntime> {
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

  #getRecognizer(): Promise<Recognizer> {
    if (this.#terminated) return Promise.reject(new Error('Manga OCR engine has been terminated'));
    if (this.#recognizerPromise) return this.#recognizerPromise;
    const progress: ModelDownloadProgress[] = [{ loaded: 0 }, { loaded: 0 }];
    const updateProgress = (index: number, next: ModelDownloadProgress) => {
      progress[index] = next;
      const loaded = progress.reduce((sum, item) => sum + item.loaded, 0);
      const total = progress.reduce((sum, item) => sum + (item.total ?? 0), 0);
      this.#onProgress?.({
        status: 'loading manga OCR model',
        progress:
          progress.every((item) => item.total !== undefined) && total > 0 ? loaded / total : 0,
      });
    };
    const recognizerPromise = Promise.all([
      this.#getRuntime(),
      this.#loadModel(this.#abortController.signal, (next) => updateProgress(0, next)),
      this.#loadDictionary(this.#abortController.signal, (next) => updateProgress(1, next)),
    ]).then(async ([runtime, model, dictionary]) => {
      if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = true;
      runtime.env.wasm.wasmPaths = '/vendor/onnxruntime/';
      const session = await runtime.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
      });
      if (this.#terminated) {
        await session.release();
        throw new Error('Manga OCR engine has been terminated');
      }
      return { characters: parseDictionary(dictionary), runtime, session };
    });
    this.#recognizerPromise = recognizerPromise;
    void recognizerPromise.catch(() => {
      if (this.#recognizerPromise === recognizerPromise && !this.#terminated) {
        this.#recognizerPromise = null;
      }
    });
    return recognizerPromise;
  }

  async #recognizeTextBox(
    recognizer: Recognizer,
    page: RgbaImage,
    box: OcrBoundingBox,
    writingMode: OcrWritingMode,
  ): Promise<RecognizedText> {
    const cropped = cropRgba(page, box);
    if (!cropped) return { text: '', confidence: 0 };
    const image = writingMode === 'vertical-rl' ? rotateRgbaCounterclockwise(cropped) : cropped;
    const input = makeRecognitionInput(image, getRecognitionViews(image));
    let outputs: Record<string, PaddleTensor>;
    const run = recognizer.session.run({
      x: new recognizer.runtime.Tensor('float32', input.data, input.dimensions),
    });
    this.#activeRuns.add(run);
    try {
      outputs = await run;
    } catch (error) {
      await this.#discardRecognizer(recognizer);
      throw error;
    } finally {
      this.#activeRuns.delete(run);
    }
    if (this.#terminated) throw new Error('Manga OCR engine has been terminated');
    const output = outputs['fetch_name_0'] ?? Object.values(outputs)[0];
    if (!output) throw new Error('Paddle manga OCR returned no output');
    const results = decodePaddleMangaOcr(output.data, output.dims, recognizer.characters);
    return chooseRecognitionView(results);
  }

  async #discardRecognizer(recognizer: Recognizer): Promise<void> {
    const recognizerPromise = this.#recognizerPromise;
    if (!recognizerPromise) return;
    const current = await recognizerPromise.catch(() => null);
    if (current !== recognizer || this.#recognizerPromise !== recognizerPromise) return;
    this.#recognizerPromise = null;
    await recognizer.session.release().catch(() => undefined);
  }
}
