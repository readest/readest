import type { OcrPage } from '@/app/reader/services/ocr/types';
import { mountOcrTextLayer, removeOcrTextLayer } from '@/app/reader/utils/ocrTextLayer';

interface OcrImagePage {
  pageIndex: number;
  width: number;
  height: number;
}

export type OcrImageSource = string | HTMLCanvasElement;

export interface OcrEngine {
  recognize: (source: OcrImageSource, page: OcrImagePage) => Promise<OcrPage>;
  terminate: () => Promise<void>;
}

interface OcrSessionOptions {
  createEngine: () => OcrEngine;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageRecognized?: (page: OcrPage) => void;
}

interface PageImage {
  source: OcrImageSource;
  width: number;
  height: number;
}

const getPageImage = (doc: Document): PageImage | null => {
  const image = doc.querySelector('img');
  if (image) {
    const source = image.currentSrc || image.src;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!source || !Number.isFinite(width) || width <= 0) return null;
    if (!Number.isFinite(height) || height <= 0) return null;
    return { source, width, height };
  }

  const canvas = doc.querySelector<HTMLCanvasElement>('#canvas canvas');
  if (!canvas) return null;
  if (/\S/u.test(doc.querySelector('.textLayer')?.textContent ?? '')) return null;
  if (!Number.isFinite(canvas.width) || canvas.width <= 0) return null;
  if (!Number.isFinite(canvas.height) || canvas.height <= 0) return null;
  return { source: canvas, width: canvas.width, height: canvas.height };
};

export class OcrSession {
  readonly #createEngine: () => OcrEngine;
  readonly #onError?: (error: unknown, pageIndex: number) => void;
  readonly #onPageRecognized?: (page: OcrPage) => void;
  readonly #pages = new Map<number, OcrPage>();
  readonly #pending = new Map<number, Promise<OcrPage | null>>();
  readonly #documents = new Map<number, Document>();
  #engine: OcrEngine | null = null;
  #queue: Promise<void> = Promise.resolve();
  #generation = 0;
  #enabled = false;
  #terminated = false;

  constructor({ createEngine, onError, onPageRecognized }: OcrSessionOptions) {
    this.#createEngine = createEngine;
    this.#onError = onError;
    this.#onPageRecognized = onPageRecognized;
  }

  async processDocument(doc: Document, pageIndex: number): Promise<OcrPage | null> {
    this.#registerDocument(doc, pageIndex);
    if (this.#terminated || !this.#enabled) {
      removeOcrTextLayer(doc);
      return null;
    }

    const image = getPageImage(doc);
    if (!image) {
      removeOcrTextLayer(doc);
      return null;
    }

    const cachedPage = this.#pages.get(pageIndex);
    if (cachedPage) {
      mountOcrTextLayer(doc, cachedPage);
      return cachedPage;
    }

    const generation = this.#generation;
    const recognition =
      this.#pending.get(pageIndex) ?? this.#recognize(image, pageIndex, generation);

    let page: OcrPage | null;
    try {
      page = await recognition;
    } catch (error) {
      if (this.#enabled && generation === this.#generation) this.#onError?.(error, pageIndex);
      return null;
    }
    if (!page || !this.#enabled || generation !== this.#generation) return page;
    if (this.#documents.get(pageIndex) !== doc) return page;
    if (getPageImage(doc)?.source !== image.source) return page;

    mountOcrTextLayer(doc, page);
    return page;
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.#terminated || this.#enabled === enabled) return Promise.resolve();
    this.#enabled = enabled;
    this.#generation += 1;

    if (enabled) {
      return Promise.all(
        [...this.#documents.entries()].map(([pageIndex, doc]) =>
          this.processDocument(doc, pageIndex),
        ),
      ).then(() => undefined);
    }

    for (const doc of this.#documents.values()) removeOcrTextLayer(doc);
    this.#pending.clear();
    this.#queue = Promise.resolve();
    return this.#terminateEngine();
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#enabled = false;
    this.#generation += 1;
    for (const doc of this.#documents.values()) removeOcrTextLayer(doc);
    this.#documents.clear();
    this.#pages.clear();
    this.#pending.clear();
    this.#queue = Promise.resolve();
    await this.#terminateEngine();
  }

  #registerDocument(doc: Document, pageIndex: number): void {
    if (this.#terminated) return;
    if (this.#documents.get(pageIndex) === doc) return;
    this.#documents.set(pageIndex, doc);
    doc.defaultView?.addEventListener(
      'pagehide',
      () => {
        if (this.#documents.get(pageIndex) === doc) this.#documents.delete(pageIndex);
      },
      { once: true },
    );
  }

  #recognize(image: PageImage, pageIndex: number, generation: number): Promise<OcrPage | null> {
    const recognition = this.#queue.then(async () => {
      if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
      const page = await this.#getEngine().recognize(image.source, {
        pageIndex,
        width: image.width,
        height: image.height,
      });
      if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
      this.#pages.set(pageIndex, page);
      this.#onPageRecognized?.(page);
      return page;
    });
    this.#pending.set(pageIndex, recognition);
    this.#queue = recognition.then(
      () => undefined,
      () => undefined,
    );
    void recognition.then(
      () => {
        if (this.#pending.get(pageIndex) === recognition) this.#pending.delete(pageIndex);
      },
      () => {
        if (this.#pending.get(pageIndex) === recognition) this.#pending.delete(pageIndex);
      },
    );
    return recognition;
  }

  #getEngine(): OcrEngine {
    this.#engine ??= this.#createEngine();
    return this.#engine;
  }

  async #terminateEngine(): Promise<void> {
    const engine = this.#engine;
    this.#engine = null;
    if (!engine) return;
    try {
      await engine.terminate();
    } catch (error) {
      this.#onError?.(error, -1);
    }
  }
}
