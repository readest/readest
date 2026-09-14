import type { InferenceSession } from 'onnxruntime-web';
import {
  fetchVerifiedModelAsset,
  type ModelDownloadProgress,
  type VerifiedModelAsset,
} from '@/app/reader/services/manga/modelAssets';
import { decodeMangaText } from '@/app/reader/services/ocr/mangaOcrDecode';
import {
  PaddleJapaneseRecognizer,
  type JapaneseMangaRecognition,
  type JapaneseMangaRecognizer,
} from '@/app/reader/services/ocr/paddleJapaneseRecognizer';
export type { JapaneseMangaRecognizer } from '@/app/reader/services/ocr/paddleJapaneseRecognizer';

const REVISION = '3e8ddcd02cd50e897358223fce8b2784e44093ab';
const BASE_URL = `https://huggingface.co/WhiteHades/manga-ocr-browser/resolve/${REVISION}`;
const ASSETS = [
  {
    url: `${BASE_URL}/encoder_model_quantized.onnx.gz`,
    sha256: 'ddd1af56963093795705fa38da6ce7e6567d1658e7c7359db7e13fcd37dbf279',
    compressedSha256: '3321daf0d7db01e2fafaff9b68957f57d1b820aa23f434741bc7a6473d8e8e45',
    compression: 'gzip',
    maximumDownloadBytes: 72_257_767,
    maximumResultBytes: 86_967_767,
  },
  {
    url: `${BASE_URL}/decoder_model_quantized.onnx.gz`,
    sha256: '2e7177d2b0a59f1c612b694ed70c13971bee765cc2b2bc7bc9376e4753652f27',
    compressedSha256: 'c96d5273d2d0d408a813b40e667597994c92034a396227c002e183dc9598b13f',
    compression: 'gzip',
    maximumDownloadBytes: 23_207_900,
    maximumResultBytes: 29_627_936,
  },
  {
    url: `${BASE_URL}/vocab.txt`,
    sha256: '344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d',
    maximumDownloadBytes: 24_072,
    maximumResultBytes: 24_072,
  },
] satisfies VerifiedModelAsset[];

type Runtime = typeof import('onnxruntime-web/wasm');
interface Model {
  runtime: Runtime;
  encoder: InferenceSession;
  decoder: InferenceSession;
  vocabulary: string[];
}

export class MangaOcrRecognizer implements JapaneseMangaRecognizer {
  readonly #abort = new AbortController();
  readonly #active = new Set<Promise<JapaneseMangaRecognition | null>>();
  readonly #onDownloadProgress?: (progress: ModelDownloadProgress) => void;
  readonly #fast: PaddleJapaneseRecognizer;
  #mangaUnavailable = false;
  #model: Promise<Model> | null = null;

  constructor(options: { onDownloadProgress?: (progress: ModelDownloadProgress) => void } = {}) {
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#fast = new PaddleJapaneseRecognizer(options);
  }

  async recognize(
    source: HTMLCanvasElement,
    getMangaCrop: () => HTMLCanvasElement,
  ): Promise<JapaneseMangaRecognition | null> {
    this.#abort.signal.throwIfAborted();
    const run = this.#recognize(source, getMangaCrop);
    this.#active.add(run);
    try {
      return await run;
    } finally {
      this.#active.delete(run);
    }
  }

