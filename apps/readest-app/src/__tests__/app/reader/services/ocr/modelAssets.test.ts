import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadModelAsset } from '@/plugins/ocr/modelAssets';

const model = 'model data';
const asset = {
  url: 'https://models.test/model.gz',
  sha256: createHash('sha256').update(model).digest('hex'),
  bytes: model.length,
  gzip: true,
};

const stub = (body: () => BodyInit) => {
  const kept = new Map<string, Uint8Array<ArrayBuffer>>();
  const fetch = vi.fn(async () => new Response(body()));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('caches', {
    has: async () => false,
    match: async (url: string) => kept.has(url) && new Response(kept.get(url)),
    open: async () => ({
      put: async (url: string, response: Response) =>
        kept.set(url, new Uint8Array(await response.arrayBuffer())),
    }),
  });
  return { kept, fetch };
};

afterEach(() => vi.unstubAllGlobals());

it('downloads a model once, and again when the kept copy is damaged', async () => {
  const { kept, fetch } = stub(() => gzipSync(model));
  const load = async () => new TextDecoder().decode(await loadModelAsset(asset));

  expect(await load()).toBe(model);
  await vi.waitFor(() => expect(kept.size).toBe(1));
  expect(await load()).toBe(model);
  expect(fetch).toHaveBeenCalledTimes(1);

  kept.set(asset.url, new Uint8Array([1, 2, 3]));
  expect(await load()).toBe(model);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('rejects a model that is larger than, or differs from, the pinned one', async () => {
  stub(() => gzipSync('model data!'));
  await expect(loadModelAsset(asset)).rejects.toThrow('larger than 10 bytes');
  stub(() => gzipSync('MODEL DATA'));
  await expect(loadModelAsset(asset)).rejects.toThrow('checksum');
});
