import {
  type OpusTranslationRequest,
  type OpusTranslationResponse,
  OPUS_TRANSLATION_MODEL_ID,
  OPUS_TRANSLATION_MODEL_REVISION,
} from '@/app/reader/services/manga/opusTranslationProtocol';

export { OPUS_TRANSLATION_MODEL_ID, OPUS_TRANSLATION_MODEL_REVISION };

const MAXIMUM_BATCH_SIZE = 128;
const MAXIMUM_TEXT_LENGTH = 2_000;
const MAXIMUM_BATCH_CHARACTERS = 20_000;

interface TranslationWorker {
  addEventListener: (
    type: 'message' | 'messageerror' | 'error',
    listener: (event: MessageEvent<OpusTranslationResponse> | ErrorEvent) => void,
  ) => void;
  postMessage: (message: OpusTranslationRequest) => void;
  terminate: () => void;
}

interface OpusJapaneseTranslatorOptions {
  onProgress?: (progress: { status: string; progress: number }) => void;
}

interface OpusJapaneseTranslatorDependencies {
  createWorker: () => TranslationWorker;
}

interface PendingTranslation {
  resolve: (translations: unknown) => void;
  reject: (error: unknown) => void;
}

const defaultCreateWorker = (): TranslationWorker =>
  new Worker(new URL('../../../../workers/opus-translation.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as TranslationWorker;

const asTranslations = (value: unknown, expectedLength: number): string[] | null =>
  Array.isArray(value) &&
  value.length === expectedLength &&
  value.every((translation) => typeof translation === 'string')
    ? value
    : null;

export class OpusJapaneseTranslator {
  readonly #onProgress?: (progress: { status: string; progress: number }) => void;
  readonly #createWorker: () => TranslationWorker;
  readonly #pending = new Map<number, PendingTranslation>();
  #serial = 0;
  #worker: TranslationWorker | null = null;
  #terminated = false;

  constructor(
    options: OpusJapaneseTranslatorOptions = {},
    dependencies: Partial<OpusJapaneseTranslatorDependencies> = {},
  ) {
    this.#onProgress = options.onProgress;
    this.#createWorker = dependencies.createWorker ?? defaultCreateWorker;
  }

  async translate(texts: readonly string[]): Promise<string[]> {
    if (this.#terminated) throw new Error('Local translator has been terminated');
    if (!texts.length) return [];
    const batches: string[][] = [];
    let batch: string[] = [];
    let batchCharacters = 0;
    for (const text of texts) {
      if (typeof text !== 'string') throw new Error('Local translation accepts text only');
      if (text.length > MAXIMUM_TEXT_LENGTH) {
        throw new Error(`Each local translation is limited to ${MAXIMUM_TEXT_LENGTH} characters`);
      }
      if (
        batch.length >= MAXIMUM_BATCH_SIZE ||
        (batch.length > 0 && batchCharacters + text.length > MAXIMUM_BATCH_CHARACTERS)
      ) {
        batches.push(batch);
        batch = [];
        batchCharacters = 0;
      }
      batch.push(text);
      batchCharacters += text.length;
    }
    if (batch.length) batches.push(batch);

    const translated: string[] = [];
    for (const textsInBatch of batches) {
      const response = asTranslations(await this.#request(textsInBatch), textsInBatch.length);
      if (!response) {
        translated.push(...(await this.#retryIndividually(textsInBatch)));
        continue;
      }
      for (const [index, sourceText] of textsInBatch.entries()) {
        if (response[index]?.trim()) continue;
        response[index] = await this.#retryOne(sourceText);
      }
      translated.push(...response);
    }
    return translated;
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    const error = new Error('Local translator has been terminated');
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    const worker = this.#worker;
    this.#worker = null;
    worker?.terminate();
  }

  async #retryIndividually(texts: readonly string[]): Promise<string[]> {
    const translations: string[] = [];
    for (const text of texts) translations.push(await this.#retryOne(text));
    return translations;
  }

  async #retryOne(text: string): Promise<string> {
    if (!text.trim()) return '';
    const response = asTranslations(await this.#request([text]), 1);
    return response?.[0]?.trim() ? response[0] : '';
  }

  #request(texts: readonly string[]): Promise<unknown> {
    if (this.#terminated) return Promise.reject(new Error('Local translator has been terminated'));
    const worker = this.#getWorker();
    return new Promise((resolve, reject) => {
      const id = ++this.#serial;
      this.#pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, type: 'translate', texts: [...texts] });
      } catch (error) {
        this.#pending.delete(id);
        this.#handleWorkerFailure(worker, error);
        reject(error);
      }
    });
  }

  #getWorker(): TranslationWorker {
    if (this.#worker) return this.#worker;
    const worker = this.#createWorker();
    this.#worker = worker;
    worker.addEventListener('message', (event) =>
      this.#handleMessage(worker, event as MessageEvent<OpusTranslationResponse>),
    );
    worker.addEventListener('error', (event) =>
      this.#handleWorkerFailure(worker, (event as ErrorEvent).error ?? event),
    );
    worker.addEventListener('messageerror', () =>
      this.#handleWorkerFailure(
        worker,
        new Error('Local translation worker response could not be decoded'),
      ),
    );
    return worker;
  }

  #handleMessage(worker: TranslationWorker, { data }: MessageEvent<OpusTranslationResponse>): void {
    if (worker !== this.#worker) return;
    if (data.type === 'progress') {
      this.#onProgress?.({
        status: 'loading translation model',
        progress: Math.min(1, Math.max(0, data.progress)),
      });
      return;
    }
    const pending = this.#pending.get(data.id);
    if (!pending) return;
    this.#pending.delete(data.id);
    if (data.type === 'error') pending.reject(new Error(data.message));
    else pending.resolve(data.translations);
  }

  #handleWorkerFailure(worker: TranslationWorker, error: unknown): void {
    if (worker !== this.#worker) return;
    const failure = error instanceof Error ? error : new Error('Local translation worker failed');
    for (const pending of this.#pending.values()) pending.reject(failure);
    this.#pending.clear();
    this.#worker = null;
    worker.terminate();
  }
}
