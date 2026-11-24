import {
  getTextRecognitionPresetOptions,
  Image as PaddleImage,
  RecognitionService,
  type OrtInferenceSession,
  type OrtModule,
} from 'paddleocr';

import { loadModelAsset, type ModelAsset } from './modelAssets';
import type { OcrCanvas } from './canvas';

const MODEL_REVISION = 'b8f84f0b80c529de40b4fbb3544b84fa7233a513';
const DICTIONARY_REVISION = '2661c7c0ef5c613e8f93c6e93b2e052399f0f854';

const PADDLE_JAPANESE_MODEL: ModelAsset = {
  url: `https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/${MODEL_REVISION}/inference.onnx`,
  sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
  bytes: 21_159_378,
};

const PADDLE_JAPANESE_DICTIONARY: ModelAsset = {
  url: `https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@${DICTIONARY_REVISION}/ppocr/utils/dict/ppocrv6_dict.txt`,
  sha256: 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d',
  bytes: 74_947,
};

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
  recognize: (
    source: OcrCanvas,
    getMangaCrop: () => OcrCanvas,
    signal?: AbortSignal,
  ) => Promise<JapaneseMangaRecognition | null>;
  terminate: () => Promise<void>;
}

interface JapaneseMangaRecognizerDependencies {
  loadRuntime: () => Promise<PaddleRuntime>;
  loadAsset: typeof loadModelAsset;
}

export interface JapaneseMangaRecognizerOptions {
  onDownloadProgress?: (progress: number) => void;
}

const loadRuntime = async (): Promise<PaddleRuntime> =>
  (await import('onnxruntime-web/wasm')) as unknown as PaddleRuntime;

export class PaddleJapaneseRecognizer implements JapaneseMangaRecognizer {
  readonly #onDownloadProgress?: (progress: number) => void;
  readonly #loadRuntime: () => Promise<PaddleRuntime>;
  readonly #loadAsset: typeof loadModelAsset;
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
    this.#loadAsset = dependencies.loadAsset ?? loadModelAsset;
  }

  async recognize(source: OcrCanvas): Promise<JapaneseMangaRecognition | null> {
    if (this.#terminated) throw new Error('Japanese manga recognizer has been terminated');
    const { service } = await this.#getService();
    if (this.#terminated) throw new Error('Japanese manga recognizer has been terminated');
    const context = source.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Japanese manga recognizer could not read the text crop');
    const rgba = context.getImageData(0, 0, source.width, source.height).data;
    const image = new PaddleImage(
      source.width,
      source.height,
      4,
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    );
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
      this.#loadAsset(PADDLE_JAPANESE_MODEL, {
        signal,
        onProgress: (loaded) => this.#onDownloadProgress?.(loaded / PADDLE_JAPANESE_MODEL.bytes),
      }),
      this.#loadAsset(PADDLE_JAPANESE_DICTIONARY, { signal }),
    ]).then(async ([runtime, model, dictionaryData]) => {
      runtime.env.wasm.proxy = typeof document !== 'undefined';
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
