// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * #7464: a book downloaded from an OPDS catalog must reach library.json on a
 * WebDAV / Google Drive mirror. The OPDS page mounts useLibraryFileSync, and
 * the download has to change the store's `library` reference for the hook to
 * schedule a pass. The page runs for real here: the library store, the hook
 * and the download handler. Only I/O is faked (the feed fetch, the file
 * download, appService) and the pass itself, which is counted.
 */

const h = vi.hoisted(() => ({
  onDownload: null as null | ((href: string, type?: string) => Promise<unknown>),
  runFileLibrarySyncPass: vi.fn(async () => null),
}));

const ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.w3.org/2005/Atom">
  <title>New Book</title>
  <id>urn:test:new-book</id>
  <link rel="http://opds-spec.org/acquisition" href="https://catalog.example/new.epub" type="application/epub+zip"/>
</entry>`;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams('url=https://catalog.example/entry.xml'),
}));

const newBook = { hash: 'new-book', title: 'New Book', format: 'EPUB' } as Book;
const appService = {
  hasRoundedWindow: false,
  resolveFilePath: vi.fn(async (name: string) => `/cache/${name}`),
  copyFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  saveLibraryBooks: vi.fn(async () => {}),
  importBook: vi.fn(async (_file: string, books: Book[]) => {
    // Like the real importBook: append to the array it was given.
    books.push(newBook);
    return newBook;
  }),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig: { getAppService: async () => appService } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => {} }));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: () => {} }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => ({ userProfilePlan: 'pro' }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: null, isRoundedWindow: false, isIPhoneDuo: false }),
}));

vi.mock('@/app/opds/components/PublicationView', () => ({
  PublicationView: (props: { onDownload: typeof h.onDownload }) => {
    h.onDownload = props.onDownload;
    return null;
  },
}));
vi.mock('@/app/opds/components/FeedView', () => ({ FeedView: () => null }));
vi.mock('@/app/opds/components/SearchView', () => ({ SearchView: () => null }));
vi.mock('@/app/opds/components/Navigation', () => ({ Navigation: () => null }));

vi.mock('@/app/opds/utils/opdsReq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/opds/utils/opdsReq')>()),
  fetchWithAuth: vi.fn(async () => {
    const res = new Response(ENTRY, { status: 200 });
    Object.defineProperty(res, 'url', { value: 'https://catalog.example/entry.xml' });
    return res;
  }),
}));
vi.mock('@/libs/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/storage')>()),
  downloadFile: vi.fn(async () => ({})),
}));
vi.mock('@/services/opds/cloudUpload', () => ({ queueOPDSBookUploads: () => {} }));
vi.mock('@/services/opds/sourceMap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/opds/sourceMap')>()),
  upsertOPDSSourceMapping: vi.fn(async () => {}),
}));
vi.mock('@/services/sync/cloudSyncProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/cloudSyncProvider')>()),
  getActiveFileSyncBackends: () => ['webdav'],
}));
vi.mock('@/services/sync/file/runLibrarySync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/file/runLibrarySync')>()),
  runFileLibrarySyncPass: h.runFileLibrarySyncPass,
}));

const { default: BrowserPage } = await import('@/app/opds/page');
const { useLibraryStore } = await import('@/store/libraryStore');

beforeEach(() => {
  vi.useFakeTimers();
  h.onDownload = null;
  h.runFileLibrarySyncPass.mockClear();
  useLibraryStore.getState().setLibrary([{ hash: 'old', title: 'Old Book' } as Book]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OPDS download → library.json sync (#7464)', () => {
  it('schedules a library sync pass for a book downloaded after the mount-time pass', async () => {
    render(<BrowserPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.onDownload).toBeTypeOf('function');

    // The user browses the catalog past the page's mount-time pass.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(h.runFileLibrarySyncPass).toHaveBeenCalledTimes(1);

    await act(async () => {
      await h.onDownload!('https://catalog.example/new.epub', 'application/epub+zip');
    });
    expect(useLibraryStore.getState().library.map((b) => b.hash)).toContain('new-book');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(h.runFileLibrarySyncPass).toHaveBeenCalledTimes(2);
  });
});
