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
  ComicTextDetector,
  type ComicTextBlock,
  type ComicTextDetectionResult,
  type ComicTextLine,
} from './comicTextDetector';
import { LazyModel } from './lazyModel';
import { loadModelAsset } from './modelAssets';
import {
  drawMangaTextCrop,
  MANGA_CROP_BORDER,
  makeMangaTextCrops,
  readCanvasRgba,
  type MangaTextCrop,
} from './mangaTextCrop';
import { MangaOcrRecognizer } from './mangaOcrRecognizer';
import type { MangaRecognition, MangaRecognizer } from './paddleJapaneseRecognizer';
import { getOcrLineSeparator, type OcrPage, type OcrTextBlock } from '@/services/plugins/ocr';
import { adaptTesseractPage, type TesseractPageData } from './tesseractAdapter';
import { getTesseractLanguageAsset } from './tesseractLanguageAssets';
import { createOcrCanvas, isHtmlCanvas, isOcrCanvas, type OcrCanvas } from './canvas';
import { yieldToCancellation } from './yieldToCancellation';

const DEFAULT_LANGUAGES = ['eng'] as const;
const WORKER_PATH = '/vendor/tesseract/dist/worker.min.js';
const CORE_PATH = '/vendor/tesseract/core';
const MINIMUM_OCR_LONG_EDGE = 1800;
const MAXIMUM_OCR_SCALE = 3;
const MAXIMUM_OCR_PIXELS = 3_000_000;
const MINIMUM_MANGA_CONFIDENCE = 35;

const isJapaneseLanguage = (language?: string): boolean => {
  const base = language?.trim().replaceAll('_', '-').toLowerCase().split('-')[0];
  return base === 'ja' || base === 'jpn';
};

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
  image: OcrCanvas;
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
  ) => Promise<ComicTextDetectionResult>;
  terminate: () => Promise<void>;
}

export type MangaTextDetectorFactory = (
  onDownloadProgress?: (progress: number) => void,
) => MangaTextDetector;

export type MangaRecognizerFactory = (
  onDownloadProgress?: (progress: number) => void,
) => MangaRecognizer;

export type MangaImageLoader = (source: string) => Promise<LoadedMangaImage>;

type TesseractData = TesseractPageData & { text?: string; confidence?: number };

export interface TesseractWorker {
  setParameters: (parameters: Partial<WorkerParams>) => Promise<unknown>;
  recognize: (
    image: ImageLike,
    options?: Partial<RecognizeOptions>,
    output?: Partial<OutputFormats>,
  ) => Promise<{ data: TesseractData }>;
  terminate: () => Promise<unknown>;
}

export type TesseractWorkerFactory = (
  languages: TesseractLang[],
  oem: OEM,
  options: Partial<WorkerOptions>,
) => Promise<TesseractWorker>;

export type TesseractLanguageAssetLoader = typeof loadModelAsset;

interface MangaLineProgress {
  index: number;
  total: number;
}

const getMangaFontSize = (
  block: ComicTextDetectionResult['blocks'][number],
): number | undefined => {
  let vectorX = 0;
  let vectorY = 0;
  let lineCount = 0;
  for (const { polygon } of block.lines) {
    const [topLeft, topRight, bottomRight, bottomLeft] = polygon;
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) continue;
    if (block.vertical) {
      vectorX += (topRight.x + bottomRight.x - topLeft.x - bottomLeft.x) / 2;
      vectorY += (topRight.y + bottomRight.y - topLeft.y - bottomLeft.y) / 2;
    } else {
      vectorX += (bottomRight.x + bottomLeft.x - topRight.x - topLeft.x) / 2;
      vectorY += (bottomRight.y + bottomLeft.y - topRight.y - topLeft.y) / 2;
    }
    lineCount += 1;
  }
  const fontSize = lineCount ? Math.hypot(vectorX, vectorY) / lineCount : 0;
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : undefined;
};

const createLocalWorker: TesseractWorkerFactory = (languages, oem, options) =>
  createWorker(languages, oem, options);

const createMangaDetector: MangaTextDetectorFactory = (onDownloadProgress) =>
  new ComicTextDetector({ onDownloadProgress });

const createJapaneseMangaRecognizer: MangaRecognizerFactory = (onDownloadProgress) =>
  new MangaOcrRecognizer({ onDownloadProgress });

const loadMangaImage: MangaImageLoader = async (source) => {
  const response = await fetch(source);
  if (!response.ok) throw new Error('OCR could not decode the manga page image');
  const blob = await response.blob();
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('OCR could not decode the manga page image');
  }
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('OCR could not decode the manga page image'));
  });
  const objectUrl = URL.createObjectURL(blob);
  image.src = objectUrl;
  try {
    await loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { image, width: image.naturalWidth, height: image.naturalHeight };
};

