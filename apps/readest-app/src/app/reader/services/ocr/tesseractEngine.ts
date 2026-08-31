import { createWorker, OEM, PSM } from 'tesseract.js';
import type {
  ImageLike,
  Lang as TesseractLang,
  OutputFormats,
  RecognizeOptions,
  WorkerOptions,
  WorkerParams,
} from 'tesseract.js';

import { MangaDetector, type MangaBubbleRegion } from '@/app/reader/services/manga/mangaDetector';
import {
  fetchVerifiedModelAsset,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';
import type {
  OcrBoundingBox,
  OcrPage,
  OcrTextBlock,
  OcrWritingMode,
} from '@/app/reader/services/ocr/types';
import {
  adaptTesseractPage,
  type TesseractPageData,
} from '@/app/reader/services/ocr/tesseractAdapter';
import { getTesseractLanguageAsset } from '@/app/reader/services/ocr/tesseractLanguageAssets';

const DEFAULT_LANGUAGES = ['eng'] as const;
const WORKER_PATH = '/vendor/tesseract/dist/worker.min.js';
const CORE_PATH = '/vendor/tesseract/core';
const MINIMUM_OCR_LONG_EDGE = 1800;
const MAXIMUM_OCR_SCALE = 3;
const MAXIMUM_OCR_PIXELS = 3_000_000;

const scaleImageDimension = (value: number, scale: number): number =>
  Math.max(1, scale < 1 ? Math.floor(value * scale) : Math.round(value * scale));

export interface OcrEngineProgress {
  status: string;
  progress: number;
}

export interface TesseractOcrEngineOptions {
  languages?: readonly string[];
  mangaMode?: boolean;
  wholePageFallback?: boolean;
  pageSegmentationMode?: PSM;
  minimumConfidence?: number;
  onProgress?: (progress: OcrEngineProgress) => void;
}

interface OcrImagePage {
  pageIndex: number;
  width: number;
  height: number;
}

interface PreparedImage {
  image: ImageLike;
  page: OcrImagePage;
}

interface PreparedMangaImage {
  image: HTMLCanvasElement;
  page: OcrImagePage;
}

interface LoadedMangaImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface MangaTextDetector {
  detect: (
    source: CanvasImageSource,
    page: Pick<OcrImagePage, 'width' | 'height'>,
  ) => Promise<readonly MangaBubbleRegion[]>;
  terminate: () => Promise<void>;
}

export type MangaTextDetectorFactory = (
  onDownloadProgress?: (progress: { loaded: number; total?: number }) => void,
) => MangaTextDetector;

export type MangaImageLoader = (source: string) => Promise<LoadedMangaImage>;

export interface TesseractWorker {
  setParameters: (parameters: Partial<WorkerParams>) => Promise<unknown>;
  recognize: (
    image: ImageLike,
    options?: Partial<RecognizeOptions>,
    output?: Partial<OutputFormats>,
  ) => Promise<{ data: TesseractPageData & { text?: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
}

export type TesseractWorkerLanguages = string[] | TesseractLang[];

export type TesseractWorkerFactory = (
  languages: TesseractWorkerLanguages,
  oem: OEM,
  options: Partial<WorkerOptions>,
) => Promise<TesseractWorker>;

export type TesseractLanguageAssetLoader = (asset: VerifiedModelAsset) => Promise<ArrayBuffer>;

interface WorkerRequest {
  creation: Promise<TesseractWorker>;
  initialized: Promise<TesseractWorker>;
  worker: TesseractWorker | null;
  termination: Promise<void> | null;
}

const createLocalWorker: TesseractWorkerFactory = (languages, oem, options) =>
  createWorker(languages, oem, options);

const loadLocalLanguageAsset: TesseractLanguageAssetLoader = fetchVerifiedModelAsset;

const createMangaDetector: MangaTextDetectorFactory = (onDownloadProgress) =>
  new MangaDetector({ onDownloadProgress });

const loadMangaImage: MangaImageLoader = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('OCR could not decode the manga page image'));
    image.src = source;
  });

