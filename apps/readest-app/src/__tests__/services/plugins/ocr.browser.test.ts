import { expect, test } from 'vitest';
import { getBundledPlugin } from '@/services/plugins/catalog';
import { pluginManifestSchema } from '@/services/plugins/contract';
import { createPluginRuntime } from '@/services/plugins/runtime';

const page = { pageIndex: 0, width: 32, height: 32 };
const makeImage = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(123, 0, 0)';
  context.fillRect(0, 0, 32, 32);
  return createImageBitmap(canvas);
};
const createWorker = () =>
  new Worker(new URL('./fixtures/ocr.worker.ts', import.meta.url), { type: 'module' });

test('registers OCR and transfers page pixels through the shared plugin runtime', async () => {
  expect(
    pluginManifestSchema.parse(getBundledPlugin('readest.ocr')?.manifest).contributions.ocr,
  ).toBe(true);
  let started = false;
  const runtime = createPluginRuntime({
    createWorker: () => {
      started = true;
      return createWorker();
    },
  });
  const image = await makeImage();
  const progress: number[] = [];
  try {
    expect(started).toBe(false);
    const result = runtime.call(
      'recognize',
      { image, page, options: {} },
      {
        transfer: [image],
        onProgress: ({ completed }) => progress.push(completed),
      },
    );
    expect(image.width).toBe(0);
    await expect(result).resolves.toMatchObject({
      ...page,
      blocks: [{ text: '123', writingMode: 'vertical-rl' }],
    });
    expect(progress).toEqual([0, 1]);
  } finally {
    image.close();
    runtime.close();
  }
});

test('cancels work, ignores its result and settles pending work when the worker closes', async () => {
  const runtime = createPluginRuntime({ createWorker });
  const controller = new AbortController();
  const image = await makeImage();
  try {
    const cancelled = runtime.call(
      'recognize',
      {
        image,
        page: { ...page, pageIndex: 1 },
        options: {},
      },
      {
        transfer: [image],
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
    );
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = await makeImage();
    await expect(
      runtime.call(
        'recognize',
        { image: next, page, options: {} },
        {
          transfer: [next],
        },
      ),
    ).resolves.toMatchObject({ pageIndex: 0 });
    const last = await makeImage();
    const pending = runtime.call(
      'recognize',
      {
        image: last,
        page: { ...page, pageIndex: 1 },
        options: {},
      },
      { transfer: [last], onProgress: () => runtime.close() },
    );
    await expect(pending).rejects.toMatchObject({ code: 'RUNTIME_CLOSED' });
  } finally {
    runtime.close();
  }
});