/** The size that shows enough detail, for a page of this size. */
const getOcrSize = (width: number, height: number) => {
  if (!(width > 0 && height > 0)) throw new Error('OCR received an empty page image');
  const detailScale = Math.max(1, MINIMUM_OCR_LONG_EDGE / Math.max(width, height));
  const pixelScale = Math.sqrt(MAXIMUM_OCR_PIXELS / (width * height));
  const scale = Math.min(MAXIMUM_OCR_SCALE, detailScale, pixelScale);
  return { width: scaleImageDimension(width, scale), height: scaleImageDimension(height, scale) };
};

const drawPage = (
  image: CanvasImageSource,
  { width, height }: { width: number; height: number },
): OcrCanvas => {
  const canvas = createOcrCanvas(width, height, isHtmlCanvas(image) ? image : undefined);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OCR could not prepare the page canvas');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas;
};

const prepareCanvas = (image: OcrCanvas, page: OcrImagePage): PreparedMangaImage => {
  const size = getOcrSize(image.width, image.height);
  const unchanged = size.width === image.width && size.height === image.height;
  return { image: unchanged ? image : drawPage(image, size), page: { ...page, ...size } };
};

const prepareMangaImage = async (
  image: ImageLike,
  page: OcrImagePage,
  loadImage: MangaImageLoader,
): Promise<PreparedMangaImage> => {
  if (isOcrCanvas(image)) return prepareCanvas(image, page);
  const loaded = await loadImage(String(image));
  try {
    const size = getOcrSize(loaded.width, loaded.height);
    return { image: drawPage(loaded.image, size), page: { ...page, ...size } };
  } finally {
    if ('close' in loaded.image) loaded.image.close();
  }
};

