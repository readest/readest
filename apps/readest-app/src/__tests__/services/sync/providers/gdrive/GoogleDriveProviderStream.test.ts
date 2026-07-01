import { beforeEach, describe, expect, test, vi } from 'vitest';

// Streaming is Tauri-only (it shells the bytes through the native upload plugin
// off the disk); force the platform probe on so the provider attaches the
// streaming methods, and stub the native transfer plugin.
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/transfer', () => ({
  tauriUpload: vi.fn(async () => '{"id":"NID"}'),
  tauriDownload: vi.fn(async () => ({})),
}));

import {
  createGoogleDriveProvider,
  type DriveAuth,
  type FetchFn,
} from '@/services/sync/providers/gdrive/GoogleDriveProvider';
import { tauriUpload, tauriDownload } from '@/utils/transfer';

const auth: DriveAuth = { getAccessToken: async () => 'TOKEN' };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const folder = (id: string) => ({ id, mimeType: 'application/vnd.google-apps.folder' });
const session = (location: string | null): Response =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: location ? { Location: location } : {},
  });

interface Harness {
  provider: ReturnType<typeof createGoogleDriveProvider>;
  fetchMock: ReturnType<typeof vi.fn>;
  url: (n: number) => string;
  method: (n: number) => string | undefined;
  body: (n: number) => unknown;
}

const makeDrive = (): Harness => {
  const fetchMock = vi.fn();
  const provider = createGoogleDriveProvider(auth, fetchMock as unknown as FetchFn, {
    sleep: async () => {},
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

// Resolve the three folder segments of /Readest/books/h to existing folders.
const stageFolders = (h: Harness) => {
  h.fetchMock
    .mockResolvedValueOnce(json({ files: [folder('RID')] })) // Readest
    .mockResolvedValueOnce(json({ files: [folder('BID')] })) // books
    .mockResolvedValueOnce(json({ files: [folder('HID')] })); // h
};

const BOOK = '/Readest/books/h/book.epub';

describe('GoogleDriveProvider — streaming', () => {
  // The native-transfer mocks are module-level (shared); clear call history
  // between tests so per-test call-count assertions stand alone.
  beforeEach(() => {
    vi.mocked(tauriUpload).mockClear();
    vi.mocked(tauriDownload).mockClear();
  });

  test('exposes uploadStream/downloadStream on Tauri', () => {
    const h = makeDrive();
    expect(typeof h.provider.uploadStream).toBe('function');
    expect(typeof h.provider.downloadStream).toBe('function');
  });

  test('uploadStream creates a new file via a resumable session and streams the bytes', async () => {
    const h = makeDrive();
    stageFolders(h);
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [] })) // findChild('book.epub') — absent
      .mockResolvedValueOnce(session('https://upload.example/session/abc')); // initiation

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(true);

    // Initiation is a POST to the resumable create endpoint, metadata in the body.
    expect(h.method(4)).toBe('POST');
    expect(h.url(4)).toContain('uploadType=resumable');
    expect(h.body(4)).toEqual({ name: 'book.epub', parents: ['HID'] });

    // The bytes are PUT to the session URI from disk via the native plugin.
    expect(tauriUpload).toHaveBeenCalledTimes(1);
    const call = vi.mocked(tauriUpload).mock.calls[0]!;
    expect(call[0]).toBe('https://upload.example/session/abc');
    expect(call[1]).toBe('/disk/book.epub');
    expect(call[2]).toBe('PUT');
  });

  test('uploadStream overwrites an existing file by id (PATCH session), preserving the id', async () => {
    const h = makeDrive();
    stageFolders(h);
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [{ id: 'EXIST' }] })) // findChild — exists
      .mockResolvedValueOnce(session('https://upload.example/session/upd'));

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(true);
    expect(h.method(4)).toBe('PATCH');
    expect(h.url(4)).toContain('/EXIST?uploadType=resumable');
    // No parent reparent on overwrite; only the name rides in the body.
    expect(h.body(4)).toEqual({ name: 'book.epub' });
  });

  test('uploadStream returns false (no throw) when the session has no Location, and skips the PUT', async () => {
    const h = makeDrive();
    stageFolders(h);
    h.fetchMock
      .mockResolvedValueOnce(json({ files: [] })) // findChild — absent
      .mockResolvedValueOnce(session(null)); // initiation without a session URI

    const ok = await h.provider.uploadStream!(BOOK, '/disk/book.epub');
    expect(ok).toBe(false);
    expect(tauriUpload).not.toHaveBeenCalled();
  });

  test('downloadStream resolves the id and streams to disk with a bearer token', async () => {
    const h = makeDrive();
    stageFolders(h);
    h.fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'DID' }] })); // findChild('book.epub')

    const ok = await h.provider.downloadStream!(BOOK, '/disk/dst.epub');
    expect(ok).toBe(true);
    expect(tauriDownload).toHaveBeenCalledTimes(1);
    const call = vi.mocked(tauriDownload).mock.calls[0]!;
    expect(call[0]).toContain('/DID?alt=media');
    expect(call[1]).toBe('/disk/dst.epub');
    expect(call[3]).toEqual({ Authorization: 'Bearer TOKEN' });
  });

  test('downloadStream returns false when the remote file is absent, and skips the GET', async () => {
    const h = makeDrive();
    stageFolders(h);
    h.fetchMock.mockResolvedValueOnce(json({ files: [] })); // findChild — absent

    const ok = await h.provider.downloadStream!(BOOK, '/disk/dst.epub');
    expect(ok).toBe(false);
    expect(tauriDownload).not.toHaveBeenCalled();
  });
});
