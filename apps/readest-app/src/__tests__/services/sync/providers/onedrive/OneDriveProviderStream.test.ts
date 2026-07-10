import { beforeEach, describe, expect, test, vi } from 'vitest';

// Streaming is Tauri-only (it shells the bytes through the native transfer
// plugin off the disk); force the platform probe on so the provider attaches
// the streaming methods, and stub the native transfer + fs plugins.
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/transfer', () => ({
  tauriUpload: vi.fn(async () => ''),
  tauriDownload: vi.fn(async () => ({})),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: vi.fn(async () => ({ size: 42 })),
}));

import {
  createOneDriveProvider,
  type OneDriveAuth,
  type FetchFn,
} from '@/services/sync/providers/onedrive/OneDriveProvider';
import { tauriUpload, tauriDownload } from '@/utils/transfer';
import { stat } from '@tauri-apps/plugin-fs';

const auth: OneDriveAuth = { getAccessToken: async () => 'TOKEN' };
const noSleep = () => Promise.resolve();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Harness {
  provider: ReturnType<typeof createOneDriveProvider>;
  fetchMock: ReturnType<typeof vi.fn>;
  url: (n: number) => string;
  method: (n: number) => string | undefined;
  body: (n: number) => unknown;
}

const makeOneDrive = (): Harness => {
  const fetchMock = vi.fn();
  const provider = createOneDriveProvider(auth, fetchMock as unknown as FetchFn, {
    sleep: noSleep,
  });
  return {
    provider,
    fetchMock,
    url: (n) => fetchMock.mock.calls[n]?.[0] as string,
    method: (n) => (fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.method,
    body: (n) => {
      const raw = (fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.body;
      return typeof raw === 'string' ? JSON.parse(raw) : undefined;
    },
  };
};

const BOOK = '/Readest/books/h/book.epub';

describe('OneDriveProvider — streaming', () => {
  beforeEach(() => {
    vi.mocked(tauriUpload).mockClear();
    vi.mocked(tauriDownload).mockClear();
    vi.mocked(stat).mockClear();
  });

  test('exposes uploadStream/downloadStream on Tauri', () => {
    const h = makeOneDrive();
    expect(typeof h.provider.uploadStream).toBe('function');
    expect(typeof h.provider.downloadStream).toBe('function');
  });

  test('uploadStream POSTs createUploadSession and streams the bytes to the returned uploadUrl', async () => {
    const h = makeOneDrive();
    h.fetchMock.mockResolvedValueOnce(json({ uploadUrl: 'https://upload.example/session/abc' }));

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(true);

    expect(h.method(0)).toBe('POST');
    expect(h.url(0)).toContain('createUploadSession');
    expect(h.body(0)).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'replace' } });

    expect(tauriUpload).toHaveBeenCalledTimes(1);
    const call = vi.mocked(tauriUpload).mock.calls[0]!;
    expect(call[0]).toBe('https://upload.example/session/abc');
    expect(call[1]).toBe('/disk/book.epub');
    expect(call[2]).toBe('PUT');
    const headers = call[4] as unknown as Record<string, string>;
    expect(headers['Content-Range']).toBe('bytes 0-41/42');
  });

  test('uploadStream returns false (no throw) when the session response has no uploadUrl', async () => {
    const h = makeOneDrive();
    h.fetchMock.mockResolvedValueOnce(json({}));

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(false);
    expect(tauriUpload).not.toHaveBeenCalled();
  });

  test('uploadStream returns false when the transport throws', async () => {
    const h = makeOneDrive();
    h.fetchMock.mockRejectedValueOnce(new Error('network down'));

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(false);
  });

  test('downloadStream GETs the content URL and streams to disk with a bearer token', async () => {
    const h = makeOneDrive();

    const ok = await h.provider.downloadStream!(BOOK, '/disk/dst.epub');
    expect(ok).toBe(true);
    expect(tauriDownload).toHaveBeenCalledTimes(1);
    const call = vi.mocked(tauriDownload).mock.calls[0]!;
    expect(call[0]).toContain('/approot:/Readest/books/h/book.epub:/content');
    expect(call[1]).toBe('/disk/dst.epub');
    expect(call[3]).toEqual({ Authorization: 'Bearer TOKEN' });
  });

  test('downloadStream returns false when the transport throws', async () => {
    const h = makeOneDrive();
    vi.mocked(tauriDownload).mockRejectedValueOnce(new Error('network down'));

    const ok = await h.provider.downloadStream!(BOOK, '/disk/dst.epub');
    expect(ok).toBe(false);
  });
});