const isHtmlCanvas = (image: ImageLike): image is HTMLCanvasElement =>
  typeof image === 'object' &&
  image !== null &&
  'tagName' in image &&
  image.tagName === 'CANVAS' &&
  'ownerDocument' in image;

const prepareImage = (image: ImageLike, page: OcrImagePage): PreparedImage => {
  if (!isHtmlCanvas(image)) return { image, page };

  const source = image;
  const { width, height } = source;
  const longEdge = Math.max(width, height);
  const pixelCount = width * height;
  if (longEdge <= 0 || pixelCount <= 0) return { image, page };

  const detailScale = longEdge < MINIMUM_OCR_LONG_EDGE ? MINIMUM_OCR_LONG_EDGE / longEdge : 1;
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / pixelCount);
  const scale = Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale);
  const targetWidth = scaleImageDimension(width, scale);
  const targetHeight = scaleImageDimension(height, scale);
  if (targetWidth === width && targetHeight === height) return { image, page };

  const canvasDocument =
    source.ownerDocument.defaultView?.frameElement?.ownerDocument ?? source.ownerDocument;
  const canvas = canvasDocument.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return { image, page };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  return {
    image: canvas,
    page: { ...page, width: targetWidth, height: targetHeight },
  };
};

const getMangaScale = (width: number, height: number): number => {
  const longEdge = Math.max(width, height);
  const pixelCount = width * height;
  if (longEdge <= 0 || pixelCount <= 0) return 1;
  const detailScale = Math.max(1, MINIMUM_OCR_LONG_EDGE / longEdge);
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / pixelCount);
  return Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale);
};

const getCanvasDocument = (source?: HTMLCanvasElement): Document =>
  source?.ownerDocument.defaultView?.frameElement?.ownerDocument ??
  source?.ownerDocument ??
  document;

const prepareMangaImage = async (
  image: ImageLike,
  page: OcrImagePage,
  loadImage: MangaImageLoader,
): Promise<PreparedMangaImage> => {
  const canvasSource = isHtmlCanvas(image) ? image : undefined;
  const loaded = canvasSource
    ? { image: canvasSource, width: canvasSource.width, height: canvasSource.height }
    : await loadImage(String(image));
  if (!Number.isFinite(loaded.width) || !Number.isFinite(loaded.height)) {
    throw new Error('OCR received invalid manga page dimensions');
  }
  if (loaded.width <= 0 || loaded.height <= 0) {
    throw new Error('OCR received an empty manga page image');
  }

  const scale = getMangaScale(loaded.width, loaded.height);
  const targetWidth = scaleImageDimension(loaded.width, scale);
  const targetHeight = scaleImageDimension(loaded.height, scale);
  if (canvasSource && targetWidth === loaded.width && targetHeight === loaded.height) {
    return { image: canvasSource, page: { ...page, width: targetWidth, height: targetHeight } };
  }

  const canvas = getCanvasDocument(canvasSource).createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OCR could not prepare the manga page canvas');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(loaded.image, 0, 0, targetWidth, targetHeight);
  return { image: canvas, page: { ...page, width: targetWidth, height: targetHeight } };
};

const unionBoxes = (boxes: readonly OcrBoundingBox[]): OcrBoundingBox => ({
  xMin: Math.min(...boxes.map((box) => box.xMin)),
  yMin: Math.min(...boxes.map((box) => box.yMin)),
  xMax: Math.max(...boxes.map((box) => box.xMax)),
  yMax: Math.max(...boxes.map((box) => box.yMax)),
});

const toRectangle = (
  box: OcrBoundingBox,
  page: Pick<OcrPage, 'width' | 'height'>,
): { left: number; top: number; width: number; height: number } | null => {
  const left = Math.max(0, Math.floor(box.xMin));
  const top = Math.max(0, Math.floor(box.yMin));
  const right = Math.min(page.width, Math.ceil(box.xMax));
  const bottom = Math.min(page.height, Math.ceil(box.yMax));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
};

