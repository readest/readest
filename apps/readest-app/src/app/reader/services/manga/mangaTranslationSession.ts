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

interface MangaTranslationSessionOptions {
  createEngine: () => MangaTranslationSessionEngine;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageTranslated?: (page: TranslatedMangaPage) => void;
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
  readonly #createEngine: () => MangaTranslationSessionEngine;
  readonly #onError?: (error: unknown, pageIndex: number) => void;
  readonly #onPageTranslated?: (page: TranslatedMangaPage) => void;
  readonly #pages = new Map<number, CachedMangaPage>();
  readonly #pending = new Map<number, PendingMangaPage>();
  readonly #documents = new Map<number, Document>();
  #engine: MangaTranslationSessionEngine | null = null;
  #engineTermination: Promise<void> = Promise.resolve();
  #queue: Promise<void> = Promise.resolve();
  #generation = 0;
  #enabled = false;
  #terminated = false;

  constructor({ createEngine, onError, onPageTranslated }: MangaTranslationSessionOptions) {
    this.#createEngine = createEngine;
    this.#onError = onError;
    this.#onPageTranslated = onPageTranslated;
  }

  async processDocument(doc: Document, pageIndex: number): Promise<TranslatedMangaPage | null> {
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
    const translation =
      pendingPage && isSamePageImage(pendingPage, doc, image)
        ? pendingPage.promise
        : this.#translate(doc, image, pageIndex, generation);
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
    this.#queue = Promise.resolve();
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
    this.#queue = Promise.resolve();
    await this.#terminateEngine();
  }

  #registerDocument(doc: Document, pageIndex: number): void {
    if (this.#terminated || this.#documents.get(pageIndex) === doc) return;
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
  ): Promise<TranslatedMangaPage | null> {
    const translation = this.#queue.then(async () => {
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
    });
    const pendingPage = { document, image, promise: translation };
    this.#pending.set(pageIndex, pendingPage);
    this.#queue = translation.then(
      () => undefined,
      () => undefined,
    );
    const clearPending = () => {
      if (this.#pending.get(pageIndex) === pendingPage) this.#pending.delete(pageIndex);
    };
    void translation.then(clearPending, clearPending);
    return translation;
  }

  #getEngine(): MangaTranslationSessionEngine {
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
