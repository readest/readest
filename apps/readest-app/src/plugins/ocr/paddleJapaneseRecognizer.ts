import type { InferenceSession } from 'onnxruntime-web/wasm';
import { loadModelAsset, type ModelAsset } from './modelAssets';
import { createOnnxSession, loadOnnxRuntime, type OnnxRuntime } from './onnxRuntime';
import { MANGA_CROP_BORDER, type MangaTextCrop } from './mangaTextCrop';
import { yieldToCancellation } from './yieldToCancellation';

const MODEL_REVISION = 'b8f84f0b80c529de40b4fbb3544b84fa7233a513';
const DICTIONARY_REVISION = '2661c7c0ef5c613e8f93c6e93b2e052399f0f854';

const MODEL: ModelAsset = {
  url: `https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/${MODEL_REVISION}/inference.onnx`,
  sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
  bytes: 21_159_378,
};

const DICTIONARY: ModelAsset = {
  url: `https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@${DICTIONARY_REVISION}/ppocr/utils/dict/ppocrv6_dict.txt`,
  sha256: 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d',
  bytes: 74_947,
};
const DICTIONARY_LENGTH = 18_708;

const LINE_HEIGHT = 48;
// The model reads the end of a line better with space after it. Lines of the same
// width are read together.
const LINE_PADDING = 64;
const LINE_WIDTH_STEP = 32;
const BATCH_SIZE = 8;
// Pixels are read in -1 to 1.
const PIXEL_VALUES = Float32Array.from(
  { length: 256 },
  (_, value) => value * (1 / 127.5) - 127.5 * (1 / 127.5),
);

export interface MangaRecognition {
  text: string;
  confidence: number;
}

export interface MangaRecognizer {
  /** Loads what the first lines need, so that they don't wait for it. */
  prepare: () => void;
  /** Reads each crop, `null` where it finds no text. */
  recognize: (
    crops: readonly MangaTextCrop[],
    options?: MangaRecognitionOptions,
  ) => Promise<Array<MangaRecognition | null>>;
  terminate: () => Promise<void>;
}

export interface MangaRecognitionOptions {
  signal?: AbortSignal;
  /** Called with the number of crops recognized so far. */
  onProgress?: (recognized: number) => void;
}

interface Model {
  runtime: OnnxRuntime;
  session: InferenceSession;
  characters: string[];
}

/** The size of a crop with its border, along and across its text. */
const getLineSize = ({ width, height, vertical }: MangaTextCrop) => {
  const length = (vertical ? height : width) + MANGA_CROP_BORDER * 2;
  const thickness = (vertical ? width : height) + MANGA_CROP_BORDER * 2;
  return { length, thickness, width: Math.ceil(LINE_HEIGHT * (length / thickness)) };
};

const getBatchWidth = (width: number): number =>
  Math.ceil((width + LINE_PADDING) / LINE_WIDTH_STEP) * LINE_WIDTH_STEP;

/** Where each pixel of a resized side falls between two pixels of the crop. */
const getSamples = (from: number, to: number, stride: number, last: number, step: number) => {
  const first = new Int32Array(to);
  const second = new Int32Array(to);
  const weights = new Float64Array(to);
  const getOffset = (position: number) => {
    const pixel = position - MANGA_CROP_BORDER;
    // The border is outside of the crop.
    return pixel < 0 || pixel > last ? -1 : step < 0 ? (last - pixel) * stride : pixel * stride;
  };
  for (let index = 0; index < to; index += 1) {
    const position = (index + 0.5) * (from / to) - 0.5;
    const before = Math.max(0, Math.min(from - 1, Math.floor(position)));
    first[index] = getOffset(before);
    second[index] = getOffset(Math.min(from - 1, before + 1));
    weights[index] = position < 0 || position >= from - 1 ? 0 : position - before;
  }
  return { first, second, weights };
};

/** Writes a crop as a line reading from left to right, in blue, green and red. */
const writeLine = (
  crop: MangaTextCrop,
  target: Float32Array,
  offset: number,
  batchWidth: number,
): void => {
  const { data, width, height, vertical } = crop;
  const { length, thickness, width: lineWidth } = getLineSize(crop);
  const along = vertical
    ? getSamples(length, lineWidth, width * 4, height - 1, 1)
    : getSamples(length, lineWidth, 4, width - 1, 1);
  // A vertical line turns left, so that its right side becomes its top.
  const across = vertical
    ? getSamples(thickness, LINE_HEIGHT, 4, width - 1, -1)
    : getSamples(thickness, LINE_HEIGHT, width * 4, height - 1, 1);
  const read = (x: number, y: number, channel: number) =>
    x < 0 || y < 0 ? 255 : data[x + y + channel]!;
  for (let y = 0; y < LINE_HEIGHT; y += 1) {
    const top = across.first[y]!;
    const bottom = across.second[y]!;
    const yWeight = across.weights[y]!;
    for (let x = 0; x < lineWidth; x += 1) {
      const left = along.first[x]!;
      const right = along.second[x]!;
      const xWeight = along.weights[x]!;
      for (let channel = 0; channel < 3; channel += 1) {
        const above =
          read(left, top, channel) * (1 - xWeight) + read(right, top, channel) * xWeight;
        const below =
          read(left, bottom, channel) * (1 - xWeight) + read(right, bottom, channel) * xWeight;
        const value = Math.round(above * (1 - yWeight) + below * yWeight);
        target[offset + ((2 - channel) * LINE_HEIGHT + y) * batchWidth + x] = PIXEL_VALUES[value]!;
      }
    }
  }
};