interface MangaInkRun {
  start: number;
  end: number;
}

const getMangaVerticalOcrBoxes = (
  canvas: HTMLCanvasElement,
  box: OcrBoundingBox,
  page: Pick<OcrPage, 'width' | 'height'>,
): OcrBoundingBox[] => {
  const rectangle = toRectangle(box, page);
  if (!rectangle || rectangle.width < 24) return [box];
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [box];

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(
      rectangle.left,
      rectangle.top,
      rectangle.width,
      rectangle.height,
    ).data;
  } catch {
    return [box];
  }
  if (pixels.length !== rectangle.width * rectangle.height * 4) return [box];

  const density = Array.from({ length: rectangle.width }, (_, x) => {
    let ink = 0;
    for (let y = 0; y < rectangle.height; y += 1) {
      const offset = (y * rectangle.width + x) * 4;
      const red = pixels[offset]!;
      const green = pixels[offset + 1]!;
      const blue = pixels[offset + 2]!;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (luminance < 128) ink += 1;
    }
    return ink;
  });
  const smoothingRadius = Math.max(1, Math.round(rectangle.width * 0.012));
  const smoothedDensity = density.map((_, x) => {
    let sum = 0;
    let count = 0;
    for (
      let sample = Math.max(0, x - smoothingRadius);
      sample <= Math.min(rectangle.width - 1, x + smoothingRadius);
      sample += 1
    ) {
      sum += density[sample]!;
      count += 1;
    }
    return sum / count;
  });
  const peakDensity = Math.max(...smoothedDensity);
  if (!Number.isFinite(peakDensity) || peakDensity <= 0) return [box];
  const minimumDensity = Math.max(2, rectangle.height * 0.012, peakDensity * 0.14);

  const runs: MangaInkRun[] = [];
  let runStart = -1;
  for (let x = 0; x <= rectangle.width; x += 1) {
    if (x < rectangle.width && smoothedDensity[x]! >= minimumDensity) {
      if (runStart < 0) runStart = x;
    } else if (runStart >= 0) {
      runs.push({ start: runStart, end: x - 1 });
      runStart = -1;
    }
  }

  const maximumGap = Math.max(2, Math.round(rectangle.width * 0.035));
  const mergedRuns: MangaInkRun[] = [];
  for (const run of runs) {
    const previous = mergedRuns.at(-1);
    if (previous && run.start - previous.end - 1 <= maximumGap) previous.end = run.end;
    else mergedRuns.push({ ...run });
  }

  const edgeWidth = Math.max(2, Math.round(rectangle.width * 0.04));
  const minimumRunWidth = Math.max(2, Math.round(rectangle.width * 0.04));
  const textRuns = mergedRuns.filter((run) => {
    const width = run.end - run.start + 1;
    if (width < minimumRunWidth) return false;
    const touchesEdge = run.start <= edgeWidth || run.end >= rectangle.width - 1 - edgeWidth;
    return !touchesEdge || width >= rectangle.width * 0.14;
  });
  if (!textRuns.length || textRuns.length > 8) return [box];
  if (textRuns.length === 1 && textRuns[0]!.end - textRuns[0]!.start + 1 >= rectangle.width * 0.8) {
    return [box];
  }

  return textRuns
    .map((run) => {
      const runWidth = run.end - run.start + 1;
      const padding = Math.max(2, Math.round(runWidth * 0.25));
      return {
        xMin: rectangle.left + Math.max(0, run.start - padding),
        yMin: rectangle.top,
        xMax: rectangle.left + Math.min(rectangle.width, run.end + 1 + padding),
        yMax: rectangle.top + rectangle.height,
      };
    })
    .sort((left, right) => right.xMin - left.xMin);
};

