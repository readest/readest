import { describe, expect, test, vi } from 'vitest';
import {
  createGoogleDriveProvider,
  type DriveAuth,
  type FetchFn,
} from '@/services/sync/providers/gdrive/GoogleDriveProvider';
import { FileSyncError } from '@/services/sync/file/provider';
import { runSemanticContract } from '@/__tests__/services/sync/file/providerSemanticContract';

const auth: DriveAuth = { getAccessToken: async () => 'TOKEN' };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200): Response => new Response(body, { status });
const folder = (id: string) => ({ id, mimeType: 'application/vnd.google-apps.folder' });

interface Harness {
  provider: ReturnType<typeof createGoogleDriveProvider>;
  fetchMock: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  /** URL of the n-th fetch call (0-based). */
  url: (n: number) => string;
  /** Method of the n-th fetch call (0-based). */
  method: (n: number) => string | undefined;
}

const makeDrive = (): Harness => {
  const fetchMock = vi.fn();
  const sleep = vi.fn(async () => {});
  const provider = createGoogleDriveProvider(auth, fetchMock as unknown as FetchFn, {
    sleep: sleep as unknown as (ms: number) => Promise<void>,
  });
  return {
    provider,
    fetchMock,
    sleep,
    url: (n) => fetchMock.mock.calls[n]?.[0] as string,
    method: (n) => (fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.method,
  };
};

// Drive must satisfy the same semantics as WebDAV; it just stages them over its
// id-addressed wire (an absent path = an empty `files.list`, not a 404 body).
runSemanticContract('GoogleDriveProvider', () => {
  const fetchMock = vi.fn();
  return {
    makeProvider: () =>
      createGoogleDriveProvider(auth, fetchMock as unknown as FetchFn, { sleep: async () => {} }),
    stageAbsent: () => fetchMock.mockResolvedValueOnce(json({ files: [] })),
    stageAuthFailure: () => fetchMock.mockResolvedValueOnce(json({}, 401)),
  };
});

describe('GoogleDriveProvider — Drive transport', () => {
  test('readText resolves the path segment-by-segment then downloads, and caches ids', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] })) // findChild('x.json')
      .mockResolvedValueOnce(text('HELLO')); // media download
    expect(await h.provider.readText('/Readest/x.json')).toBe('HELLO');
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.url(2)).toContain('/XID?alt=media');
    expect(new URL(h.url(0)).searchParams.get('q')).toContain("name = 'Readest'");

    // A second read hits the cached file id — only the media GET fires.
    h.fetchMock.mockResolvedValueOnce(text('HELLO AGAIN'));
    expect(await h.provider.readText('/Readest/x.json')).toBe('HELLO AGAIN');
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
  });

  test('writeText uploads via create-then-name and auto-creates the parent folder', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [] })) // findChild('Readest') — missing
      .mockResolvedValueOnce(json({ id: 'RID' })) // createFolder('Readest')
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // re-query winner
      .mockResolvedValueOnce(json({ files: [] })) // findChild('new.json') — not exists
      .mockResolvedValueOnce(json({ id: 'NID' })) // POST upload
      .mockResolvedValueOnce(json({ id: 'NID' })); // PATCH name + reparent
    await h.provider.writeText('/Readest/new.json', '{"a":1}');
    expect(h.fetchMock).toHaveBeenCalledTimes(6);
    expect(h.method(1)).toBe('POST'); // create folder
    expect(h.url(4)).toContain('uploadType=media');
    expect(h.method(4)).toBe('POST'); // create file bytes
    expect(h.url(5)).toContain('addParents=RID');
    expect(h.method(5)).toBe('PATCH'); // name + reparent
  });

  test('list drains every nextPageToken page', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(
        json({
          files: [
            { id: 'A', name: 'a.json' },
            { id: 'B', name: 'b.json' },
          ],
          nextPageToken: 'T2',
        }),
      )
      .mockResolvedValueOnce(json({ files: [{ id: 'C', name: 'c.json' }] }));
    const entries = await h.provider.list('/Readest');
    expect(entries.map((e) => e.name)).toEqual(['a.json', 'b.json', 'c.json']);
    expect(entries[0]).toMatchObject({ path: '/Readest/a.json', isDirectory: false });
    expect(h.url(2)).toContain('pageToken=T2');
  });

  test('head returns the byte size and the md5 etag', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] }))
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] }))
      .mockResolvedValueOnce(json({ id: 'XID', name: 'x.json', size: '1234', md5Checksum: 'abc' }));
    expect(await h.provider.head('/Readest/x.json')).toEqual({ size: 1234, etag: 'abc' });
  });

  test('deleteDir resolves the folder id and DELETEs it', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // Readest
      .mockResolvedValueOnce(json({ files: [folder('BID')] })) // books
      .mockResolvedValueOnce(json({ files: [folder('GID')] })) // gone
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // DELETE
    await expect(h.provider.deleteDir('/Readest/books/gone')).resolves.toBeUndefined();
    expect(h.method(3)).toBe('DELETE');
    expect(h.url(3)).toContain('/GID');
  });

  test('retries a 429 with backoff and then succeeds', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 })) // findChild('Readest') throttled
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // retry succeeds
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] }))
      .mockResolvedValueOnce(text('OK'));
    expect(await h.provider.readText('/Readest/x.json')).toBe('OK');
    expect(h.sleep).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
  });

  test('classifies a 403 rate-limit as NETWORK and a 403 permission error as AUTH_FAILED', async () => {
    const rate = makeDrive();
    rate.fetchMock.mockResolvedValueOnce(
      json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403),
    );
    const rateErr = await rate.provider.readText('/Readest/x.json').catch((e: unknown) => e);
    expect(rateErr).toBeInstanceOf(FileSyncError);
    expect((rateErr as FileSyncError).code).toBe('NETWORK');

    const perm = makeDrive();
    perm.fetchMock.mockResolvedValueOnce(
      json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403),
    );
    const permErr = await perm.provider.readText('/Readest/x.json').catch((e: unknown) => e);
    expect((permErr as FileSyncError).code).toBe('AUTH_FAILED');
  });

  test('findChild picks the lexicographically smallest id when duplicates exist', async () => {
    const h = makeDrive();
    // Two folders both named "Readest" (a create race) — resolution must converge
    // on the same one for every caller, so the smaller id wins deterministically.
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('B'), folder('A')] }))
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] }))
      .mockResolvedValueOnce(text('DATA'));
    await h.provider.readText('/Readest/x.json');
    // The child lookup under "Readest" must query parent 'A', not 'B'.
    expect(new URL(h.url(1)).searchParams.get('q')).toContain("'A' in parents");
  });

  test('evicts a stale cached id on a 404 and re-resolves once', async () => {
    const h = makeDrive();
    // Warm the cache.
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] }))
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] }))
      .mockResolvedValueOnce(text('FIRST'));
    expect(await h.provider.readText('/Readest/x.json')).toBe('FIRST');

    // Second read: cached XID now 404s (deleted + recreated remotely). The
    // provider evicts, re-resolves the path fresh, and reads the new id.
    h.fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // media GET on stale XID
      .mockResolvedValueOnce(json({ files: [folder('RID2')] })) // re-resolve Readest
      .mockResolvedValueOnce(json({ files: [{ id: 'XID2' }] })) // re-resolve x.json
      .mockResolvedValueOnce(text('SECOND')); // media GET on XID2
    expect(await h.provider.readText('/Readest/x.json')).toBe('SECOND');
  });
});
