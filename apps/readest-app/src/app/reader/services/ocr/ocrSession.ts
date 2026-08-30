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

export interface OcrProcessOptions {
  priority?: boolean;
}

interface PageImage {
  source: OcrImageSource;
  width: number;
  height: number;
}

interface PageImageIdentity {
  document: Document;
  image: PageImage;
}

interface CachedOcrPage extends PageImageIdentity {
  page: OcrPage;
}

interface PendingOcrPage extends PageImageIdentity {
  promise: Promise<OcrPage | null>;
  task: OcrQueueTask;
}

interface OcrQueueTask {
  run: () => Promise<OcrPage | null>;
  resolve: (page: OcrPage | null) => void;
  reject: (error: unknown) => void;
}

const isSamePageImage = (
  left: PageImageIdentity,
  document: Document,
  image: PageImage,
): boolean => {
  if (typeof left.image.source !== 'string' || typeof image.source !== 'string') {
    return (
      left.document === document &&
      left.image.source === image.source &&
      left.image.width === image.width &&
      left.image.height === image.height
    );
  }
  return (
    left.image.source === image.source &&
    left.image.width === image.width &&
    left.image.height === image.height
  );
};

const getPageImage = (doc: Document): PageImage | null => {
  const canvas = doc.querySelector<HTMLCanvasElement>('#canvas canvas');
  if (canvas) {
    if (/\S/u.test(doc.querySelector('.textLayer')?.textContent ?? '')) return null;
    if (!Number.isFinite(canvas.width) || canvas.width <= 0) return null;
    if (!Number.isFinite(canvas.height) || canvas.height <= 0) return null;
    return { source: canvas, width: canvas.width, height: canvas.height };
  }

  const image = doc.querySelector('img');
  if (image) {
    const source = image.currentSrc || image.src;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!source || !Number.isFinite(width) || width <= 0) return null;
    if (!Number.isFinite(height) || height <= 0) return null;
    return { source, width, height };
  }

  return null;
};

export class OcrSession {
  readonly #createEngine: () => OcrEngine;
  readonly #onError?: (error: unknown, pageIndex: number) => void;
  readonly #onPageRecognized?: (page: OcrPage) => void;
  readonly #pages = new Map<number, CachedOcrPage>();
  readonly #pending = new Map<number, PendingOcrPage>();
  readonly #documents = new Map<number, Document>();
  #engine: OcrEngine | null = null;
  #engineTermination: Promise<void> = Promise.resolve();
  #queue: OcrQueueTask[] = [];
  #runningTask: OcrQueueTask | null = null;
  #drainingQueue = false;
  #generation = 0;
  #enabled = false;
  #terminated = false;

  constructor({ createEngine, onError, onPageRecognized }: OcrSessionOptions) {
    this.#createEngine = createEngine;
    this.#onError = onError;
    this.#onPageRecognized = onPageRecognized;
  }

