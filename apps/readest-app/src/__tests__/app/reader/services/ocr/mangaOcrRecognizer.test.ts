import { expect, it, vi } from 'vitest';
import { MangaOcrRecognizer } from '@/app/reader/services/ocr/mangaOcrRecognizer';

const mocks = vi.hoisted(() => ({
  fast: vi.fn(),
  terminate: vi.fn(),
  load: vi.fn(),
  release: vi.fn(),
  onDecoderRun: vi.fn(),
}));
vi.mock('@/app/reader/services/ocr/paddleJapaneseRecognizer', () => ({
  PaddleJapaneseRecognizer: class {
    recognize = mocks.fast;
    terminate = mocks.terminate;
  },
}));
vi.mock('@/app/reader/services/manga/modelAssets', () => ({ fetchVerifiedModelAsset: mocks.load }));
vi.mock('onnxruntime-web/wasm', () => {
  class Tensor {
    constructor(
      public type: string,
      public data: Float32Array | BigInt64Array,
      public dims: number[],
    ) {}
    dispose() {}
  }
  return {
    Tensor,
    env: { wasm: {} },
    InferenceSession: {
      create: async () => ({
        release: mocks.release,
        run: async (feeds: Record<string, Tensor>) => {
          if (feeds['pixel_values'])
            return { last_hidden_state: new Tensor('float32', new Float32Array(1), [1, 1, 1]) };
          mocks.onDecoderRun();
          const [count, length] = feeds['input_ids']!.dims as [number, number];
          const data = new Float32Array(count * length * 6144).fill(-100);
          for (let i = 0; i < count; i++)
            data[(i * length + length - 1) * 6144 + (length === 1 ? 5 : 3)] = 20;
          return { logits: new Tensor('float32', data, [count, length, 6144]) };
        },
      }),
    },
  };
});

it('loads refinement only for weak text, reuses models, and releases them on cancellation', async () => {
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(224 * 224 * 4).fill(255) }),
  } as unknown as CanvasRenderingContext2D);
  mocks.fast.mockResolvedValue({ text: '犬', confidence: 99 });
  mocks.load.mockImplementation(
    async () => new TextEncoder().encode(Array(6144).fill('猫').join('\n')).buffer,
  );
  const recognizer = new MangaOcrRecognizer();
  const source = document.createElement('canvas');
  const crop = vi.fn(() => source);
  try {
    expect(await recognizer.recognize(source, crop)).toEqual({ text: '犬', confidence: 99 });
    expect(crop).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.fast.mockResolvedValue({ text: '犬', confidence: 60 });
    expect(await recognizer.recognize(source, crop)).toMatchObject({ text: '猫' });
    expect(await recognizer.recognize(source, crop)).toMatchObject({ text: '猫' });
    expect(mocks.load).toHaveBeenCalledTimes(3);
    const cancellation = new AbortController();
    mocks.onDecoderRun.mockClear();
    mocks.onDecoderRun.mockImplementationOnce(() => cancellation.abort());
    await expect(recognizer.recognize(source, crop, cancellation.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mocks.onDecoderRun).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.onDecoderRun.mockReset();
    expect(await recognizer.recognize(source, crop)).toMatchObject({ text: '猫' });
    expect(mocks.load).toHaveBeenCalledTimes(3);
    await recognizer.terminate();
    await expect(recognizer.recognize(source, crop)).rejects.toThrow();
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
  } finally {
    await recognizer.terminate();
    context.mockRestore();
  }
});
