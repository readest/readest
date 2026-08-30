import { describe, expect, it, vi } from 'vitest';

import { fetchVerifiedModelAsset } from '@/app/reader/services/manga/modelAssets';

const SHA256 = '00'.repeat(32);

const responseWithChunks = (chunks: readonly Uint8Array[], contentLength?: number): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Response(stream, { status: 200, headers });
};

const successDependencies = (response: Response) => ({
  fetchImpl: vi.fn(async () => response),
  digestSha256: vi.fn(async () => SHA256),
});

describe('fetchVerifiedModelAsset', () => {
  it('streams, bounds, verifies, and reports a model download', async () => {
    const dependencies = successDependencies(
      responseWithChunks([new Uint8Array([1, 2]), new Uint8Array([3])], 3),
    );
    const progress = vi.fn();

    const result = await fetchVerifiedModelAsset(
      {
        url: 'https://models.example/model.onnx',
        sha256: SHA256,
        maximumDownloadBytes: 4,
        maximumResultBytes: 4,
        onProgress: progress,
      },
      dependencies,
    );

    expect([...new Uint8Array(result)]).toEqual([1, 2, 3]);
    expect(dependencies.fetchImpl).toHaveBeenCalledWith(
      'https://models.example/model.onnx',
      expect.objectContaining({ cache: 'force-cache', credentials: 'omit' }),
    );
    expect(dependencies.digestSha256).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith({ loaded: 3, total: 3 });
  });

  it('rejects an unsuccessful response with its status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.onnx',
          sha256: SHA256,
          maximumDownloadBytes: 4,
          maximumResultBytes: 4,
        },
        { fetchImpl, digestSha256: async () => SHA256 },
      ),
    ).rejects.toThrow('503');
  });

  it('rejects an oversized content length before reading the body', async () => {
    const dependencies = successDependencies(responseWithChunks([], 5));

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.onnx',
          sha256: SHA256,
          maximumDownloadBytes: 4,
          maximumResultBytes: 4,
        },
        dependencies,
      ),
    ).rejects.toThrow('larger than 4 bytes');
    expect(dependencies.digestSha256).not.toHaveBeenCalled();
  });

  it('rejects an oversized streamed body when content length is absent', async () => {
    const dependencies = successDependencies(responseWithChunks([new Uint8Array(5)]));

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.onnx',
          sha256: SHA256,
          maximumDownloadBytes: 4,
          maximumResultBytes: 4,
        },
        dependencies,
      ),
    ).rejects.toThrow('larger than 4 bytes');
  });

  it('rejects data whose SHA-256 does not match', async () => {
    const dependencies = {
      ...successDependencies(responseWithChunks([new Uint8Array([1])])),
      digestSha256: vi.fn(async () => 'ff'.repeat(32)),
    };

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.onnx',
          sha256: SHA256,
          maximumDownloadBytes: 4,
          maximumResultBytes: 4,
        },
        dependencies,
      ),
    ).rejects.toThrow('checksum');
  });

  it('decompresses gzip data before checking its size and checksum', async () => {
    const gzip = new Uint8Array(8);
    gzip.set([0x1f, 0x8b]);
    new DataView(gzip.buffer).setUint32(4, 3, true);
    const dependencies = {
      ...successDependencies(responseWithChunks([gzip])),
      decompressGzip: vi.fn(async () => new Uint8Array([4, 5, 6])),
    };

    const result = await fetchVerifiedModelAsset(
      {
        url: 'https://models.example/model.bin.gz',
        sha256: SHA256,
        compressedSha256: SHA256,
        compression: 'gzip',
        maximumDownloadBytes: 8,
        maximumResultBytes: 3,
      },
      dependencies,
    );

    expect([...new Uint8Array(result)]).toEqual([4, 5, 6]);
    expect(dependencies.decompressGzip).toHaveBeenCalledOnce();
    expect(dependencies.digestSha256).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]));
  });

  it('rejects a compressed checksum mismatch before decompression', async () => {
    const gzip = new Uint8Array(8);
    gzip.set([0x1f, 0x8b]);
    const decompressGzip = vi.fn(async () => new Uint8Array([1]));

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.bin.gz',
          sha256: SHA256,
          compressedSha256: SHA256,
          compression: 'gzip',
          maximumDownloadBytes: 8,
          maximumResultBytes: 4,
        },
        {
          ...successDependencies(responseWithChunks([gzip])),
          digestSha256: vi.fn(async () => 'ff'.repeat(32)),
          decompressGzip,
        },
      ),
    ).rejects.toThrow('compressed checksum');
    expect(decompressGzip).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized gzip output before decompression', async () => {
    const decompressGzip = vi.fn(async () => new Uint8Array());
    const malformed = successDependencies(responseWithChunks([new Uint8Array(3)]));

    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.bin.gz',
          sha256: SHA256,
          compressedSha256: SHA256,
          compression: 'gzip',
          maximumDownloadBytes: 8,
          maximumResultBytes: 4,
        },
        { ...malformed, decompressGzip },
      ),
    ).rejects.toThrow('malformed gzip');

    const gzip = new Uint8Array(8);
    gzip.set([0x1f, 0x8b]);
    new DataView(gzip.buffer).setUint32(4, 5, true);
    const oversized = successDependencies(responseWithChunks([gzip]));
    await expect(
      fetchVerifiedModelAsset(
        {
          url: 'https://models.example/model.bin.gz',
          sha256: SHA256,
          compressedSha256: SHA256,
          compression: 'gzip',
          maximumDownloadBytes: 8,
          maximumResultBytes: 4,
        },
        { ...oversized, decompressGzip },
      ),
    ).rejects.toThrow('expands beyond 4 bytes');
    expect(decompressGzip).not.toHaveBeenCalled();
  });

  it('passes cancellation to an in-flight model request', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener(
            'abort',
            () => reject(init?.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const request = fetchVerifiedModelAsset(
      {
        url: 'https://models.example/model.onnx',
        sha256: SHA256,
        maximumDownloadBytes: 4,
        maximumResultBytes: 4,
        signal: controller.signal,
      },
      { fetchImpl, digestSha256: async () => SHA256 },
    );

    expect(requestSignal).toBe(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
