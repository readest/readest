import type {
  MangaPageSource,
  TranslatedMangaPage,
} from '@/app/reader/services/manga/mangaTranslationEngine';
import {
  mountMangaTranslationLayer,
  removeMangaTranslationLayer,
} from '@/app/reader/utils/mangaTranslationLayer';

interface MangaImagePage {
  pageIndex: number;
  width: number;
  height: number;
}

export interface MangaTranslationSessionEngine {
  translate: (source: MangaPageSource, page: MangaImagePage) => Promise<TranslatedMangaPage>;
  terminate: () => Promise<void>;
}

interface MangaTranslationEngineProgress {
  status: string;
  progress: number;
}

export interface MangaTranslationSessionProgress extends MangaTranslationEngineProgress {
  completed: number;
  total: number;
}

interface MangaTranslationSessionOptions {
  createEngine: (
    onProgress: (progress: MangaTranslationEngineProgress) => void,
  ) => MangaTranslationSessionEngine;
  onProgress?: (progress: MangaTranslationSessionProgress) => void;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageTranslated?: (page: TranslatedMangaPage) => void;
}

export interface MangaTranslationProcessOptions {
  priority?: boolean;
}

interface MangaPageImage {
  source: MangaPageSource;
  width: number;
  height: number;
}

interface MangaPageIdentity {
  document: Document;
  image: MangaPageImage;
}

interface CachedMangaPage extends MangaPageIdentity {
  page: TranslatedMangaPage;
}

interface PendingMangaPage extends MangaPageIdentity {
  promise: Promise<TranslatedMangaPage | null>;
  task: MangaQueueTask;
}

interface MangaQueueTask {
  run: () => Promise<TranslatedMangaPage | null>;
  resolve: (page: TranslatedMangaPage | null) => void;
  reject: (error: unknown) => void;
}

const isSamePageImage = (
  left: MangaPageIdentity,
  document: Document,
  image: MangaPageImage,
): boolean => {
  if (typeof left.image.source !== 'string' || typeof image.source !== 'string') {
    return left.document === document;
  }
  return (
    left.image.source === image.source &&
    left.image.width === image.width &&
    left.image.height === image.height
  );
};

const getPageImage = (doc: Document): MangaPageImage | null => {
  const image = doc.querySelector('img');
  if (image) {
    const source = image.currentSrc || image.src;
    if (!source || !Number.isFinite(image.naturalWidth) || image.naturalWidth <= 0) return null;
    if (!Number.isFinite(image.naturalHeight) || image.naturalHeight <= 0) return null;
    return { source, width: image.naturalWidth, height: image.naturalHeight };
  }

  const canvas = doc.querySelector<HTMLCanvasElement>('#canvas canvas');
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
  return { source: canvas, width: canvas.width, height: canvas.height };
};

export class MangaTranslationSession {
  readonly #createEngine: MangaTranslationSessionOptions['createEngine'];
  readonly #onProgress?: (progress: MangaTranslationSessionProgress) => void;
  readonly #onError?: (error: unknown, pageIndex: number) => void;
  readonly #onPageTranslated?: (page: TranslatedMangaPage) => void;
  readonly #pages = new Map<number, CachedMangaPage>();
  readonly #pending = new Map<number, PendingMangaPage>();
  readonly #documents = new Map<number, Document>();
  #engine: MangaTranslationSessionEngine | null = null;
  #engineTermination: Promise<void> = Promise.resolve();
  #queue: MangaQueueTask[] = [];
  #runningTask: MangaQueueTask | null = null;
  #drainingQueue = false;
  #batchCompleted = 0;
  #batchTotal = 0;
  #generation = 0;
  #enabled = false;
  #terminated = false;

  constructor({
    createEngine,
    onProgress,
    onError,
    onPageTranslated,
  }: MangaTranslationSessionOptions) {
    this.#createEngine = createEngine;
    this.#onProgress = onProgress;
    this.#onError = onError;
    this.#onPageTranslated = onPageTranslated;
  }