  async terminate(): Promise<void> {
    if (this.#abort.signal.aborted) return;
    this.#abort.abort();
    await Promise.allSettled([...this.#active, this.#fast.terminate()]);
    const model = await this.#model?.catch(() => null);
    this.#model = null;
    if (model) await Promise.all([model.encoder.release(), model.decoder.release()]);
  }

  async #recognize(
    source: HTMLCanvasElement,
    getMangaCrop: () => HTMLCanvasElement,
  ): Promise<JapaneseMangaRecognition | null> {
    const fast = await this.#fast.recognize(source);
    this.#abort.signal.throwIfAborted();
    // ponytail: confidence routing can miss confident errors. Our sample favoured
    // Paddle narration; revisit this threshold with broader labelled samples.
    if (this.#mangaUnavailable || (fast && fast.confidence >= 80)) return fast;
    try {
      const refined = await this.#recognizeManga(getMangaCrop());
      return refined && refined.confidence >= 80 ? refined : fast;
    } catch (error) {
      this.#abort.signal.throwIfAborted();
      this.#mangaUnavailable = true;
      console.warn('MangaOCR refinement unavailable; keeping the fast OCR result', error);
      return fast;
    }
  }

  async #recognizeManga(source: HTMLCanvasElement): Promise<JapaneseMangaRecognition | null> {
    const { runtime, encoder, decoder, vocabulary } = await this.#getModel();
    const signal = this.#abort.signal;
    signal.throwIfAborted();
    // MangaOCR reads upright grayscale crops, resized to 224x224 and normalized
    // to [-1, 1]. The caller preserves vertical writing and omits OCR padding.
    const canvas = source.ownerDocument.createElement('canvas');
    canvas.width = canvas.height = 224;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('MangaOCR could not prepare the text crop');
    context.drawImage(source, 0, 0, 224, 224);
    const rgba = context.getImageData(0, 0, 224, 224).data;
    const pixels = new Float32Array(3 * 224 * 224);
    for (let i = 0; i < 224 * 224; i++) {
      const gray =
        Math.round(rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114) /
          127.5 -
        1;
      for (let channel = 0; channel < 3; channel++) pixels[channel * 224 * 224 + i] = gray;
    }
    const input = new runtime.Tensor('float32', pixels, [1, 3, 224, 224]);
    const encoded = await encoder.run({ pixel_values: input }).finally(() => input.dispose());
    const hidden = encoded['last_hidden_state'];
    try {
      if (!hidden || !(hidden.data instanceof Float32Array)) {
        throw new Error('MangaOCR returned invalid image features');
      }
      const features = hidden.data;
      const result = await decodeMangaText(async (sequences) => {
        const count = sequences.length;
        const length = sequences[0]!.length;
        const ids = new BigInt64Array(count * length);
        const repeated = new Float32Array(features.length * count);
        for (const [index, tokens] of sequences.entries()) {
          for (let i = 0; i < length; i++) ids[index * length + i] = BigInt(tokens[i]!);
          // The WASM proxy transfers its input buffers, so preserve the original
          // encoder result for subsequent decoder steps.
          repeated.set(features, index * features.length);
        }
        const inputIds = new runtime.Tensor('int64', ids, [count, length]);
        const imageFeatures = new runtime.Tensor('float32', repeated, [
          count,
          ...hidden.dims.slice(1),
        ]);
        const outputs = await decoder
          .run({ input_ids: inputIds, encoder_hidden_states: imageFeatures })
          .finally(() => {
            inputIds.dispose();
            imageFeatures.dispose();
          });
        try {
          const logits = outputs['logits']?.data;
          if (!(logits instanceof Float32Array) || logits.length !== count * length * 6144) {
            throw new Error('MangaOCR returned invalid decoder output');
          }
          const last = new Float32Array(count * 6144);
          for (let i = 0; i < count; i++) {
            last.set(
              logits.subarray((i * length + length - 1) * 6144, (i * length + length) * 6144),
              i * 6144,
            );
          }
          return last;
        } finally {
          for (const tensor of Object.values(outputs)) tensor.dispose();
        }
      }, signal);
      const text = result.tokens
        .filter((id) => id > 4)
        .map((id) => vocabulary[id])
        .join('')
        .replace(/\s+/gu, '')
        .replaceAll('…', '...')
        .replace(/[・.]{2,}/gu, (dots) => '.'.repeat(dots.length))
        .replace(/[\uff61-\uff9f]+/gu, (kana) => kana.normalize('NFKC'))
        .replace(/[!-~]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0));
      return text ? { text, confidence: result.confidence } : null;
    } finally {
      for (const tensor of Object.values(encoded)) tensor.dispose();
    }
  }

  #getModel(): Promise<Model> {
    if (this.#model) return this.#model;
    const signal = this.#abort.signal;
    const loaded = ASSETS.map(() => 0);
    const total = ASSETS.reduce((sum, entry) => sum + entry.maximumDownloadBytes, 0);
    const sessions: InferenceSession[] = [];
    const model = Promise.all([
      import('onnxruntime-web/wasm'),
      Promise.all(
        ASSETS.map((entry, index) =>
          fetchVerifiedModelAsset({
            ...entry,
            signal,
            onProgress: (progress) => {
              loaded[index] = progress.loaded;
              this.#onDownloadProgress?.({
                loaded: loaded.reduce((sum, bytes) => sum + bytes, 0),
                total,
              });
            },
          }),
        ),
      ),
    ])
      .then(async ([runtime, buffers]) => {
        signal.throwIfAborted();
        const vocabulary = new TextDecoder().decode(buffers[2]).trimEnd().split(/\r?\n/u);
        if (vocabulary.length !== 6144)
          throw new Error('MangaOCR vocabulary has an invalid length');
        runtime.env.wasm.proxy = true;
        runtime.env.wasm.wasmPaths = '/vendor/onnxruntime/';
        for (const buffer of buffers.slice(0, 2)) {
          sessions.push(
            await runtime.InferenceSession.create(buffer, {
              executionProviders: ['wasm'],
              graphOptimizationLevel: 'all',
            }),
          );
          signal.throwIfAborted();
        }
        return { runtime, encoder: sessions[0]!, decoder: sessions[1]!, vocabulary };
      })
      .catch(async (error: unknown) => {
        await Promise.allSettled(sessions.map((session) => session.release()));
        if (this.#model === model) this.#model = null;
        throw error;
      });
    this.#model = model;
    return model;
  }
}
