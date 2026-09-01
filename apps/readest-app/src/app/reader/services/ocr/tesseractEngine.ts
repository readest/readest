import { createWorker, OEM, PSM } from 'tesseract.js';
import type {
  ImageLike,
  Lang as TesseractLang,
  OutputFormats,
  RecognizeOptions,
  WorkerOptions,
  WorkerParams,
} from 'tesseract.js';

import {
  MokuroTextDetector,
  type MokuroTextDetectionResult,
} from '@/app/reader/services/manga/mokuroTextDetector';
import {
  fetchVerifiedModelAsset,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';
import { makeMangaTextLineCrop, readCanvasRgba } from '@/app/reader/services/ocr/mangaTextCrop';
import type { OcrPage, OcrTextBlock } from '@/app/reader/services/ocr/types';
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
  textLanguage?: string;
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
  ) => Promise<MokuroTextDetectionResult>;
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

interface MangaLineProgress {
  index: number;
  total: number;
}

const createLocalWorker: TesseractWorkerFactory = (languages, oem, options) =>
  createWorker(languages, oem, options);

const loadLocalLanguageAsset: TesseractLanguageAssetLoader = fetchVerifiedModelAsset;

const createMangaDetector: MangaTextDetectorFactory = (onDownloadProgress) =>
  new MokuroTextDetector({ onDownloadProgress });

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

const getCanvasDocument = (source?: HTMLCanvasElement): Document =>
  source?.ownerDocument.defaultView?.frameElement?.ownerDocument ??
  source?.ownerDocument ??
  document;

const prepareImage = (image: ImageLike, page: OcrImagePage): PreparedImage => {
  if (!isHtmlCanvas(image)) return { image, page };
  const { width, height } = image;
  const longEdge = Math.max(width, height);
  const pixelCount = width * height;
  if (longEdge <= 0 || pixelCount <= 0) return { image, page };

  const detailScale = longEdge < MINIMUM_OCR_LONG_EDGE ? MINIMUM_OCR_LONG_EDGE / longEdge : 1;
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / pixelCount);
  const scale = Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale);
  const targetWidth = scaleImageDimension(width, scale);
  const targetHeight = scaleImageDimension(height, scale);
  if (targetWidth === width && targetHeight === height) return { image, page };

  const canvas = getCanvasDocument(image).createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return { image, page };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return { image: canvas, page: { ...page, width: targetWidth, height: targetHeight } };
};

const getMangaScale = (width: number, height: number): number => {
  const longEdge = Math.max(width, height);
  const pixelCount = width * height;
  if (longEdge <= 0 || pixelCount <= 0) return 1;
  const detailScale = Math.max(1, MINIMUM_OCR_LONG_EDGE / longEdge);
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / pixelCount);
  return Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale);
};

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

export class TesseractOcrEngine {
  readonly #languages: string[];
  readonly #mangaMode: boolean;
  readonly #textLanguage?: string;
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
  #mangaDetectorUnavailable = false;
  #mangaLineProgress: MangaLineProgress | null = null;
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
    this.#textLanguage = options.textLanguage;
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
    const result = adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
    return this.#textLanguage ? { ...result, language: this.#textLanguage } : result;
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
    if (this.#mangaDetectorUnavailable) return this.#recognizeWholePage(prepared);
    this.#onProgress?.({ status: 'detecting manga text', progress: 0 });
    let detection: MokuroTextDetectionResult;
    try {
      detection = await this.#getMangaDetector().detect(prepared.image, {
        width: prepared.page.width,
        height: prepared.page.height,
      });
    } catch (error) {
      if (this.#terminated || this.#abortController.signal.aborted) {
        throw new Error('OCR engine has been terminated');
      }
      this.#mangaDetectorUnavailable = true;
      const detector = this.#mangaDetector;
      this.#mangaDetector = null;
      await detector?.terminate().catch(() => undefined);
      console.warn('Manga text detector unavailable; using whole-page Tesseract', error);
      return this.#recognizeWholePage(prepared);
    }
    this.#onProgress?.({ status: 'detecting manga text', progress: 1 });
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    const lines = detection.blocks.flatMap((block, blockIndex) =>
      block.lines.map((line, lineIndex) => ({ blockIndex, lineIndex, line })),
    );
    if (!lines.length) return this.#recognizeWholePage(prepared);

    const worker = await this.#getWorker();
    const imageData = readCanvasRgba(prepared.image);
    const blocks: OcrTextBlock[] = [];
    await this.#runWorkerOperation(worker, async () => {
      for (const [recognitionIndex, { blockIndex, lineIndex, line }] of lines.entries()) {
        if (this.#terminated) throw new Error('OCR engine has been terminated');
        const writingMode = line.vertical ? 'vertical-rl' : 'horizontal-tb';
        await worker.setParameters({
          tessedit_pageseg_mode: line.vertical ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_LINE,
          preserve_interword_spaces: '1',
        });
        const crop = makeMangaTextLineCrop(prepared.image, imageData, line);
        if (!crop) continue;
        this.#mangaLineProgress = { index: recognitionIndex, total: lines.length };
        let data: TesseractPageData & { text?: string; confidence?: number };
        try {
          ({ data } = await worker.recognize(crop, {}, { text: true, blocks: false }));
        } finally {
          this.#mangaLineProgress = null;
        }
        const text = data.text?.trim();
        if (!text) continue;
        const confidence = Number.isFinite(data.confidence) ? data.confidence : undefined;
        if (
          this.#minimumConfidence > 0 &&
          (confidence === undefined || confidence < this.#minimumConfidence)
        ) {
          continue;
        }
        blocks.push({
          id: `mokuro-line-${blockIndex}-${lineIndex}`,
          text,
          ...(confidence === undefined ? {} : { confidence }),
          box: line.box,
          writingMode,
        });
      }
    });
    return {
      ...prepared.page,
      ...(this.#textLanguage ? { language: this.#textLanguage } : {}),
      blocks,
    };
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
    const result = adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
    return this.#textLanguage ? { ...result, language: this.#textLanguage } : result;
  }

  #getMangaDetector(): MangaTextDetector {
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    this.#mangaDetector ??= this.#createMangaDetector(({ loaded, total }) => {
      this.#onProgress?.({
        status: 'loading manga text detector',
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
          logger: ({ status, progress }) => this.#reportWorkerProgress(status, progress),
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

  #reportWorkerProgress(status: string, progress: number): void {
    const line = status === 'recognizing text' ? this.#mangaLineProgress : null;
    this.#onProgress?.({
      status,
      progress: line ? (line.index + Math.min(1, Math.max(0, progress))) / line.total : progress,
    });
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