  async processDocument(
    doc: Document,
    pageIndex: number,
    { priority = false }: MangaTranslationProcessOptions = {},
  ): Promise<TranslatedMangaPage | null> {
    this.#registerDocument(doc, pageIndex);
    if (this.#terminated || !this.#enabled) {
      removeMangaTranslationLayer(doc);
      return null;
    }

    const image = getPageImage(doc);
    if (!image) {
      removeMangaTranslationLayer(doc);
      return null;
    }

    const cachedPage = this.#pages.get(pageIndex);
    if (cachedPage && isSamePageImage(cachedPage, doc, image)) {
      mountMangaTranslationLayer(doc, cachedPage.page);
      return cachedPage.page;
    }
    if (cachedPage) this.#pages.delete(pageIndex);

    const generation = this.#generation;
    const pendingPage = this.#pending.get(pageIndex);
    let translation: Promise<TranslatedMangaPage | null>;
    if (pendingPage && isSamePageImage(pendingPage, doc, image)) {
      if (priority) this.#promoteTask(pendingPage.task);
      translation = pendingPage.promise;
    } else {
      translation = this.#translate(doc, image, pageIndex, generation, priority);
    }
    let page: TranslatedMangaPage | null;
    try {
      page = await translation;
    } catch (error) {
      if (this.#enabled && generation === this.#generation) this.#onError?.(error, pageIndex);
      return null;
    }
    if (!page || !this.#enabled || generation !== this.#generation) return page;
    if (this.#documents.get(pageIndex) !== doc) return page;
    const currentImage = getPageImage(doc);
    if (!currentImage || !isSamePageImage({ document: doc, image }, doc, currentImage)) return page;

    mountMangaTranslationLayer(doc, page);
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

    for (const doc of this.#documents.values()) removeMangaTranslationLayer(doc);
    this.#pending.clear();
    this.#cancelQueuedTasks();
    return this.#terminateEngine();
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#enabled = false;
    this.#generation += 1;
    for (const doc of this.#documents.values()) removeMangaTranslationLayer(doc);
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

  #translate(
    document: Document,
    image: MangaPageImage,
    pageIndex: number,
    generation: number,
    priority: boolean,
  ): Promise<TranslatedMangaPage | null> {
    let resolveTranslation!: (page: TranslatedMangaPage | null) => void;
    let rejectTranslation!: (error: unknown) => void;
    const translation = new Promise<TranslatedMangaPage | null>((resolve, reject) => {
      resolveTranslation = resolve;
      rejectTranslation = reject;
    });
    const task: MangaQueueTask = {
      run: async () => {
        if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
        await this.#engineTermination;
        if (this.#terminated || !this.#enabled || generation !== this.#generation) return null;
        const page = await this.#getEngine().translate(image.source, {
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
        this.#onPageTranslated?.(page);
        return page;
      },
      resolve: resolveTranslation,
      reject: rejectTranslation,
    };
    const pendingPage = { document, image, promise: translation, task };
    this.#pending.set(pageIndex, pendingPage);
    if (!this.#runningTask && this.#queue.length === 0) {
      this.#batchCompleted = 0;
      this.#batchTotal = 0;
    }
    this.#batchTotal += 1;
    if (priority) this.#queue.unshift(task);
    else this.#queue.push(task);
    void this.#drainQueue();
    const clearPending = () => {
      if (this.#pending.get(pageIndex) === pendingPage) this.#pending.delete(pageIndex);
    };
    void translation.then(clearPending, clearPending);
    return translation;
  }

  #promoteTask(task: MangaQueueTask): void {
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
          if (this.#enabled) {
            this.#batchCompleted = Math.min(this.#batchTotal, this.#batchCompleted + 1);
            this.#onProgress?.({
              status: 'completed manga page',
              progress: 0,
              completed: this.#batchCompleted,
              total: this.#batchTotal,
            });
          }
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

  #getEngine(): MangaTranslationSessionEngine {
    this.#engine ??= this.#createEngine((progress) => {
      if (!this.#enabled) return;
      this.#onProgress?.({
        ...progress,
        completed: this.#batchCompleted,
        total: Math.max(1, this.#batchTotal),
      });
    });
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
