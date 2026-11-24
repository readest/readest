import type { InferenceSession } from 'onnxruntime-web';
import { loadModelAsset, type ModelAsset } from './modelAssets';
import { decodeMangaText } from './mangaOcrDecode';
import { createOnnxSession, loadOnnxRuntime, type OnnxRuntime } from './onnxRuntime';
import { createOcrCanvas } from './canvas';
import { drawMangaTextCrop, type MangaTextCrop } from './mangaTextCrop';
import {
  PaddleJapaneseRecognizer,
  type MangaRecognition,
  type MangaRecognitionOptions,
  type MangaRecognizer,
} from './paddleJapaneseRecognizer';
import { yieldToCancellation } from './yieldToCancellation';

const REVISION = '3e8ddcd02cd50e897358223fce8b2784e44093ab';
const BASE_URL = `https://huggingface.co/WhiteHades/manga-ocr-browser/resolve/${REVISION}`;
const ASSETS = [
  {
    url: `${BASE_URL}/encoder_model_quantized.onnx.gz`,
    sha256: 'ddd1af56963093795705fa38da6ce7e6567d1658e7c7359db7e13fcd37dbf279',
    bytes: 86_967_767,
    gzip: true,
  },
  {
    url: `${BASE_URL}/decoder_model_quantized.onnx.gz`,
    sha256: '2e7177d2b0a59f1c612b694ed70c13971bee765cc2b2bc7bc9376e4753652f27',
    bytes: 29_627_936,
    gzip: true,
  },
  {
    url: `${BASE_URL}/vocab.txt`,
    sha256: '344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d',
    bytes: 24_072,
  },
] satisfies ModelAsset[];

interface Model {
  runtime: OnnxRuntime;
  encoder: InferenceSession;
  decoder: InferenceSession;
  vocabulary: string[];
}

export class MangaOcrRecognizer implements MangaRecognizer {
  readonly #abort = new AbortController();
  readonly #onDownloadProgress?: (progress: number) => void;
  readonly #fast: PaddleJapaneseRecognizer;
  #active: Promise<unknown> = Promise.resolve();
  #mangaUnavailable = false;
  #model: Promise<Model> | null = null;

  constructor(options: { onDownloadProgress?: (progress: number) => void } = {}) {
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#fast = new PaddleJapaneseRecognizer(options);
  }

  prepare(): void {
    this.#fast.prepare();
  }

  async recognize(
    crops: readonly MangaTextCrop[],
    options: MangaRecognitionOptions = {},
  ): Promise<Array<MangaRecognition | null>> {
    this.#abort.signal.throwIfAborted();
    options.signal?.throwIfAborted();
    const run = this.#recognize(crops, options);
    this.#active = run.catch(() => undefined);
    return run;
  }

  async terminate(): Promise<void> {
    if (this.#abort.signal.aborted) return;
    this.#abort.abort();
    await Promise.all([this.#active, this.#fast.terminate()]);
    const model = await this.#model?.catch(() => null);
    this.#model = null;
    if (model) await Promise.all([model.encoder.release(), model.decoder.release()]);
  }

  async #recognize(
    crops: readonly MangaTextCrop[],
    { signal, onProgress }: MangaRecognitionOptions,
  ): Promise<Array<MangaRecognition | null>> {
    const results = await this.#fast.recognize(crops, { signal });
    let recognized = 0;
    for (const [index, fast] of results.entries()) {
      // ponytail: confidence routing can miss confident errors. Our sample favoured
      // Paddle narration; revisit this threshold with broader labelled samples.
      if (!this.#mangaUnavailable && !(fast && fast.confidence >= 80)) {
        await yieldToCancellation(signal);
        results[index] = await this.#refine(crops[index]!, fast, signal);
      }
      recognized += 1;
      onProgress?.(recognized);
    }
    return results;
  }

  async #refine(
    crop: MangaTextCrop,
    fast: MangaRecognition | null,
    signal?: AbortSignal,
  ): Promise<MangaRecognition | null> {
    try {
      const refined = await this.#recognizeManga(crop, signal);
      return refined && refined.confidence >= 80 ? refined : fast;
    } catch (error) {
      this.#abort.signal.throwIfAborted();
      signal?.throwIfAborted();
      this.#mangaUnavailable = true;
      console.warn('MangaOCR refinement unavailable; keeping the fast OCR result', error);
      return fast;
    }
  }

  async #recognizeManga(
    crop: MangaTextCrop,
    signal?: AbortSignal,
  ): Promise<MangaRecognition | null> {
    const { runtime, encoder, decoder, vocabulary } = await this.#getModel();
    const terminationSignal = this.#abort.signal;
    terminationSignal.throwIfAborted();
    signal?.throwIfAborted();
    // MangaOCR reads upright grayscale crops, resized to 224x224 and normalized
    // to [-1, 1]. The
    // crop keeps vertical writing, without padding.
    const canvas = createOcrCanvas(224, 224);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('MangaOCR could not prepare the text crop');
    context.drawImage(drawMangaTextCrop(crop, 0), 0, 0, 224, 224);
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
        signal?.throwIfAborted();
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
          signal?.throwIfAborted();
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
      }, terminationSignal);
      signal?.throwIfAborted();
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
    const total = ASSETS.reduce((sum, entry) => sum + entry.bytes, 0);
    const sessions: InferenceSession[] = [];
    const model = Promise.all([
      loadOnnxRuntime(),
      Promise.all(
        ASSETS.map((entry, index) =>
          loadModelAsset(entry, {
            signal,
            onProgress: (bytes) => {
              loaded[index] = bytes;
              this.#onDownloadProgress?.(loaded.reduce((sum, value) => sum + value, 0) / total);
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
        for (const buffer of buffers.slice(0, 2)) {
          sessions.push(await createOnnxSession(runtime, buffer));
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
