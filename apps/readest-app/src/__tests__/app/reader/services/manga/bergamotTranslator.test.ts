import { describe, expect, it, vi } from 'vitest';

import { BergamotJapaneseTranslator } from '@/app/reader/services/manga/bergamotTranslator';
import type { VerifiedModelAsset } from '@/app/reader/services/manga/modelAssets';

interface RpcMessage {
  id: number;
  name: string;
  args: unknown[];
}

class FakeWorker {
  readonly messages: Array<{ message: RpcMessage; transfer: readonly Transferable[] }> = [];
  readonly terminate = vi.fn();
  readonly #listeners = {
    message: new Set<(event: MessageEvent) => void>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };

  constructor(private readonly autoRespond = true) {}

  addEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    this.#listeners[type].add(listener as never);
  }

  postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    const rpcMessage = message as RpcMessage;
    this.messages.push({ message: rpcMessage, transfer });
    if (!this.autoRespond) return;
    queueMicrotask(() => {
      const result =
        rpcMessage.name === 'translate'
          ? (rpcMessage.args[0] as { texts: Array<{ text: string }> }).texts.map(({ text }) => ({
              target: { text: `EN:${text}` },
            }))
          : undefined;
      this.emitMessage({ id: rpcMessage.id, result });
    });
  }

  emitMessage(data: unknown): void {
    for (const listener of this.#listeners.message) listener({ data } as MessageEvent);
  }
}

describe('BergamotJapaneseTranslator', () => {
  it('loads the pinned model on demand, translates a batch, and reuses one worker', async () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const progress = vi.fn();
    const loadAsset = vi.fn(async (asset: VerifiedModelAsset) => {
      asset.onProgress?.({ loaded: 1, total: 1 });
      return new Uint8Array([1]).buffer;
    });
    const translator = new BergamotJapaneseTranslator(
      { onProgress: progress },
      { createWorker, loadAsset },
    );

    await expect(translator.translate([])).resolves.toEqual([]);
    expect(createWorker).not.toHaveBeenCalled();

    await expect(translator.translate(['こんにちは', '悟空'])).resolves.toEqual([
      'EN:こんにちは',
      'EN:悟空',
    ]);
    await expect(translator.translate(['ブルマ'])).resolves.toEqual(['EN:ブルマ']);

    expect(createWorker).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledWith('/vendor/bergamot/translator-worker.js');
    expect(loadAsset).toHaveBeenCalledTimes(3);
    expect(loadAsset.mock.calls.map(([asset]) => asset.compression)).toEqual([
      'gzip',
      'gzip',
      'gzip',
    ]);
    expect(loadAsset.mock.calls.map(([asset]) => asset.sha256)).toEqual([
      '3a603e20bfe1be86071913f9e23ab5129075bc0a8490151020ac4821e4f17302',
      '5cb217758bae05877bb3f0c2f612e4e7c1e4cb03c10db11f4a47098d7ae62919',
      '525f412f0d210536c2933c78ae395fa0bf2b5ee6cc5dda61ebc2e79410ebaee4',
    ]);
    expect(worker.messages.map(({ message }) => message.name)).toEqual([
      'initialize',
      'loadTranslationModel',
      'translate',
      'translate',
    ]);
    expect(worker.messages[1]?.transfer).toHaveLength(3);
    expect(progress).toHaveBeenLastCalledWith({
      status: 'loading translation model',
      progress: 1,
    });

    await translator.terminate();
    await translator.terminate();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects oversized batches before loading the runtime', async () => {
    const createWorker = vi.fn();
    const translator = new BergamotJapaneseTranslator({}, { createWorker });

    await expect(translator.translate(Array.from({ length: 129 }, () => '文'))).rejects.toThrow(
      '128',
    );
    await expect(translator.translate(['文'.repeat(2_001)])).rejects.toThrow('2000');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('rejects pending work and stops the worker when terminated', async () => {
    const worker = new FakeWorker(false);
    const translator = new BergamotJapaneseTranslator(
      {},
      {
        createWorker: () => worker,
        loadAsset: async () => new ArrayBuffer(1),
      },
    );

    const translation = translator.translate(['待つ']);
    await vi.waitFor(() => expect(worker.messages[0]?.message.name).toBe('initialize'));
    await translator.terminate();

    await expect(translation).rejects.toThrow('terminated');
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(translator.translate(['後'])).rejects.toThrow('terminated');
  });
});
