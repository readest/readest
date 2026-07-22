import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppService } from '@/types/system';
import type { ShareMetadata } from '@/libs/share';

const getShareMock = vi.fn();
const tauriFetchMock = vi.fn();

let isTauri = false;

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => tauriFetchMock(...a) }));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => isTauri };
});

let libraryState: {
  libraryLoaded: boolean;
  library: unknown[];
  setLibrary: ReturnType<typeof vi.fn>;
  getBookByHash: (h: string) => unknown;
};
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => libraryState },
}));

vi.mock('@/libs/share', async (orig) => {
  const actual = await orig<typeof import('@/libs/share')>();
  return { ...actual, getShare: (...a: unknown[]) => getShareMock(...a) };
});

import { ensureSharedBookLocal } from '@/libs/shareImport';

const TOKEN = 'Qmup0X1A8ovl2FmKJKA8mB';

const makeAppService = (importedBook: unknown) => ({
  loadLibraryBooks: vi.fn().mockResolvedValue([]),
  importBook: vi.fn().mockResolvedValue(importedBook),
  saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
});

const newImportArgs = (appService: ReturnType<typeof makeAppService>) => ({
  token: TOKEN,
  importResult: { fileId: 'f', alreadyOwned: false, bookHash: 'hash', cfi: null },
  appService: appService as unknown as AppService,
  meta: { title: 'Book', format: 'EPUB' } as unknown as ShareMetadata,
});

beforeEach(() => {
  isTauri = false;
  getShareMock.mockReset();
  tauriFetchMock.mockReset();
  libraryState = {
    libraryLoaded: false,
    library: [],
    setLibrary: vi.fn(),
    getBookByHash: () => undefined,
  };
});

describe('ensureSharedBookLocal (new import)', () => {
  it('on web, fetches the /download endpoint and follows the 302 with the renderer fetch', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/epub+zip' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);

    const importedBook = { hash: 'hash', title: 'Book' };
    const appService = makeAppService(importedBook);

    const result = await ensureSharedBookLocal(newImportArgs(appService));

    // Web hits /download directly; the redirect to R2 is its first cross-origin
    // hop, so the Origin is preserved and R2's CORS allows it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain(`/share/${TOKEN}/download`);
    expect(tauriFetchMock).not.toHaveBeenCalled();
    const fileArg = appService.importBook.mock.calls[0]![0] as File;
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.name).toBe('Book.epub');
    expect(result).toBe(importedBook);

    vi.unstubAllGlobals();
  });

  it('on the app, downloads via native HTTP (which ignores CORS) on the same /download endpoint', async () => {
    isTauri = true;
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: 'application/epub+zip' });
    tauriFetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const appService = makeAppService({ hash: 'hash', title: 'Book' });

    await ensureSharedBookLocal(newImportArgs(appService));

    // The app must use native HTTP, not the renderer's fetch: tauri.localhost→
    // web→R2 is a second cross-origin hop that nulls the Origin and trips CORS.
    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock.mock.calls[0]![0]).toContain(`/share/${TOKEN}/download`);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
