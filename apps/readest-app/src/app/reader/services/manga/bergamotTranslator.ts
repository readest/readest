import {
  fetchVerifiedModelAsset,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';

const WORKER_URL = '/vendor/bergamot/translator-worker.js';
const MODEL_BASE_URL =
  'https://huggingface.co/TiberiuCristianLeon/Bergamot/resolve/ffb33a7be7079f5c1a1d8db07f9b5c432f0bcc87/base-memory/jaen/';
const MAXIMUM_BATCH_SIZE = 128;
const MAXIMUM_TEXT_LENGTH = 2_000;
const MAXIMUM_BATCH_CHARACTERS = 20_000;

const MODEL_ASSETS = [
  {
    part: 'model',
    name: 'model.jaen.intgemm.alphas.bin.gz',
    sha256: '3a603e20bfe1be86071913f9e23ab5129075bc0a8490151020ac4821e4f17302',
    maximumDownloadBytes: 34_000_000,
    maximumResultBytes: 45_000_000,
  },
  {
    part: 'vocab',
    name: 'vocab.jaen.spm.gz',
    sha256: '5cb217758bae05877bb3f0c2f612e4e7c1e4cb03c10db11f4a47098d7ae62919',
    maximumDownloadBytes: 1_000_000,
    maximumResultBytes: 2_000_000,
  },
  {
    part: 'shortlist',
    name: 'lex.50.50.jaen.s2t.bin.gz',
    sha256: '525f412f0d210536c2933c78ae395fa0bf2b5ee6cc5dda61ebc2e79410ebaee4',
    maximumDownloadBytes: 5_000_000,
    maximumResultBytes: 10_000_000,
  },
] as const;

interface WorkerMessageEvent {
  data: {
    id?: number;
    result?: unknown;
    error?: { message?: string; stack?: string };
  };
}

interface WorkerErrorEvent {
  message?: string;
  error?: unknown;
}

interface BergamotWorker {
  addEventListener: (
    type: 'message' | 'error',
    listener: (event: WorkerMessageEvent | WorkerErrorEvent) => void,
  ) => void;
  postMessage: (message: unknown, transfer?: readonly Transferable[]) => void;
  terminate: () => void;
}

interface BergamotTranslatorDependencies {
  createWorker: (url: string) => BergamotWorker;
  loadAsset: (asset: VerifiedModelAsset) => Promise<ArrayBuffer>;
}

interface BergamotTranslatorOptions {
  onProgress?: (progress: { status: string; progress: number }) => void;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

interface TranslationResponse {
  target?: { text?: unknown };
}

const defaultCreateWorker = (url: string): BergamotWorker =>
  new Worker(url) as unknown as BergamotWorker;

const makeWorkerError = (error: WorkerErrorEvent): Error => {
  if (error.error instanceof Error) return error.error;
  return new Error(error.message || 'The local translation worker failed');
};

export class BergamotJapaneseTranslator {
  readonly #onProgress?: (progress: { status: string; progress: number }) => void;
  readonly #createWorker: (url: string) => BergamotWorker;
  readonly #loadAsset: (asset: VerifiedModelAsset) => Promise<ArrayBuffer>;
  readonly #abortController = new AbortController();
  readonly #pending = new Map<number, PendingCall>();
  #serial = 0;
  #worker: BergamotWorker | null = null;
  #workerPromise: Promise<BergamotWorker> | null = null;
  #modelPromise: Promise<void> | null = null;
  #terminated = false;

  constructor(
    options: BergamotTranslatorOptions = {},
    dependencies: Partial<BergamotTranslatorDependencies> = {},
  ) {
    this.#onProgress = options.onProgress;
    this.#createWorker = dependencies.createWorker ?? defaultCreateWorker;
    this.#loadAsset = dependencies.loadAsset ?? fetchVerifiedModelAsset;
  }

  async translate(texts: readonly string[]): Promise<string[]> {
    if (this.#terminated) throw new Error('Local translator has been terminated');
    if (texts.length === 0) return [];
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

    await this.#ensureModel();
    const translated: string[] = [];
    for (const textsInBatch of batches) {
      const responses = await this.#call<TranslationResponse[]>('translate', [
        {
          models: [{ from: 'ja', to: 'en' }],
          texts: textsInBatch.map((text) => ({ text, html: false, qualityScores: false })),
        },
      ]);
      if (!Array.isArray(responses) || responses.length !== textsInBatch.length) {
        throw new Error('Local translator returned an incomplete batch');
      }
      for (const response of responses) {
        const text = response?.target?.text;
        if (typeof text !== 'string') throw new Error('Local translator returned invalid text');
        translated.push(text);
      }
    }
    return translated;
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController.abort();
    const error = new Error('Local translator has been terminated');
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    const worker = this.#worker;
    this.#worker = null;
    worker?.terminate();

    const work: Promise<unknown>[] = [];
    if (this.#workerPromise) work.push(this.#workerPromise);
    if (this.#modelPromise) work.push(this.#modelPromise);
    this.#workerPromise = null;
    this.#modelPromise = null;
    await Promise.allSettled(work);
  }

  #ensureModel(): Promise<void> {
    if (this.#terminated) return Promise.reject(new Error('Local translator has been terminated'));
    if (this.#modelPromise) return this.#modelPromise;

    const progress = MODEL_ASSETS.map(() => ({
      loaded: 0,
      total: undefined as number | undefined,
    }));
    const loadBuffers = Promise.all(
      MODEL_ASSETS.map((asset, index) =>
        this.#loadAsset({
          url: MODEL_BASE_URL + asset.name,
          sha256: asset.sha256,
          compression: 'gzip',
          maximumDownloadBytes: asset.maximumDownloadBytes,
          maximumResultBytes: asset.maximumResultBytes,
          signal: this.#abortController.signal,
          onProgress: ({ loaded, total }) => {
            progress[index] = { loaded, total };
            const allTotalsKnown = progress.every((item) => item.total !== undefined);
            const totalLoaded = progress.reduce((sum, item) => sum + item.loaded, 0);
            const totalBytes = progress.reduce((sum, item) => sum + (item.total ?? 0), 0);
            this.#onProgress?.({
              status: 'loading translation model',
              progress:
                allTotalsKnown && totalBytes > 0 ? Math.min(1, totalLoaded / totalBytes) : 0,
            });
          },
        }),
      ),
    );

    const modelPromise = Promise.all([this.#getWorker(), loadBuffers]).then(
      async ([worker, buffers]) => {
        if (this.#terminated) throw new Error('Local translator has been terminated');
        if (this.#worker !== worker) throw new Error('Local translation worker was replaced');
        const model = buffers[0];
        const vocab = buffers[1];
        const shortlist = buffers[2];
        if (!model || !vocab || !shortlist) {
          throw new Error('Local translation model download is incomplete');
        }
        await this.#call(
          'loadTranslationModel',
          [
            { from: 'ja', to: 'en' },
            { model, shortlist, vocabs: [vocab], config: {} },
          ],
          [model, vocab, shortlist],
        );
      },
    );
    this.#modelPromise = modelPromise;
    void modelPromise.catch(() => {
      if (this.#modelPromise === modelPromise && !this.#terminated) this.#modelPromise = null;
    });
    return modelPromise;
  }

  #getWorker(): Promise<BergamotWorker> {
    if (this.#terminated) return Promise.reject(new Error('Local translator has been terminated'));
    if (this.#workerPromise) return this.#workerPromise;

    const worker = this.#createWorker(WORKER_URL);
    this.#worker = worker;
    worker.addEventListener('message', (event: WorkerMessageEvent | WorkerErrorEvent) =>
      this.#handleMessage(worker, event as WorkerMessageEvent),
    );
    worker.addEventListener('error', (event: WorkerMessageEvent | WorkerErrorEvent) =>
      this.#handleWorkerError(worker, event as WorkerErrorEvent),
    );
    const workerPromise = this.#call('initialize', [
      { cacheSize: 0, useNativeIntGemm: false },
    ]).then(() => worker);
    this.#workerPromise = workerPromise;
    void workerPromise.catch(() => {
      if (this.#workerPromise === workerPromise && !this.#terminated) {
        this.#workerPromise = null;
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
      }
    });
    return workerPromise;
  }

  #call<T = unknown>(
    name: string,
    args: readonly unknown[],
    transfer: readonly Transferable[] = [],
  ): Promise<T> {
    if (this.#terminated) return Promise.reject(new Error('Local translator has been terminated'));
    const worker = this.#worker;
    if (!worker) return Promise.reject(new Error('Local translation worker is not available'));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.#serial;
      this.#pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      try {
        worker.postMessage({ id, name, args }, transfer);
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  #handleMessage(worker: BergamotWorker, { data }: WorkerMessageEvent): void {
    if (worker !== this.#worker) return;
    if (typeof data.id !== 'number') return;
    const pending = this.#pending.get(data.id);
    if (!pending) return;
    this.#pending.delete(data.id);
    if (data.error) {
      const error = new Error(data.error.message || 'Local translation worker call failed');
      if (data.error.stack) error.stack = data.error.stack;
      pending.reject(error);
    } else {
      pending.resolve(data.result);
    }
  }

  #handleWorkerError(worker: BergamotWorker, event: WorkerErrorEvent): void {
    if (worker !== this.#worker) return;
    const error = makeWorkerError(event);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#worker = null;
    this.#workerPromise = null;
    this.#modelPromise = null;
    worker.terminate();
  }
}