  async processDocument(
    doc: Document,
    pageIndex: number,
    { priority = false }: OcrProcessOptions = {},
  ): Promise<OcrPage | null> {
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
    if (cachedPage && isSamePageImage(cachedPage, doc, image)) {
      mountOcrTextLayer(doc, cachedPage.page);
      return cachedPage.page;
    }
    if (cachedPage) this.#pages.delete(pageIndex);

    const generation = this.#generation;
    const pendingPage = this.#pending.get(pageIndex);
    let recognition: Promise<OcrPage | null>;
    if (pendingPage && isSamePageImage(pendingPage, doc, image)) {
      if (priority) this.#promoteTask(pendingPage.task);
      recognition = pendingPage.promise;
    } else {
      recognition = this.#recognize(doc, image, pageIndex, generation, priority);
    }

    let page: OcrPage | null;
    try {
      page = await recognition;
    } catch (error) {
      if (this.#enabled && generation === this.#generation) this.#onError?.(error, pageIndex);
      return null;
    }
    if (!page || !this.#enabled || generation !== this.#generation) return page;
    if (this.#documents.get(pageIndex) !== doc) return page;
    const currentImage = getPageImage(doc);
    if (!currentImage || !isSamePageImage({ document: doc, image }, doc, currentImage)) return page;

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
    this.#cancelQueuedTasks();
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
    this.#cancelQueuedTasks();
    await this.#terminateEngine();
  }

  #registerDocument(doc: Document, pageIndex: number): void {
    if (this.#terminated) return;
    if (this.#documents.get(pageIndex) === doc) {
      this.#documents.delete(pageIndex);
      this.#documents.set(pageIndex, doc);
      return;
    }
    this.#documents.set(pageIndex, doc);
    doc.defaultView?.addEventListener(
      'pagehide',
      () => {
        if (this.#documents.get(pageIndex) === doc) this.#documents.delete(pageIndex);
      },
      { once: true },
    );
  }

  #recognize(
    document: Document,
    image: PageImage,
    pageIndex: number,
    generation: number,
    priority: boolean,
  ): Promise<OcrPage | null> {
    let resolveRecognition!: (page: OcrPage | null) => void;
    let rejectRecognition!: (error: unknown) => void;
    const recognition = new Promise<OcrPage | null>((resolve, reject) => {
      resolveRecognition = resolve;
      rejectRecognition = reject;
    });
    const task: OcrQueueTask = {
      run: async () => {
        if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
        await this.#engineTermination;
        if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
        const page = await this.#getEngine().recognize(image.source, {
          pageIndex,
          width: image.width,
          height: image.height,
        });
        if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
        const currentDocument = this.#documents.get(pageIndex);
        const currentImage = currentDocument && getPageImage(currentDocument);
        if (
          !currentDocument ||
          !currentImage ||
          !isSamePageImage({ document, image }, currentDocument, currentImage)
        ) {
          return page;
        }
        this.#pages.set(pageIndex, { document: currentDocument, image: currentImage, page });
        this.#onPageRecognized?.(page);
        return page;
      },
      resolve: resolveRecognition,
      reject: rejectRecognition,
    };
    const pendingPage = { document, image, promise: recognition, task };
    this.#pending.set(pageIndex, pendingPage);
    if (priority) this.#queue.unshift(task);
    else this.#queue.push(task);
    void this.#drainQueue();
    void recognition.then(
      () => {
        if (this.#pending.get(pageIndex) === pendingPage) this.#pending.delete(pageIndex);
      },
      () => {
        if (this.#pending.get(pageIndex) === pendingPage) this.#pending.delete(pageIndex);
      },
    );
    return recognition;
  }

  #promoteTask(task: OcrQueueTask): void {
    if (this.#runningTask === task) return;
    const index = this.#queue.indexOf(task);
    if (index <= 0) return;
    this.#queue.splice(index, 1);
    this.#queue.unshift(task);
  }

  async #drainQueue(): Promise<void> {
    if (this.#drainingQueue) return;
    this.#drainingQueue = true;
    try {
      while (this.#queue.length > 0) {
        const task = this.#queue.shift()!;
        this.#runningTask = task;
        try {
          task.resolve(await task.run());
        } catch (error) {
          task.reject(error);
        } finally {
          this.#runningTask = null;
        }
      }
    } finally {
      this.#drainingQueue = false;
    }
  }

  #cancelQueuedTasks(): void {
    const queuedTasks = this.#queue;
    this.#queue = [];
    for (const task of queuedTasks) task.resolve(null);
  }

  #getEngine(): OcrEngine {
    this.#engine ??= this.#createEngine();
    return this.#engine;
  }

  #terminateEngine(): Promise<void> {
    const engine = this.#engine;
    this.#engine = null;
    if (!engine) return this.#engineTermination;
    const termination = this.#engineTermination.then(async () => {
      try {
        await engine.terminate();
      } catch (error) {
        this.#onError?.(error, -1);
      }
    });
    this.#engineTermination = termination;
    return termination;
  }
}
