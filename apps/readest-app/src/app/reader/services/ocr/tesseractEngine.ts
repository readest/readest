import { createWorker, OEM, PSM } from 'tesseract.js';
import type {
  ImageLike,
  OutputFormats,
  RecognizeOptions,
  WorkerOptions,
  WorkerParams,
} from 'tesseract.js';

import { MangaDetector, type MangaBubbleRegion } from '@/app/reader/services/manga/mangaDetector';
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

export type TesseractWorkerFactory = (
  languages: string[],
  oem: OEM,
  options: Partial<WorkerOptions>,
) => Promise<TesseractWorker>;

interface WorkerRequest {
  creation: Promise<TesseractWorker>;
  initialized: Promise<TesseractWorker>;
  worker: TesseractWorker | null;
  termination: Promise<void> | null;
}

const createLocalWorker: TesseractWorkerFactory = (languages, oem, options) =>
  createWorker(languages, oem, options);

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
  #workerRequest: WorkerRequest | null = null;
  #mangaDetector: MangaTextDetector | null = null;
  #terminated = false;

  constructor(
    options: TesseractOcrEngineOptions = {},
    workerFactory: TesseractWorkerFactory = createLocalWorker,
    mangaDetectorFactory: MangaTextDetectorFactory = createMangaDetector,
    mangaImageLoader: MangaImageLoader = loadMangaImage,
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
        for (const box of region.textBoxes) {
          const rectangle = toRectangle(box, prepared.page);
          if (!rectangle) continue;
          const { data } = await worker.recognize(
            prepared.image,
            { rectangle },
            { text: true, blocks: false },
          );
          const text = data.text?.trim();
          if (!text) continue;
          parts.push(text);
          recognizedBoxes.push(box);
          if (Number.isFinite(data.confidence)) confidences.push(data.confidence!);
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
    workerRequest.creation = this.#createWorker([...this.#languages], OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      workerBlobURL: false,
      logger: ({ status, progress }) => this.#onProgress?.({ status, progress }),
    }).then((worker) => {
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
