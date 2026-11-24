import type { InferenceSession } from 'onnxruntime-web';
import { loadModelAsset, type ModelAsset } from './modelAssets';
import { decodeMangaText } from './mangaOcrDecode';
import { LazyModel } from './lazyModel';
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

const loadModel = async (
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Model> => {
  const loaded = ASSETS.map(() => 0);
  const total = ASSETS.reduce((sum, { bytes }) => sum + bytes, 0);
  const [runtime, ...files] = await Promise.all([
    loadOnnxRuntime(),
    ...ASSETS.map((asset, index) =>
      loadModelAsset(asset, {
        signal,
        onProgress: (bytes) => {
          loaded[index] = bytes;
          onProgress?.(loaded.reduce((sum, value) => sum + value, 0) / total);
        },
      }),
    ),
  ]);
  signal.throwIfAborted();
  const encoder = await createOnnxSession(runtime, files[0]!);
  try {
    signal.throwIfAborted();
    const decoder = await createOnnxSession(runtime, files[1]!);
    const vocabulary = new TextDecoder().decode(files[2]).trimEnd().split(/\r?\n/u);
    return { runtime, encoder, decoder, vocabulary };
  } catch (error) {
    await encoder.release();
    throw error;
  }
};

export class MangaOcrRecognizer implements MangaRecognizer {
  readonly #fast: PaddleJapaneseRecognizer;
  readonly #model: LazyModel<Model>;
  #mangaUnavailable = false;

  constructor(options: { onDownloadProgress?: (progress: number) => void } = {}) {
    this.#fast = new PaddleJapaneseRecognizer(options);
    this.#model = new LazyModel(
      (signal) => loadModel(signal, options.onDownloadProgress),
      ({ encoder, decoder }) => Promise.all([encoder.release(), decoder.release()]),
    );
  }

  prepare(): void {
    this.#fast.prepare();
  }

  async recognize(
    crops: readonly MangaTextCrop[],
    { signal, onProgress }: MangaRecognitionOptions = {},
  ): Promise<Array<MangaRecognition | null>> {
    this.#model.throwIfTerminated();
    signal?.throwIfAborted();
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

  async terminate(): Promise<void> {
    await Promise.all([this.#fast.terminate(), this.#model.terminate()]);
  }

  async #refine(
    crop: MangaTextCrop,
    fast: MangaRecognition | null,
    signal?: AbortSignal,
  ): Promise<MangaRecognition | null> {
    try {
      const refined = await this.#model.use((model) => this.#recognizeManga(model, crop, signal));
      return refined && refined.confidence >= 80 ? refined : fast;
    } catch (error) {
      this.#model.throwIfTerminated();
      signal?.throwIfAborted();
      this.#mangaUnavailable = true;
      console.warn('MangaOCR refinement unavailable; keeping the fast OCR result', error);
      return fast;
    }
  }

  async #recognizeManga(
    { runtime, encoder, decoder, vocabulary }: Model,
    crop: MangaTextCrop,
    signal?: AbortSignal,
  ): Promise<MangaRecognition | null> {
    signal?.throwIfAborted();
    // MangaOCR reads upright grayscale crops, resized to 224x224 and normalized
    // to [-1, 1], with vertical writing and without padding.
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
    const image = new runtime.Tensor('float32', pixels, [1, 3, 224, 224]);
    const { last_hidden_state: hidden } = await encoder.run({ pixel_values: image });
    if (!hidden || !(hidden.data instanceof Float32Array)) {
      throw new Error('MangaOCR returned invalid image features');
    }
    const features = hidden.data;
    const result = await decodeMangaText(async (sequences) => {
      this.#model.throwIfTerminated();
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
      const { logits } = await decoder.run({
        input_ids: new runtime.Tensor('int64', ids, [count, length]),
        encoder_hidden_states: new runtime.Tensor('float32', repeated, [
          count,
          ...hidden.dims.slice(1),
        ]),
      });
      const scores = logits?.data;
      if (!(scores instanceof Float32Array) || scores.length !== count * length * 6144) {
        throw new Error('MangaOCR returned invalid decoder output');
      }
      const last = new Float32Array(count * 6144);
      for (let i = 0; i < count; i++) {
        const end = (i + 1) * length * 6144;
        last.set(scores.subarray(end - 6144, end), i * 6144);
      }
      return last;
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
  }
}