const makeMangaTextCrop = (
  source: HTMLCanvasElement,
  box: OcrBoundingBox,
  page: Pick<OcrPage, 'width' | 'height'>,
): HTMLCanvasElement | null => {
  const rectangle = toRectangle(box, page);
  if (!rectangle) return null;
  const padding = Math.max(6, Math.min(16, Math.round(rectangle.width * 0.2)));
  const scale = 2;
  const canvas = getCanvasDocument(source).createElement('canvas');
  canvas.width = (rectangle.width + padding * 2) * scale;
  canvas.height = (rectangle.height + padding * 2) * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    rectangle.left,
    rectangle.top,
    rectangle.width,
    rectangle.height,
    padding * scale,
    padding * scale,
    rectangle.width * scale,
    rectangle.height * scale,
  );
  return canvas;
};

const trimMangaVerticalBox = (box: OcrBoundingBox): OcrBoundingBox | null => {
  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  const trim = Math.min(height * 0.3, width * 1.25);
  if (height - trim < width * 1.5) return null;
  return { ...box, yMax: box.yMax - trim };
};

const segmentationModeFor = (writingMode: OcrWritingMode): PSM =>
  writingMode === 'vertical-rl' ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_BLOCK;

const DEFAULT_BUBBLE_COLOR = 'rgb(255 255 255)';
const MAXIMUM_BACKGROUND_SAMPLES = 12_000;

const isInsideBox = (x: number, y: number, box: OcrBoundingBox): boolean =>
  x >= box.xMin && x <= box.xMax && y >= box.yMin && y <= box.yMax;

const createMangaBackgroundSampler = (
  canvas: HTMLCanvasElement,
): ((bubbleBox: OcrBoundingBox, textBoxes: readonly OcrBoundingBox[]) => string) => {
  const sampleCanvas = getCanvasDocument(canvas).createElement('canvas');
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  let readable = !!context;

  return (bubbleBox, textBoxes) => {
    if (!context || !readable) return DEFAULT_BUBBLE_COLOR;
    const rectangle = toRectangle(bubbleBox, { width: canvas.width, height: canvas.height });
    if (!rectangle) return DEFAULT_BUBBLE_COLOR;

    try {
      const scale = Math.min(
        1,
        Math.sqrt(MAXIMUM_BACKGROUND_SAMPLES / (rectangle.width * rectangle.height)),
      );
      const sampleWidth = Math.max(1, Math.floor(rectangle.width * scale));
      const sampleHeight = Math.max(1, Math.floor(rectangle.height * scale));
      sampleCanvas.width = sampleWidth;
      sampleCanvas.height = sampleHeight;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        canvas,
        rectangle.left,
        rectangle.top,
        rectangle.width,
        rectangle.height,
        0,
        0,
        sampleWidth,
        sampleHeight,
      );
      const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const buckets = new Map<
        number,
        { count: number; red: number; green: number; blue: number }
      >();
      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const pageX = rectangle.left + ((x + 0.5) / sampleWidth) * rectangle.width;
          const pageY = rectangle.top + ((y + 0.5) / sampleHeight) * rectangle.height;
          if (textBoxes.some((box) => isInsideBox(pageX, pageY, box))) continue;
          const offset = (y * sampleWidth + x) * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          if (r === undefined || g === undefined || b === undefined || alpha === undefined)
            continue;
          if (alpha < 128) continue;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
          bucket.count += 1;
          bucket.red += r;
          bucket.green += g;
          bucket.blue += b;
          buckets.set(key, bucket);
        }
      }
      const dominant = [...buckets.values()].reduce<
        { count: number; red: number; green: number; blue: number } | undefined
      >(
        (largest, bucket) => (!largest || bucket.count > largest.count ? bucket : largest),
        undefined,
      );
      if (!dominant) return DEFAULT_BUBBLE_COLOR;
      return `rgb(${Math.round(dominant.red / dominant.count)} ${Math.round(
        dominant.green / dominant.count,
      )} ${Math.round(dominant.blue / dominant.count)})`;
    } catch {
      readable = false;
      return DEFAULT_BUBBLE_COLOR;
    }
  };
};

