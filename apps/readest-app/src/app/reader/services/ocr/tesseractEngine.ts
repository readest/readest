import { createWorker, OEM, PSM } from 'tesseract.js';
import type {
  ImageLike,
  OutputFormats,
  RecognizeOptions,
  WorkerOptions,
  WorkerParams,
} from 'tesseract.js';

import type { OcrPage } from '@/app/reader/services/ocr/types';
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

export interface OcrEngineProgress {
  status: string;
  progress: number;
}

export interface TesseractOcrEngineOptions {
  languages?: readonly string[];
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

export interface TesseractWorker {
  setParameters: (parameters: Partial<WorkerParams>) => Promise<unknown>;
  recognize: (
    image: ImageLike,
    options?: Partial<RecognizeOptions>,
    output?: Partial<OutputFormats>,
  ) => Promise<{ data: TesseractPageData }>;
  terminate: () => Promise<unknown>;
}

export type TesseractWorkerFactory = (
  languages: string[],
  oem: OEM,
  options: Partial<WorkerOptions>,
) => Promise<TesseractWorker>;

const createLocalWorker: TesseractWorkerFactory = (languages, oem, options) =>
  createWorker(languages, oem, options);

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

  const detailScale = MINIMUM_OCR_LONG_EDGE / longEdge;
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / pixelCount);
  const scale = Math.max(1, Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale));
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
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

export class TesseractOcrEngine {
  readonly #languages: string[];
  readonly #pageSegmentationMode: PSM;
  readonly #minimumConfidence: number;
  readonly #onProgress?: (progress: OcrEngineProgress) => void;
  readonly #createWorker: TesseractWorkerFactory;
  #workerPromise: Promise<TesseractWorker> | null = null;
  #terminated = false;

  constructor(
    options: TesseractOcrEngineOptions = {},
    workerFactory: TesseractWorkerFactory = createLocalWorker,
  ) {
    this.#languages = options.languages?.length ? [...options.languages] : [...DEFAULT_LANGUAGES];
    this.#pageSegmentationMode = options.pageSegmentationMode ?? PSM.AUTO;
    this.#minimumConfidence = options.minimumConfidence ?? 0;
    this.#onProgress = options.onProgress;
    this.#createWorker = workerFactory;
  }

  async recognize(image: ImageLike, page: OcrImagePage): Promise<OcrPage> {
    const worker = await this.#getWorker();
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    const prepared = prepareImage(image, page);
    const { data } = await worker.recognize(prepared.image, {}, { text: true, blocks: true });
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    return adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    const workerPromise = this.#workerPromise;
    this.#workerPromise = null;
    if (!workerPromise) return;

    let worker: TesseractWorker;
    try {
      worker = await workerPromise;
    } catch {
      return;
    }
    await worker.terminate();
  }

  #getWorker(): Promise<TesseractWorker> {
    if (this.#terminated) return Promise.reject(new Error('OCR engine has been terminated'));
    if (this.#workerPromise) return this.#workerPromise;

    const workerPromise = this.#createWorker([...this.#languages], OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      workerBlobURL: false,
      logger: ({ status, progress }) => this.#onProgress?.({ status, progress }),
    }).then(async (worker) => {
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: this.#pageSegmentationMode,
          preserve_interword_spaces: '1',
        });
        return worker;
      } catch (error) {
        await worker.terminate().catch(() => undefined);
        throw error;
      }
    });
    this.#workerPromise = workerPromise;
    void workerPromise.catch(() => {
      if (this.#workerPromise === workerPromise) this.#workerPromise = null;
    });
    return workerPromise;
  }
}
