import {
  getTextRecognitionPresetOptions,
  Image as PaddleImage,
  RecognitionService,
  type OrtInferenceSession,
  type OrtModule,
} from 'paddleocr';

import {
  fetchVerifiedModelAsset,
  type ModelDownloadProgress,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';

const MODEL_REVISION = 'b8f84f0b80c529de40b4fbb3544b84fa7233a513';
const DICTIONARY_REVISION = '2661c7c0ef5c613e8f93c6e93b2e052399f0f854';

export const PADDLE_JAPANESE_MODEL_BYTES = 21_159_378;
export const PADDLE_JAPANESE_MODEL_ASSET = {
  url: `https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/${MODEL_REVISION}/inference.onnx`,
  sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
  maximumDownloadBytes: 21_200_000,
  maximumResultBytes: 21_200_000,
} as const satisfies Omit<VerifiedModelAsset, 'onProgress' | 'signal'>;

export const PADDLE_JAPANESE_DICTIONARY_ASSET = {
  url: `https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@${DICTIONARY_REVISION}/ppocr/utils/dict/ppocrv6_dict.txt`,
  sha256: 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d',
  maximumDownloadBytes: 75_000,
  maximumResultBytes: 75_000,
} as const satisfies Omit<VerifiedModelAsset, 'onProgress' | 'signal'>;

interface PaddleRuntime extends OrtModule {
  env: {
    wasm: {
      numThreads?: number;
      proxy?: boolean;
      wasmPaths?: string;
    };
  };
  InferenceSession: OrtModule['InferenceSession'] & {
    create: (
      model: ArrayBuffer,
      options: {
        executionProviders: ['wasm'];
        executionMode: 'sequential';
        graphOptimizationLevel: 'all';
      },
    ) => Promise<OrtInferenceSession>;
  };
}

export interface JapaneseMangaRecognition {
  text: string;
  confidence: number;
}

export interface JapaneseMangaRecognizer {
  recognize: (source: HTMLCanvasElement) => Promise<JapaneseMangaRecognition | null>;
  terminate: () => Promise<void>;
}

interface JapaneseMangaRecognizerDependencies {
  loadRuntime: () => Promise<PaddleRuntime>;
  loadAsset: (asset: VerifiedModelAsset) => Promise<ArrayBuffer>;
}

export interface JapaneseMangaRecognizerOptions {
  onDownloadProgress?: (progress: ModelDownloadProgress) => void;
}

const loadRuntime = async (): Promise<PaddleRuntime> =>
  (await import('onnxruntime-web/wasm')) as unknown as PaddleRuntime;

const loadAsset = (asset: VerifiedModelAsset): Promise<ArrayBuffer> =>
  fetchVerifiedModelAsset(asset);

export class PaddleJapaneseRecognizer implements JapaneseMangaRecognizer {
  readonly #onDownloadProgress?: (progress: ModelDownloadProgress) => void;
  readonly #loadRuntime: () => Promise<PaddleRuntime>;
  readonly #loadAsset: (asset: VerifiedModelAsset) => Promise<ArrayBuffer>;
  readonly #abortController = new AbortController();
  readonly #activeRuns = new Set<Promise<JapaneseMangaRecognition | null>>();
  #servicePromise: Promise<{
    service: RecognitionService;
    session: OrtInferenceSession;
  }> | null = null;
  #terminated = false;

  constructor(
    options: JapaneseMangaRecognizerOptions = {},
    dependencies: Partial<JapaneseMangaRecognizerDependencies> = {},
  ) {
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#loadRuntime = dependencies.loadRuntime ?? loadRuntime;
    this.#loadAsset = dependencies.loadAsset ?? loadAsset;
  }

  async recognize(source: HTMLCanvasElement): Promise<JapaneseMangaRecognition | null> {
    if (this.#terminated) throw new Error('Japanese manga recognizer has been terminated');
    const { service } = await this.#getService();
    if (this.#terminated) throw new Error('Japanese manga recognizer has been terminated');
    const context = source.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Japanese manga recognizer could not read the text crop');
    const rgba = context.getImageData(0, 0, source.width, source.height).data;
    const image = new PaddleImage(source.width, source.height, 4, Uint8Array.from(rgba));
    const run = service
      .run(image, [{ x: 0, y: 0, width: source.width, height: source.height }], {
        ordering: { sortByReadingOrder: false },
      })
      .then((results) => {
        const result = results[0];
        const text = result?.text.replaceAll(' ', '').trim();
        return result && text ? { text, confidence: result.confidence * 100 } : null;
      });
    this.#activeRuns.add(run);
    try {
      return await run;
    } finally {
      this.#activeRuns.delete(run);
    }
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#abortController.abort();
    const servicePromise = this.#servicePromise;
    this.#servicePromise = null;
    if (!servicePromise) return;
    try {
      const { session } = await servicePromise;
      await Promise.allSettled(this.#activeRuns);
      await session.release?.();
    } catch {
      return;
    }
  }

  #getService(): Promise<{ service: RecognitionService; session: OrtInferenceSession }> {
    if (this.#terminated) {
      return Promise.reject(new Error('Japanese manga recognizer has been terminated'));
    }
    if (this.#servicePromise) return this.#servicePromise;
    const signal = this.#abortController.signal;
    const servicePromise = Promise.all([
      this.#loadRuntime(),
      this.#loadAsset({
        ...PADDLE_JAPANESE_MODEL_ASSET,
        signal,
        onProgress: this.#onDownloadProgress,
      }),
      this.#loadAsset({ ...PADDLE_JAPANESE_DICTIONARY_ASSET, signal }),
    ]).then(async ([runtime, model, dictionaryData]) => {
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = true;
      runtime.env.wasm.wasmPaths = '/vendor/onnxruntime/';
      const session = await runtime.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
      });
      if (this.#terminated) {
        await session.release?.();
        throw new Error('Japanese manga recognizer has been terminated');
      }
      const charactersDictionary = new TextDecoder()
        .decode(dictionaryData)
        .trimEnd()
        .split(/\r?\n/u);
      if (charactersDictionary.length !== 18_708) {
        await session.release?.();
        throw new Error('Japanese manga recognizer dictionary has an invalid length');
      }
      charactersDictionary.push(' ');
      const service = new RecognitionService(runtime, session, {
        ...getTextRecognitionPresetOptions('PP-OCRv6_small_rec'),
        charactersDictionary,
      });
      return { service, session };
    });
    this.#servicePromise = servicePromise;
    void servicePromise.catch(() => {
      if (this.#servicePromise === servicePromise && !this.#terminated) {
        this.#servicePromise = null;
      }
    });
    return servicePromise;
  }
}