/** Reads the likeliest character of each step, without blanks and repeats. */
const decodeLine = (scores: Float32Array, characters: string[]): MangaRecognition | null => {
  const classes = characters.length + 1;
  let text = '';
  let sum = 0;
  let count = 0;
  let last = -1;
  for (let offset = 0; offset < scores.length; offset += classes) {
    let best = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < classes; index += 1) {
      const score = scores[offset + index]!;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    if (best === last) continue;
    last = best;
    if (best === 0) continue;
    text += characters[best - 1]!;
    sum += bestScore;
    count += 1;
  }
  text = text.replaceAll(' ', '').trim();
  return text ? { text, confidence: (sum / count) * 100 } : null;
};

export class PaddleJapaneseRecognizer implements MangaRecognizer {
  readonly #onDownloadProgress?: (progress: number) => void;
  readonly #abort = new AbortController();
  #model: Promise<Model> | null = null;
  #active: Promise<unknown> = Promise.resolve();

  constructor(options: { onDownloadProgress?: (progress: number) => void } = {}) {
    this.#onDownloadProgress = options.onDownloadProgress;
  }

  prepare(): void {
    this.#getModel().catch(() => undefined);
  }

  async recognize(
    crops: readonly MangaTextCrop[],
    options: MangaRecognitionOptions = {},
  ): Promise<Array<MangaRecognition | null>> {
    const run = this.#recognize(crops, options);
    this.#active = run.catch(() => undefined);
    return run;
  }

  async terminate(): Promise<void> {
    if (this.#abort.signal.aborted) return;
    this.#abort.abort();
    const model = await this.#model?.catch(() => null);
    await this.#active;
    await model?.session.release();
  }

  async #recognize(
    crops: readonly MangaTextCrop[],
    { signal, onProgress }: MangaRecognitionOptions,
  ): Promise<Array<MangaRecognition | null>> {
    const { runtime, session, characters } = await this.#getModel();
    const batches = new Map<number, number[]>();
    for (const [index, crop] of crops.entries()) {
      const width = getBatchWidth(getLineSize(crop).width);
      const batch = batches.get(width);
      if (batch) batch.push(index);
      else batches.set(width, [index]);
    }
    const results: Array<MangaRecognition | null> = crops.map(() => null);
    let recognized = 0;
    for (const [width, indexes] of batches) {
      for (let start = 0; start < indexes.length; start += BATCH_SIZE) {
        await yieldToCancellation(signal);
        this.#abort.signal.throwIfAborted();
        const batch = indexes.slice(start, start + BATCH_SIZE);
        const size = 3 * LINE_HEIGHT * width;
        const pixels = new Float32Array(batch.length * size);
        for (const [position, index] of batch.entries()) {
          writeLine(crops[index]!, pixels, position * size, width);
        }
        const shape = [batch.length, 3, LINE_HEIGHT, width];
        const input = new runtime.Tensor('float32', pixels, shape);
        const outputs = await session.run({ [session.inputNames[0]!]: input });
        const scores = outputs[session.outputNames[0]!]!.data as Float32Array;
        const length = scores.length / batch.length;
        for (const [position, index] of batch.entries()) {
          const line = scores.subarray(position * length, (position + 1) * length);
          results[index] = decodeLine(line, characters);
        }
        recognized += batch.length;
        onProgress?.(recognized);
      }
    }
    return results;
  }

  #getModel(): Promise<Model> {
    this.#model ??= this.#loadModel().catch((error: unknown) => {
      this.#model = null;
      throw error;
    });
    return this.#model;
  }

  async #loadModel(): Promise<Model> {
    const { signal } = this.#abort;
    const [runtime, model, dictionary] = await Promise.all([
      loadOnnxRuntime(),
      loadModelAsset(MODEL, {
        signal,
        onProgress: (loaded) => this.#onDownloadProgress?.(loaded / MODEL.bytes),
      }),
      loadModelAsset(DICTIONARY, { signal }),
    ]);
    const characters = new TextDecoder().decode(dictionary).trimEnd().split(/\r?\n/u);
    if (characters.length !== DICTIONARY_LENGTH) {
      throw new Error('Japanese manga recognizer dictionary has an invalid length');
    }
    characters.push(' ');
    return { runtime, session: await createOnnxSession(runtime, model), characters };
  }
}