export class TesseractOcrEngine {
  readonly #languages: string[];
  readonly #mangaMode: boolean;
  readonly #textLanguage?: string;
  readonly #minimumConfidence: number;
  readonly #onProgress?: (progress: OcrEngineProgress) => void;
  readonly #createWorker: TesseractWorkerFactory;
  readonly #createMangaDetector: MangaTextDetectorFactory;
  readonly #createJapaneseMangaRecognizer: MangaRecognizerFactory;
  readonly #loadMangaImage: MangaImageLoader;
  readonly #loadLanguageAsset: TesseractLanguageAssetLoader;
  readonly #worker = new LazyModel(
    (signal) => this.#startWorker(signal),
    (worker) => worker.terminate(),
  );
  #mangaDetector: MangaTextDetector | null = null;
  #mangaDetectorUnavailable = false;
  #japaneseMangaRecognizer: MangaRecognizer | null = null;
  #japaneseMangaRecognizerUnavailable = false;
  #mangaLineProgress: MangaLineProgress | null = null;
  #terminated = false;

  constructor(
    options: TesseractOcrEngineOptions = {},
    workerFactory: TesseractWorkerFactory = createLocalWorker,
    mangaDetectorFactory: MangaTextDetectorFactory = createMangaDetector,
    mangaImageLoader: MangaImageLoader = loadMangaImage,
    languageAssetLoader: TesseractLanguageAssetLoader = loadModelAsset,
    japaneseMangaRecognizerFactory: MangaRecognizerFactory = createJapaneseMangaRecognizer,
  ) {
    this.#languages = options.languages?.length ? [...options.languages] : [...DEFAULT_LANGUAGES];
    this.#mangaMode = options.mangaMode ?? false;
    this.#textLanguage = options.textLanguage;
    this.#minimumConfidence = this.#mangaMode ? MINIMUM_MANGA_CONFIDENCE : 0;
    this.#onProgress = options.onProgress;
    this.#createWorker = workerFactory;
    this.#createMangaDetector = mangaDetectorFactory;
    this.#createJapaneseMangaRecognizer = japaneseMangaRecognizerFactory;
    this.#loadMangaImage = mangaImageLoader;
    this.#loadLanguageAsset = languageAssetLoader;
  }

  async recognize(image: ImageLike, page: OcrImagePage, signal?: AbortSignal): Promise<OcrPage> {
    signal?.throwIfAborted();
    return this.#mangaMode
      ? this.#recognizeManga(image, page, signal)
      : this.#recognizeWholePage(
          isOcrCanvas(image) ? prepareCanvas(image, page) : { image, page },
          signal,
        );
  }

  async terminate(): Promise<void> {
    this.#terminated = true;
    await Promise.all([
      this.#mangaDetector?.terminate(),
      this.#japaneseMangaRecognizer?.terminate(),
      this.#worker.terminate(),
    ]);
  }

  async #recognizeManga(
    image: ImageLike,
    page: OcrImagePage,
    signal?: AbortSignal,
  ): Promise<OcrPage> {
    const prepared = await prepareMangaImage(image, page, this.#loadMangaImage);
    signal?.throwIfAborted();
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    if (this.#mangaDetectorUnavailable) return this.#recognizeWholePage(prepared, signal);
    this.#prepareRecognizer();
    this.#onProgress?.({ status: 'detecting manga text', progress: 0 });
    let detection: ComicTextDetectionResult;
    try {
      detection = await this.#getMangaDetector().detect(prepared.image, {
        width: prepared.page.width,
        height: prepared.page.height,
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (this.#terminated) throw new Error('OCR engine has been terminated');
      this.#mangaDetectorUnavailable = true;
      const detector = this.#mangaDetector;
      this.#mangaDetector = null;
      await detector?.terminate().catch(() => undefined);
      console.warn('Manga text detector unavailable; using whole-page Tesseract', error);
      return this.#recognizeWholePage(prepared, signal);
    }
    signal?.throwIfAborted();
    this.#onProgress?.({ status: 'detecting manga text', progress: 1 });
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    const totalLines = detection.blocks.reduce((total, block) => total + block.lines.length, 0);
    if (!totalLines) return this.#recognizeWholePage(prepared, signal);

    const imageData = readCanvasRgba(prepared.image);
    const japanese = isJapaneseLanguage(this.#textLanguage);
    const makeCrops = (block: ComicTextBlock, line: ComicTextLine): MangaTextCrop[] =>
      makeMangaTextCrops(imageData, line, {
        // Tesseract accepts whole lines. Splitting can cut through words.
        split: japanese,
        mask: detection.mask,
        page: detection.page,
        vertical: block.vertical,
      });
    const lineCrops = new Map<ComicTextLine, MangaTextCrop[]>();
    if (japanese) {
      for (const block of detection.blocks) {
        for (const line of block.lines) lineCrops.set(line, makeCrops(block, line));
      }
    }
    const recognitions = await this.#recognizeJapanese([...lineCrops.values()].flat(), signal);

    const blocks: OcrTextBlock[] = [];
    const wordSeparator = getOcrLineSeparator(this.#textLanguage);
    let recognitionIndex = 0;
    for (const [blockIndex, detectedBlock] of detection.blocks.entries()) {
      const textLines: string[] = [];
      const confidences: number[] = [];
      const fontSize = getMangaFontSize(detectedBlock);
      for (const line of detectedBlock.lines) {
        this.#mangaLineProgress = { index: recognitionIndex, total: totalLines };
        this.#reportWorkerProgress('recognizing text', 0);
        recognitionIndex += 1;
        try {
          const recognizedChunks: MangaRecognition[] = [];
          for (const crop of lineCrops.get(line) ?? makeCrops(detectedBlock, line)) {
            const result =
              recognitions.get(crop) ??
              (await this.#recognizeMangaCrop(crop, prepared.image, signal));
            if (!result) {
              recognizedChunks.length = 0;
              break;
            }
            recognizedChunks.push(result);
          }
          if (!recognizedChunks.length) continue;
          const text = recognizedChunks.map((chunk) => chunk.text).join(wordSeparator);
          textLines.push(text);
          confidences.push(
            recognizedChunks.reduce((sum, chunk) => sum + chunk.confidence, 0) /
              recognizedChunks.length,
          );
        } finally {
          this.#mangaLineProgress = null;
        }
      }
      if (!textLines.length) continue;
      blocks.push({
        id: `manga-block-${blockIndex}`,
        text: textLines.join(wordSeparator),
        lines: textLines,
        ...(fontSize === undefined ? {} : { fontSize }),
        confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
        box: detectedBlock.box,
        writingMode: detectedBlock.vertical ? 'vertical-rl' : 'horizontal-tb',
      });
    }
    return {
      ...prepared.page,
      ...(this.#textLanguage ? { language: this.#textLanguage } : {}),
      blocks,
    };
  }

  /** Reads the crops whose Japanese text is clear enough to keep. */
  async #recognizeJapanese(
    crops: readonly MangaTextCrop[],
    signal?: AbortSignal,
  ): Promise<Map<MangaTextCrop, MangaRecognition>> {
    const recognitions = new Map<MangaTextCrop, MangaRecognition>();
    if (!crops.length || this.#japaneseMangaRecognizerUnavailable) return recognitions;
    try {
      const results = await this.#getJapaneseMangaRecognizer().recognize(crops, {
        signal,
        onProgress: (recognized) =>
          this.#onProgress?.({ status: 'recognizing text', progress: recognized / crops.length }),
      });
      for (const [index, result] of results.entries()) {
        if (result && result.confidence >= this.#minimumConfidence) {
          recognitions.set(crops[index]!, result);
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (this.#terminated) throw new Error('OCR engine has been terminated');
      this.#japaneseMangaRecognizerUnavailable = true;
      const recognizer = this.#japaneseMangaRecognizer;
      this.#japaneseMangaRecognizer = null;
      await recognizer?.terminate().catch(() => undefined);
      console.warn('Japanese manga recognizer unavailable; using Tesseract', error);
    }
    signal?.throwIfAborted();
    return recognitions;
  }

  async #recognizeMangaCrop(
    crop: MangaTextCrop,
    source: OcrCanvas,
    signal?: AbortSignal,
  ): Promise<MangaRecognition | null> {
    await yieldToCancellation(signal);
    const data = await this.#runTesseract(
      drawMangaTextCrop(crop, MANGA_CROP_BORDER, source),
      crop.vertical ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_LINE,
      { text: true, blocks: false },
      signal,
    );
    const text = data.text?.replace(/\s+/gu, ' ').trim();
    const confidence = Number.isFinite(data.confidence) ? data.confidence : undefined;
    if (!text || confidence === undefined || confidence < this.#minimumConfidence) return null;
    return { text, confidence };
  }

  async #recognizeWholePage(prepared: PreparedImage, signal?: AbortSignal): Promise<OcrPage> {
    const output = { text: false, blocks: true };
    const data = await this.#runTesseract(prepared.image, PSM.AUTO, output, signal);
    const result = adaptTesseractPage(data, {
      ...prepared.page,
      minimumConfidence: this.#minimumConfidence,
    });
    return this.#textLanguage ? { ...result, language: this.#textLanguage } : result;
  }

  async #runTesseract(
    image: ImageLike,
    segmentation: PSM,
    output: Partial<OutputFormats>,
    signal?: AbortSignal,
  ): Promise<TesseractData> {
    const worker = await this.#worker.load();
    signal?.throwIfAborted();
    const recognize = async () => {
      await worker.setParameters({
        tessedit_pageseg_mode: segmentation,
        preserve_interword_spaces: '1',
      });
      return worker.recognize(image, {}, output);
    };
    const { data } = await recognize().catch(async (error: unknown) => {
      await this.#worker.discard();
      throw error;
    });
    signal?.throwIfAborted();
    this.#worker.throwIfTerminated();
    return data;
  }

  /** Loads what reads the lines while they're being found. */
  #prepareRecognizer(): void {
    if (!isJapaneseLanguage(this.#textLanguage)) this.#worker.load().catch(() => undefined);
    else if (!this.#japaneseMangaRecognizerUnavailable)
      this.#getJapaneseMangaRecognizer().prepare();
  }

  #getMangaDetector(): MangaTextDetector {
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    this.#mangaDetector ??= this.#createMangaDetector((progress) =>
      this.#onProgress?.({ status: 'loading manga text detector', progress }),
    );
    return this.#mangaDetector;
  }

  #getJapaneseMangaRecognizer(): MangaRecognizer {
    if (this.#terminated) throw new Error('OCR engine has been terminated');
    this.#japaneseMangaRecognizer ??= this.#createJapaneseMangaRecognizer((progress) =>
      this.#onProgress?.({ status: 'loading Japanese OCR model', progress }),
    );
    return this.#japaneseMangaRecognizer;
  }

  async #startWorker(signal: AbortSignal): Promise<TesseractWorker> {
    const languages = await this.#loadLanguageData(signal);
    signal.throwIfAborted();
    return this.#createWorker(languages, OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: false,
      logger: ({ status, progress }) => this.#reportWorkerProgress(status, progress),
    });
  }

  async #loadLanguageData(signal: AbortSignal): Promise<TesseractLang[]> {
    const assets = this.#languages.map((code) => getTesseractLanguageAsset(code));
    const loaded = assets.map(() => 0);
    const total = assets.reduce((sum, { bytes }) => sum + bytes, 0);
    const buffers = await Promise.all(
      assets.map((asset, index) =>
        this.#loadLanguageAsset(asset, {
          signal,
          onProgress: (bytes) => {
            loaded[index] = bytes;
            this.#onProgress?.({
              status: 'loading OCR language data',
              progress: loaded.reduce((sum, value) => sum + value, 0) / total,
            });
          },
        }),
      ),
    );
    return buffers.map((buffer, index) => ({
      code: this.#languages[index]!,
      data: new Uint8Array(buffer),
    }));
  }

  #reportWorkerProgress(status: string, progress: number): void {
    const line = status === 'recognizing text' ? this.#mangaLineProgress : null;
    this.#onProgress?.({
      status,
      progress: line ? (line.index + Math.min(1, Math.max(0, progress))) / line.total : progress,
    });
  }
}
