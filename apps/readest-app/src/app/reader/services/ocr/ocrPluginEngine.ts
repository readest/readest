import { getBundledPlugin } from '@/services/plugins/catalog';
import type { PluginPayload } from '@/services/plugins/contract';
import type { OcrPage } from '@/services/plugins/ocr';
import { createPluginRuntime } from '@/services/plugins/runtime';
import type { OcrEngine, OcrImageSource } from './ocrSession';

export interface OcrEngineProgress {
  status: string;
  progress: number;
}

type OcrPluginEngineOptions = PluginPayload<'recognize'>['options'] & {
  onProgress?: (progress: OcrEngineProgress) => void;
};

export class OcrPluginEngine implements OcrEngine {
  readonly #options: OcrPluginEngineOptions;
  readonly #workerCanvas =
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    new OffscreenCanvas(1, 1).getContext('2d') !== null;
  readonly #runtime = createPluginRuntime({
    createWorker: () => {
      const plugin = getBundledPlugin('readest.ocr');
      if (!plugin) throw new Error('OCR plugin is unavailable');
      return plugin.createWorker('recognize');
    },
  });
  #terminated = false;
  #fallback: Promise<OcrEngine> | null = null;

  constructor(options: OcrPluginEngineOptions) {
    this.#options = options;
  }

  async recognize(
    source: OcrImageSource,
    page: PluginPayload<'recognize'>['page'],
    signal?: AbortSignal,
  ): Promise<OcrPage> {
    signal?.throwIfAborted();
    if (this.#terminated) throw new DOMException('OCR engine closed', 'AbortError');
    // Older WebKit can run OCR but cannot prepare 2D canvases in a worker.
    if (!this.#workerCanvas) {
      this.#fallback ??= import('@/plugins/ocr/tesseractEngine').then(
        ({ TesseractOcrEngine }) => new TesseractOcrEngine(this.#options),
      );
      const engine = await this.#fallback;
      signal?.throwIfAborted();
      if (this.#terminated) throw new DOMException('OCR engine closed', 'AbortError');
      return engine.recognize(source, page, signal);
    }
    const image = typeof source === 'string' ? source : await createImageBitmap(source);
    try {
      signal?.throwIfAborted();
      if (this.#terminated) throw new DOMException('OCR engine closed', 'AbortError');
      const { onProgress, ...options } = this.#options;
      return await this.#runtime.call(
        'recognize',
        { image, page, options },
        {
          signal,
          transfer: typeof image === 'string' ? [] : [image],
          onProgress: ({ stage, completed, total }) =>
            onProgress?.({ status: stage, progress: total ? completed / total : 0 }),
        },
      );
    } finally {
      if (typeof image !== 'string') image.close();
    }
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#runtime.close();
    await this.#fallback?.then(
      (engine) => engine.terminate(),
      () => undefined,
    );
  }
}
