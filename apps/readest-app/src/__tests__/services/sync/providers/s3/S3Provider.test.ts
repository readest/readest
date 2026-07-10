import { describe, expect, test, vi } from 'vitest';
import { createS3Provider, type S3FetchFn } from '@/services/sync/providers/s3/S3Provider';
import { FileSyncError } from '@/services/sync/file/provider';
import { runSemanticContract } from '@/__tests__/services/sync/file/providerSemanticContract';

const config = {
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'readest',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
};

const xml = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/xml' } });
const text = (body: string, status = 200): Response => new Response(body, { status });

const emptyList = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`;

const listPage = (opts: {
  prefixes?: string[];
  keys?: { key: string; size?: number; modified?: string }[];
  next?: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  ${opts.next ? `<NextContinuationToken>${opts.next}</NextContinuationToken>` : ''}
  ${(opts.prefixes ?? []).map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join('')}
  ${(opts.keys ?? [])
    .map(
      (k) =>
        `<Contents><Key>${k.key}</Key><Size>${k.size ?? 0}</Size><LastModified>${
          k.modified ?? '2026-01-01T00:00:00.000Z'
        }</LastModified></Contents>`,
    )
    .join('')}
</ListBucketResult>`;

interface Harness {
  provider: ReturnType<typeof createS3Provider>;
  fetchMock: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  url: (n: number) => string;
  method: (n: number) => string | undefined;
  headers: (n: number) => Record<string, string>;
}

const makeS3 = (): Harness => {
  const fetchMock = vi.fn();
  const sleep = vi.fn(async () => {});
  const provider = createS3Provider(config, fetchMock as unknown as S3FetchFn, {
    sleep: sleep as unknown as (ms: number) => Promise<void>,
  });
  return {
    provider,
    fetchMock,
    sleep,
    url: (n) => fetchMock.mock.calls[n]?.[0] as string,
    method: (n) => (fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.method,
    headers: (n) =>
      ((fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.headers ?? {}) as Record<
        string,
        string
      >,
  };
};

// S3 must satisfy the same semantics as WebDAV / Drive. Absent paths are a
// 404 for object ops but an empty 200 listing for deleteDir's prefix scan,
// so the staged response dispatches on the request shape.
runSemanticContract('S3Provider', () => {
  const fetchMock = vi.fn();
  return {
    makeProvider: () =>
      createS3Provider(config, fetchMock as unknown as S3FetchFn, { sleep: async () => {} }),
    stageAbsent: () =>
      fetchMock.mockImplementationOnce(async (url: string) =>
        url.includes('list-type=2') ? xml(emptyList) : new Response(null, { status: 404 }),
      ),
    stageAuthFailure: () => fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 })),
  };
});

describe('S3Provider — transport', () => {
  test('readText GETs the path-style object URL with a SigV4 authorization', async () => {
    const h = makeS3();
    h.fetchMock.mockResolvedValueOnce(text('HELLO'));

    expect(await h.provider.readText('/Readest/library.json')).toBe('HELLO');
    expect(h.url(0)).toBe('https://acc.r2.cloudflarestorage.com/readest/Readest/library.json');
    expect(h.method(0)).toBe('GET');
    expect(h.headers(0)['authorization']).toContain('AWS4-HMAC-SHA256');
  });

  test('percent-encodes unicode key segments', async () => {
    const h = makeS3();
    h.fetchMock.mockResolvedValueOnce(text('X'));

    await h.provider.readText('/Readest/books/h1/白夜行.epub');
    expect(h.url(0)).toContain(`/readest/Readest/books/h1/${encodeURIComponent('白夜行.epub')}`);
  });

  test('head returns size and the ETag stripped of quotes', async () => {
    const h = makeS3();
    h.fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'content-length': '123', etag: '"abc123"' },
      }),
    );

    expect(await h.provider.head('/Readest/library.json')).toEqual({ size: 123, etag: 'abc123' });
    expect(h.method(0)).toBe('HEAD');
  });

  test('list maps CommonPrefixes to dirs and Contents to files, draining pages', async () => {
    const h = makeS3();
    h.fetchMock
      .mockResolvedValueOnce(xml(listPage({ prefixes: ['Readest/books/h1/'], next: 'tok-2' })))
      .mockResolvedValueOnce(
        xml(listPage({ keys: [{ key: 'Readest/books/library.json', size: 42 }] })),
      );

    const entries = await h.provider.list('/Readest/books');

    expect(h.url(0)).toContain('list-type=2');
    expect(h.url(0)).toContain(`prefix=${encodeURIComponent('Readest/books/')}`);
    expect(h.url(0)).toContain('delimiter=%2F');
    expect(h.url(1)).toContain(`continuation-token=${encodeURIComponent('tok-2')}`);
    expect(entries).toEqual([
      { name: 'h1', path: '/Readest/books/h1', isDirectory: true },
      {
        name: 'library.json',
        path: '/Readest/books/library.json',
        isDirectory: false,
        size: 42,
        lastModified: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  test('writeText PUTs the body with its content type; ensureDir never fetches', async () => {
    const h = makeS3();
    await h.provider.ensureDir(['/Readest', '/Readest/books']);
    expect(h.fetchMock).not.toHaveBeenCalled();

    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await h.provider.writeText('/Readest/library.json', '{"a":1}');
    expect(h.method(0)).toBe('PUT');
    expect(h.url(0)).toContain('/readest/Readest/library.json');
    expect(h.fetchMock.mock.calls[0]?.[1]?.body).toBeDefined();
  });

  test('deleteDir lists the prefix and DELETEs every key', async () => {
    const h = makeS3();
    h.fetchMock
      .mockResolvedValueOnce(
        xml(
          listPage({
            keys: [{ key: 'Readest/books/h1/config.json' }, { key: 'Readest/books/h1/B.epub' }],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 })); // concurrently gone — fine

    await h.provider.deleteDir('/Readest/books/h1');

    expect(h.url(0)).toContain(`prefix=${encodeURIComponent('Readest/books/h1/')}`);
    expect(h.url(0)).not.toContain('delimiter');
    expect(h.method(1)).toBe('DELETE');
    expect(h.method(2)).toBe('DELETE');
    expect(h.url(1)).toContain('config.json');
  });

  test('retries a transient 503 with backoff and then succeeds', async () => {
    const h = makeS3();
    h.fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(text('OK'));

    expect(await h.provider.readText('/Readest/library.json')).toBe('OK');
    expect(h.sleep).toHaveBeenCalledTimes(1);
  });

  test('maps statuses to FileSyncError codes (403 auth, 404 write, 409 conflict)', async () => {
    const h = makeS3();
    h.fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    let err = await h.provider.list('/Readest/books').catch((e: unknown) => e);
    expect((err as FileSyncError).code).toBe('AUTH_FAILED');

    h.fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 404 }));
    err = await h.provider.writeText('/Readest/library.json', 'x').catch((e: unknown) => e);
    expect((err as FileSyncError).code).toBe('NOT_FOUND');

    h.fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 409 }));
    err = await h.provider.writeText('/Readest/library.json', 'x').catch((e: unknown) => e);
    expect((err as FileSyncError).code).toBe('CONFLICT');
  });

  test('maps a thrown fetch (offline) to a NETWORK FileSyncError after retries', async () => {
    const h = makeS3();
    h.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await h.provider.readText('/Readest/library.json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileSyncError);
    expect((err as FileSyncError).code).toBe('NETWORK');
  });
});
