import { describe, expect, test, vi } from 'vitest';
import { FileSyncError } from '@/services/sync/file/provider';
import {
  createOneDriveProvider,
  type FetchFn,
} from '@/services/sync/providers/onedrive/OneDriveProvider';

const auth = { getAccessToken: async () => 'TOKEN' };
const noSleep = () => Promise.resolve();
const make = (fetchFn: FetchFn) => createOneDriveProvider(auth, fetchFn, { sleep: noSleep });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('OneDriveProvider', () => {
  test('readText returns null on 404', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as FetchFn;
    expect(await make(fetchFn).readText('/Readest/x.json')).toBeNull();
  });

  test('readText returns the body and sends a bearer token', async () => {
    let auth = '';
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      return new Response('hello', { status: 200 });
    }) as unknown as FetchFn;
    expect(await make(fetchFn).readText('/Readest/x.json')).toBe('hello');
    expect(auth).toBe('Bearer TOKEN');
  });

  test('head maps size + cTag to FileHead', async () => {
    const fetchFn = (async () => json({ size: 12, cTag: 'CTAG', file: {} })) as unknown as FetchFn;
    expect(await make(fetchFn).head('/Readest/x.json')).toEqual({ size: 12, etag: 'CTAG' });
  });

  test('head returns null on 404', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as FetchFn;
    expect(await make(fetchFn).head('/Readest/x.json')).toBeNull();
  });

  test('list drains @odata.nextLink and maps folder vs file', async () => {
    const page1 = json({
      value: [
        { name: 'books', folder: {} },
        { name: 'library.json', size: 3, file: {} },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page',
    });
    const page2 = json({ value: [{ name: 'more.json', size: 1, file: {} }] });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2) as unknown as FetchFn;
    const entries = await make(fetchFn).list('/Readest');
    expect(entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['books', true],
      ['library.json', false],
      ['more.json', false],
    ]);
  });

  test('writeText PUTs to the content endpoint', async () => {
    let method = '';
    let url = '';
    const fetchFn = (async (u: string, init?: RequestInit) => {
      url = u;
      method = init?.method ?? '';
      return json({ id: '1' }, 201);
    }) as unknown as FetchFn;
    await make(fetchFn).writeText('/Readest/x.json', '{}');
    expect(method).toBe('PUT');
    expect(url).toContain('/approot:/Readest/x.json:/content');
  });

  test('ensureDir creates each folder and treats 409 nameAlreadyExists as success', async () => {
    const calls: string[] = [];
    const fetchFn = (async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${u}`);
      return json({ error: { code: 'nameAlreadyExists' } }, 409);
    }) as unknown as FetchFn;
    await expect(make(fetchFn).ensureDir(['/Readest', '/Readest/books'])).resolves.toBeUndefined();
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('POST');
  });

  test('deleteDir tolerates a 404', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as FetchFn;
    await expect(make(fetchFn).deleteDir('/Readest/books/gone')).resolves.toBeUndefined();
  });

  test('maps 401 to FileSyncError AUTH_FAILED', async () => {
    const fetchFn = (async () =>
      json({ error: { code: 'unauthenticated' } }, 401)) as unknown as FetchFn;
    const err = await make(fetchFn)
      .list('/Readest')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileSyncError);
    expect((err as FileSyncError).code).toBe('AUTH_FAILED');
  });

  test('retries a 429 then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(json({ value: [] })) as unknown as FetchFn;
    expect(await make(fetchFn).list('/Readest')).toEqual([]);
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