export class TesseractOcrEngine {
  readonly #languages: string[];
  readonly #mangaMode: boolean;
  readonly #wholePageFallback: boolean;
  readonly #pageSegmentationMode: PSM;
  readonly #minimumConfidence: number;
  readonly #onProgress?: (progress: OcrEngineProgress) => void;
  readonly #createWorker: TesseractWorkerFactory;
  readonly #createMangaDetector: MangaTextDetectorFactory;
  readonly #loadMangaImage: MangaImageLoader;
  readonly #loadLanguageAsset: TesseractLanguageAssetLoader;
  readonly #abortController = new AbortController();
  #workerRequest: WorkerRequest | null = null;
  #mangaDetector: MangaTextDetector | null = null;
  #terminated = false;

  constructor(
    options: TesseractOcrEngineOptions = {},
    workerFactory: TesseractWorkerFactory = createLocalWorker,
    mangaDetectorFactory: MangaTextDetectorFactory = createMangaDetector,
    mangaImageLoader: MangaImageLoader = loadMangaImage,
    languageAssetLoader: TesseractLanguageAssetLoader = loadLocalLanguageAsset,
  ) {
    this.#languages = options.languages?.length ? [...options.languages] : [...DEFAULT_LANGUAGES];
    this.#pageSegmentationMode = options.pageSegmentationMode ?? PSM.AUTO;
    this.#mangaMode = options.mangaMode ?? false;
    this.#wholePageFallback = options.wholePageFallback ?? true;
    this.#minimumConfidence = options.minimumConfidence ?? 0;
    this.#onProgress = options.onProgress;
    this.#createWorker = workerFactory;
    this.#createMangaDetector = mangaDetectorFactory;
    this.#loadMangaImage = mangaImageLoader;
    this.#loadLanguageAsset = languageAssetLoader;
  }

  async recognize(image: ImageLike, page: OcrImagePage): Promise<OcrPage> {
    if (this.#mangaMode) return this.#recognizeManga(image, page);
    const worker = await this.#getWorker();
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    const prepared = prepareImage(image, page);
    const { data } = await this.#runWorkerOperation(worker, () =>
      worker.recognize(prepared.image, {}, { text: true, blocks: true }),
    );
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    return adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController.abort();
    const workerRequest = this.#workerRequest;
    this.#workerRequest = null;
    const detector = this.#mangaDetector;
    this.#mangaDetector = null;

    let workerTermination: Promise<void> | undefined;
    if (workerRequest) {
      const termination = this.#terminateWorker(workerRequest);
      if (workerRequest.worker) workerTermination = termination;
    }

    await Promise.all([detector?.terminate(), workerTermination]);
  }

