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

  test('writeText uploads via a multipart create and auto-creates the parent folder', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [] })) // findChild('Readest') — missing
      .mockResolvedValueOnce(json({ id: 'RID' })) // createFolder('Readest')
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // re-query winner
      .mockResolvedValueOnce(json({ files: [] })) // findChild('new.json') — not exists
      .mockResolvedValueOnce(json({ id: 'NID' })); // multipart create
    await h.provider.writeText('/Readest/new.json', '{"a":1}');
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
    expect(h.method(1)).toBe('POST'); // create folder
    expect(h.url(4)).toContain('uploadType=multipart');
    expect(h.method(4)).toBe('POST'); // create file (metadata + bytes together)
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

  test('retries a thrown transport error (mobile connection-reuse) and then succeeds', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest') ok
      // childrenQuery throws like the Tauri HTTP plugin does on Android when a
      // pooled connection goes bad: a plain Error (not a TypeError).
      .mockRejectedValueOnce(
        new Error('error sending request for url (https://www.googleapis.com/...)'),
      )
      .mockResolvedValueOnce(json({ files: [{ id: 'XID', name: 'x.json' }] })); // retry opens a fresh connection
    const entries = await h.provider.list('/Readest');
    expect(entries.map((e) => e.name)).toEqual(['x.json']);
    expect(h.sleep).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
  });

  test('maps an exhausted thrown transport error to a NETWORK FileSyncError', async () => {
    const h = makeDrive();
    // Every attempt throws the reqwest transport error; after the bounded
    // retries it must surface as NETWORK (not UNKNOWN) so the engine treats it
    // as transient.
    h.fetchMock.mockRejectedValue(
      new Error('error sending request for url (https://www.googleapis.com/...)'),
    );
    const err = await h.provider.list('/Readest').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileSyncError);
    expect((err as FileSyncError).code).toBe('NETWORK');
    // 1 initial attempt + MAX_BACKOFF_RETRIES (4) = 5 calls on the first segment.
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
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

  // Writes to a known path must not pay a lookup: the engine's steady state
  // (config.json and library.json PUTs right after their pull) re-writes paths
  // whose ids the read already cached, so the extra files.list per PUT was
  // pure overhead at one query per book config and per index push.
  test('writeText to a cached path PATCHes the known id without a lookup', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] })) // findChild('x.json')
      .mockResolvedValueOnce(text('FIRST')); // media download
    await h.provider.readText('/Readest/x.json');

    h.fetchMock.mockResolvedValueOnce(json({ id: 'XID' })); // PATCH media update
    await h.provider.writeText('/Readest/x.json', 'BODY');
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    expect(h.url(3)).toContain('/upload/drive/v3/files/XID');
    expect(h.method(3)).toBe('PATCH');
  });

  // #5147: the old create path POSTed the bytes unnamed (Drive materialises
  // that as a file literally called "Untitled" in the user's Drive ROOT) and
  // only a second PATCH named + reparented it. Any failure between the two —
  // rate limit, network drop, app suspension — stranded the "Untitled" file
  // where the user can see it. Metadata and bytes must travel in ONE request.
  test('creating a new file sends name+parent and bytes in one multipart request (#5147)', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [] })) // findChild('new.json') — not exists
      .mockResolvedValueOnce(json({ id: 'NID' })); // multipart create
    await h.provider.writeText('/Readest/new.json', '{"a":1}');
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.url(2)).toContain('uploadType=multipart');
    expect(h.method(2)).toBe('POST');
    const init = h.fetchMock.mock.calls[2]![1] as RequestInit;
    const bodyText = new TextDecoder().decode(init.body as ArrayBuffer);
    expect(bodyText).toContain('"name":"new.json"');
    expect(bodyText).toContain('"parents":["RID"]');
    expect(bodyText).toContain('{"a":1}');

    // The created id is cached: a follow-up read is a single media GET.
    h.fetchMock.mockResolvedValueOnce(text('AFTER'));
    expect(await h.provider.readText('/Readest/new.json')).toBe('AFTER');
    expect(h.url(3)).toContain('/NID?alt=media');
  });

  test('a failed create leaves nothing unnamed in the Drive root (#5147)', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [] })) // findChild('new.json') — not exists
      .mockResolvedValue(json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403));
    await expect(h.provider.writeText('/Readest/new.json', 'X')).rejects.toMatchObject({
      code: 'NETWORK',
    });
    // Every upload attempt carried the name and target parent inline, so a
    // failure creates no file at all — never an orphaned "Untitled" at root.
    for (const call of h.fetchMock.mock.calls.slice(2)) {
      expect(call[0] as string).toContain('uploadType=multipart');
      const bodyText = new TextDecoder().decode((call[1] as RequestInit).body as ArrayBuffer);
      expect(bodyText).toContain('"name":"new.json"');
      expect(bodyText).toContain('"parents":["RID"]');
    }
  });

  test('a large buffered create carries its metadata in a resumable session (#5147)', async () => {
    const h = makeDrive();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [] })) // findChild('big.bin') — not exists
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } }),
      ) // resumable initiation (metadata rides here)
      .mockResolvedValueOnce(json({ id: 'NID' })); // PUT bytes to the session URI
    await h.provider.writeBinary('/Readest/big.bin', big.buffer);
    expect(h.url(2)).toContain('uploadType=resumable');
    const initBody = (h.fetchMock.mock.calls[2]![1] as RequestInit).body as string;
    expect(JSON.parse(initBody)).toEqual({ name: 'big.bin', parents: ['RID'] });
    expect(h.url(3)).toBe('https://upload.test/session');
    expect(h.method(3)).toBe('PUT');
  });

  test('a stale cached id on write evicts and falls back to the full resolve', async () => {
    const h = makeDrive();
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // findChild('Readest')
      .mockResolvedValueOnce(json({ files: [{ id: 'XID' }] })) // findChild('x.json')
      .mockResolvedValueOnce(text('FIRST')); // media download
    await h.provider.readText('/Readest/x.json');

    // Cached XID was deleted remotely: the fast-path PATCH 404s, the provider
    // evicts and re-resolves, finds no existing file, and multipart-creates.
    h.fetchMock
      .mockResolvedValueOnce(json({}, 404)) // PATCH on stale XID
      .mockResolvedValueOnce(json({ files: [folder('RID')] })) // re-resolve Readest
      .mockResolvedValueOnce(json({ files: [] })) // findChild('x.json') — gone
      .mockResolvedValueOnce(json({ id: 'NID' })); // multipart create
    await h.provider.writeText('/Readest/x.json', 'BODY');
    expect(h.fetchMock).toHaveBeenCalledTimes(7);

    // The recreated file's id is cached: a follow-up read is one media GET.
    h.fetchMock.mockResolvedValueOnce(text('AFTER'));
    expect(await h.provider.readText('/Readest/x.json')).toBe('AFTER');
    expect(h.url(7)).toContain('/NID?alt=media');
  });
});
