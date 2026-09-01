import { describe, expect, it, vi } from 'vitest';

import {
  OpusJapaneseTranslator,
  OPUS_TRANSLATION_MODEL_ID,
  OPUS_TRANSLATION_MODEL_REVISION,
} from '@/app/reader/services/manga/opusJapaneseTranslator';

interface WorkerRequest {
  id: number;
  type: 'translate';
  texts: string[];
}

type TranslationResponder = (texts: readonly string[], callIndex: number) => unknown;

class FakeWorker {
  readonly messages: WorkerRequest[] = [];
  readonly terminate = vi.fn();
  readonly #listeners = {
    message: new Set<(event: MessageEvent) => void>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };
  #failed = false;
  #translationCallIndex = 0;

  constructor(
    private readonly autoRespond = true,
    private readonly responder?: TranslationResponder,
  ) {}

  addEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    this.#listeners[type].add(listener as never);
  }

  postMessage(message: unknown): void {
    if (this.#failed) throw new Error('Worker is no longer running');
    const request = message as WorkerRequest;
    this.messages.push(request);
    if (!this.autoRespond) return;
    queueMicrotask(() => {
      const translations = this.responder
        ? this.responder(request.texts, this.#translationCallIndex++)
        : request.texts.map((text) => `EN:${text}`);
      this.emitMessage({ type: 'result', id: request.id, translations });
    });
  }

  emitMessage(data: unknown): void {
    for (const listener of this.#listeners.message) listener({ data } as MessageEvent);
  }

  emitError(error: Error): void {
    this.#failed = true;
    for (const listener of this.#listeners.error) {
      listener({ error, message: error.message } as ErrorEvent);
    }
  }
}

describe('OpusJapaneseTranslator', () => {
  it('pins the browser model and translates on demand through one worker', async () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const onProgress = vi.fn();
    const translator = new OpusJapaneseTranslator({ onProgress }, { createWorker });

    expect(OPUS_TRANSLATION_MODEL_ID).toBe('Xenova/opus-mt-ja-en');
    expect(OPUS_TRANSLATION_MODEL_REVISION).toBe('1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16');
    await expect(translator.translate([])).resolves.toEqual([]);
    expect(createWorker).not.toHaveBeenCalled();

    await expect(translator.translate(['まって', '悟空'])).resolves.toEqual([
      'EN:まって',
      'EN:悟空',
    ]);
    await expect(translator.translate(['ブルマ'])).resolves.toEqual(['EN:ブルマ']);

    expect(createWorker).toHaveBeenCalledOnce();
    expect(worker.messages.map(({ texts }) => texts)).toEqual([['まって', '悟空'], ['ブルマ']]);

    worker.emitMessage({ type: 'progress', progress: 0.75 });
    expect(onProgress).toHaveBeenLastCalledWith({
      status: 'loading translation model',
      progress: 0.75,
    });

    await translator.terminate();
    await translator.terminate();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('splits large requests into bounded worker calls and preserves order', async () => {
    const worker = new FakeWorker();
    const translator = new OpusJapaneseTranslator({}, { createWorker: () => worker });
    const texts = Array.from({ length: 129 }, (_, index) => `文${index}`);

    await expect(translator.translate(texts)).resolves.toEqual(texts.map((text) => `EN:${text}`));
    expect(worker.messages.map(({ texts: batch }) => batch.length)).toEqual([128, 1]);
  });

  it('splits requests at the total character limit', async () => {
    const worker = new FakeWorker();
    const translator = new OpusJapaneseTranslator({}, { createWorker: () => worker });
    const texts = Array.from({ length: 11 }, () => '文'.repeat(2_000));

    await expect(translator.translate(texts)).resolves.toHaveLength(11);
    expect(worker.messages.map(({ texts: batch }) => batch.length)).toEqual([10, 1]);
  });

  it('retries empty or malformed batch entries without shifting results', async () => {
    const worker = new FakeWorker(true, (texts, callIndex) => {
      if (callIndex === 0) return ['First', '', 'Third'];
      if (texts[0] === '二') return ['Second'];
      return texts.map((text) => `EN:${text}`);
    });
    const translator = new OpusJapaneseTranslator({}, { createWorker: () => worker });

    await expect(translator.translate(['一', '二', '三'])).resolves.toEqual([
      'First',
      'Second',
      'Third',
    ]);

    const incompleteWorker = new FakeWorker(true, (texts, callIndex) => {
      if (callIndex === 0) return ['unsafe positional result'];
      return texts[0] === '二' ? [] : [`EN:${texts[0]}`];
    });
    const incompleteTranslator = new OpusJapaneseTranslator(
      {},
      { createWorker: () => incompleteWorker },
    );
    await expect(incompleteTranslator.translate(['一', '二', '三'])).resolves.toEqual([
      'EN:一',
      '',
      'EN:三',
    ]);
  });

  it('rejects oversized text before creating the worker', async () => {
    const createWorker = vi.fn();
    const translator = new OpusJapaneseTranslator({}, { createWorker });

    await expect(translator.translate(['文'.repeat(2_001)])).rejects.toThrow('2000');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('rejects pending work and stops the worker when terminated', async () => {
    const worker = new FakeWorker(false);
    const translator = new OpusJapaneseTranslator({}, { createWorker: () => worker });
    const translation = translator.translate(['待つ']);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

    await translator.terminate();

    await expect(translation).rejects.toThrow('terminated');
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(translator.translate(['後'])).rejects.toThrow('terminated');
  });

  it('replaces a failed worker on the next request', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const createWorker = vi.fn().mockReturnValueOnce(firstWorker).mockReturnValue(secondWorker);
    const translator = new OpusJapaneseTranslator({}, { createWorker });
    await expect(translator.translate(['最初'])).resolves.toEqual(['EN:最初']);

    firstWorker.emitError(new Error('worker crashed'));

    await expect(translator.translate(['次'])).resolves.toEqual(['EN:次']);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
  });
});