  async #recognizeManga(image: ImageLike, page: OcrImagePage): Promise<OcrPage> {
    const prepared = await prepareMangaImage(image, page, this.#loadMangaImage);
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    this.#onProgress?.({ status: 'detecting speech bubbles', progress: 0 });
    const regions = await this.#getMangaDetector().detect(prepared.image, {
      width: prepared.page.width,
      height: prepared.page.height,
    });
    this.#onProgress?.({ status: 'detecting speech bubbles', progress: 1 });
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    if (!regions.length) {
      return this.#wholePageFallback
        ? this.#recognizeWholePage(prepared)
        : { ...prepared.page, blocks: [] };
    }

    const worker = await this.#getWorker();
    const blocks: OcrTextBlock[] = [];
    const sampleBackground = createMangaBackgroundSampler(prepared.image);
    await this.#runWorkerOperation(worker, async () => {
      for (const region of regions) {
        if (this.#terminated) throw new Error('OCR engine has been terminated');
        await worker.setParameters({
          tessedit_pageseg_mode: segmentationModeFor(region.writingMode),
          preserve_interword_spaces: '1',
        });
        const parts: string[] = [];
        const confidences: number[] = [];
        const recognizedBoxes: OcrBoundingBox[] = [];
        const ocrBoxes = region.textBoxes.flatMap((box) =>
          region.writingMode === 'vertical-rl'
            ? getMangaVerticalOcrBoxes(prepared.image, box, prepared.page).map((ocrBox) => ({
                box: ocrBox,
                crop: ocrBox !== box,
              }))
            : [{ box, crop: false }],
        );
        for (const { box, crop } of ocrBoxes) {
          const result = await this.#recognizeMangaTextBox(
            worker,
            prepared.image,
            prepared.page,
            box,
            region.writingMode,
            crop,
          );
          const text = result?.text;
          if (!text) continue;
          if (
            this.#minimumConfidence > 0 &&
            (result.confidence === undefined || result.confidence < this.#minimumConfidence)
          ) {
            continue;
          }
          parts.push(text);
          recognizedBoxes.push(box);
          if (result.confidence !== undefined) confidences.push(result.confidence);
        }
        if (!parts.length) continue;
        const confidence = confidences.length
          ? confidences.reduce((total, value) => total + value, 0) / confidences.length
          : undefined;
        if (
          this.#minimumConfidence > 0 &&
          (confidence === undefined || confidence < this.#minimumConfidence)
        ) {
          continue;
        }
        blocks.push({
          id: region.id,
          text: parts.join('\n'),
          ...(confidence === undefined ? {} : { confidence }),
          box: unionBoxes(recognizedBoxes),
          bubbleBox: region.bubbleBox,
          maskBoxes: region.textBoxes,
          backgroundColor: sampleBackground(region.bubbleBox, region.textBoxes),
          writingMode: region.writingMode,
        });
      }
    });
    return { ...prepared.page, blocks };
  }

  async #recognizeMangaTextBox(
    worker: TesseractWorker,
    image: HTMLCanvasElement,
    page: OcrImagePage,
    box: OcrBoundingBox,
    writingMode: OcrWritingMode,
    crop: boolean,
  ): Promise<{ text: string; confidence?: number } | null> {
    const recognize = async (targetBox: OcrBoundingBox) => {
      const croppedImage = crop ? makeMangaTextCrop(image, targetBox, page) : null;
      const rectangle = toRectangle(targetBox, page);
      if (!rectangle) return null;
      const { data } = croppedImage
        ? await worker.recognize(croppedImage, {}, { text: true, blocks: false })
        : await worker.recognize(image, { rectangle }, { text: true, blocks: false });
      const text = data.text?.trim();
      if (!text) return null;
      return {
        text,
        ...(Number.isFinite(data.confidence) ? { confidence: data.confidence! } : {}),
      };
    };

    const primary = await recognize(box);
    if (writingMode !== 'vertical-rl' || !crop) return primary;
    if (
      primary?.confidence !== undefined &&
      (this.#minimumConfidence <= 0 || primary.confidence >= this.#minimumConfidence)
    ) {
      return primary;
    }

    const trimmedBox = trimMangaVerticalBox(box);
    if (!trimmedBox) return primary;
    const retry = await recognize(trimmedBox);
    if (!retry) return primary;
    const primaryConfidence = primary?.confidence ?? Number.NEGATIVE_INFINITY;
    const retryConfidence = retry.confidence ?? Number.NEGATIVE_INFINITY;
    return retryConfidence >= primaryConfidence + 10 ? retry : primary;
  }

  async #recognizeWholePage(prepared: PreparedImage): Promise<OcrPage> {
    const worker = await this.#getWorker();
    const { data } = await this.#runWorkerOperation(worker, async () => {
      await worker.setParameters({
        tessedit_pageseg_mode: this.#pageSegmentationMode,
        preserve_interword_spaces: '1',
      });
      return worker.recognize(prepared.image, {}, { text: true, blocks: true });
    });
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    return adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
  }

  #getMangaDetector(): MangaTextDetector {
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    this.#mangaDetector ??= this.#createMangaDetector(({ loaded, total }) => {
      this.#onProgress?.({
        status: 'loading manga detector',
        progress: total && total > 0 ? Math.min(1, loaded / total) : 0,
      });
    });
    return this.#mangaDetector;
  }

  #getWorker(): Promise<TesseractWorker> {
    if (this.#terminated) return Promise.reject(new Error('OCR engine has been terminated'));
    if (this.#workerRequest) return this.#workerRequest.initialized;

    const workerRequest = {
      creation: undefined as unknown as Promise<TesseractWorker>,
      initialized: undefined as unknown as Promise<TesseractWorker>,
      worker: null as TesseractWorker | null,
      termination: null as Promise<void> | null,
    };
    workerRequest.creation = this.#loadLanguageData()
      .then((languages) => {
        if (this.#terminated) throw new Error('OCR engine has been terminated');
        return this.#createWorker(languages, OEM.LSTM_ONLY, {
          workerPath: WORKER_PATH,
          corePath: CORE_PATH,
          workerBlobURL: false,
          cacheMethod: 'none',
          gzip: false,
          logger: ({ status, progress }) => this.#onProgress?.({ status, progress }),
        });
      })
      .then((worker) => {
        workerRequest.worker = worker;
        return worker;
      });
    workerRequest.initialized = workerRequest.creation.then(async (worker) => {
      try {
        if (this.#terminated || this.#workerRequest !== workerRequest) {
          throw new Error('OCR engine has been terminated');
        }
        await worker.setParameters({
          tessedit_pageseg_mode: this.#pageSegmentationMode,
          preserve_interword_spaces: '1',
        });
        if (this.#terminated || this.#workerRequest !== workerRequest) {
          throw new Error('OCR engine has been terminated');
        }
        return worker;
      } catch (error) {
        await this.#terminateWorker(workerRequest);
        throw error;
      }
    });
    this.#workerRequest = workerRequest;
    void workerRequest.initialized.catch(() => {
      if (this.#workerRequest === workerRequest) this.#workerRequest = null;
    });
    return workerRequest.initialized;
  }

  async #loadLanguageData(): Promise<TesseractLang[]> {
    const assets = this.#languages.map((code) => getTesseractLanguageAsset(code));
    const progress = assets.map(() => ({ loaded: 0, total: undefined as number | undefined }));
    const buffers = await Promise.all(
      assets.map((asset, index) =>
        this.#loadLanguageAsset({
          ...asset,
          signal: this.#abortController.signal,
          onProgress: ({ loaded, total }) => {
            progress[index] = { loaded, total };
            const allTotalsKnown = progress.every((item) => item.total !== undefined);
            const loadedBytes = progress.reduce((sum, item) => sum + item.loaded, 0);
            const totalBytes = progress.reduce((sum, item) => sum + (item.total ?? 0), 0);
            this.#onProgress?.({
              status: 'loading OCR language data',
              progress:
                allTotalsKnown && totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0,
            });
          },
        }),
      ),
    );
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    return buffers.map((buffer, index) => ({
      code: assets[index]!.code,
      data: new Uint8Array(buffer),
    }));
  }

  async #runWorkerOperation<T>(worker: TesseractWorker, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.#discardWorker(worker);
      throw error;
    }
  }

  async #discardWorker(worker: TesseractWorker): Promise<void> {
    const workerRequest = this.#workerRequest;
    if (!workerRequest) return;
    const currentWorker = await workerRequest.initialized.catch(() => null);
    if (this.#workerRequest !== workerRequest || currentWorker !== worker) return;
    this.#workerRequest = null;
    await this.#terminateWorker(workerRequest);
  }

  #terminateWorker(workerRequest: WorkerRequest): Promise<void> {
    if (workerRequest.termination) return workerRequest.termination;
    if (workerRequest.worker) {
      workerRequest.termination = Promise.resolve()
        .then(() => workerRequest.worker?.terminate())
        .then(
          () => undefined,
          () => undefined,
        );
    } else {
      workerRequest.termination = workerRequest.creation.then(
        (worker) =>
          Promise.resolve()
            .then(() => worker.terminate())
            .then(
              () => undefined,
              () => undefined,
            ),
        () => undefined,
      );
    }
    return workerRequest.termination;
  }
}
