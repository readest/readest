// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';

interface MockLibraryState {
  library: Book[];
  libraryLoaded: boolean;
  setCheckOpenWithBooks: (check: boolean) => void;
  setLibrary: (library: Book[]) => void;
  getBookByHash: (hash: string) => Book | undefined;
}

const makeBook = (overrides: Partial<Book> & Pick<Book, 'hash'>): Book => ({
  format: 'PDF',
  title: 'Selected PDF',
  author: '',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...overrides,
});

const h = vi.hoisted(() => ({
  appService: {
    isIOSApp: true,
    hasWindow: false,
    loadSettings: vi.fn(async () => ({ autoImportBooksOnOpen: true })),
    loadLibraryBooks: vi.fn(async () => []),
    openFile: vi.fn(async () => new File(['%PDF-1.4'], 'selected.pdf')),
    importBook: vi.fn(async (_file: string, library: Book[]) => {
      const book: Book = {
        hash: 'transient-pdf-hash',
        format: 'PDF',
        title: 'Selected PDF',
        author: '',
        createdAt: 0,
        updatedAt: 0,
        deletedAt: Date.now(),
      };
      library.push(book);
      return book;
    }),
  },
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  partialMD5: vi.fn<() => Promise<string | undefined>>(),
  setCheckOpenWithBooks: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return {
    useLibraryStore: create<MockLibraryState>((set, get) => ({
      library: [],
      libraryLoaded: true,
      setCheckOpenWithBooks: h.setCheckOpenWithBooks,
      setLibrary: (library) => set({ library, libraryLoaded: true }),
      getBookByHash: (hash) => get().library.find((b) => b.hash === hash),
    })),
  };
});
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: h.navigateToLibrary,
  navigateToReader: h.navigateToReader,
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/md5', () => ({ partialMD5: h.partialMD5 }));

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { eventDispatcher } from '@/utils/event';
import { useLibraryStore } from '@/store/libraryStore';

afterEach(() => {
  cleanup();
  delete window.OPEN_WITH_FILES;
  useLibraryStore.setState({ library: [], libraryLoaded: true });
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('useOpenWithBooks iOS file URL ingress', () => {
  test.each([
    'A%23B.epub',
    '100%25.epub',
    'Report%2520Final.epub',
    '%E4%B8%89%E4%BD%93%20book.epub',
  ])('preserves the raw iOS URL for %s', async (basename) => {
    const uri = `file:///private/var/Inbox/${basename}`;
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri] });
    });
    await waitFor(() => expect(h.navigateToLibrary).toHaveBeenCalledTimes(1));
    expect(window.OPEN_WITH_FILES).toEqual([uri]);
    expect(h.setCheckOpenWithBooks).toHaveBeenCalledWith(true);
  });
});

describe('useOpenWithBooks non-iOS file URL ingress', () => {
  // #7553: same reserved-character decode as parseOpenWithFiles, on the live
  // `app-incoming-url` path (useOpenWithBooks.normalizeUrls).
  test('decodes a percent-encoded semicolon in the filename', async () => {
    h.appService.isIOSApp = false;
    try {
      const uri = 'file:///Users/x/Anne_Carson%3B.epub';
      renderHook(() => useOpenWithBooks());
      act(() => {
        eventDispatcher.dispatch('app-incoming-url', { urls: [uri] });
      });
      await waitFor(() => expect(h.navigateToLibrary).toHaveBeenCalledTimes(1));
      expect(window.OPEN_WITH_FILES).toEqual(['/Users/x/Anne_Carson;.epub']);
      expect(h.setCheckOpenWithBooks).toHaveBeenCalledWith(true);
    } finally {
      h.appService.isIOSApp = true;
    }
  });
});

describe('useOpenWithBooks Android transient VIEW intent while reader is active', () => {
  test('switches the active reader to a newly imported transient file via open-book-in-reader (#8019)', async () => {
    h.appService.isIOSApp = false;
    h.appService.loadSettings.mockResolvedValueOnce({ autoImportBooksOnOpen: false });
    window.history.replaceState({}, '', '/reader?ids=previous-book-hash');
    const onOpenBookInReader = vi.fn();
    eventDispatcher.on('open-book-in-reader', onOpenBookInReader);

    try {
      const uri = 'content://com.android.providers.downloads.documents/document/1234';
      renderHook(() => useOpenWithBooks());
      act(() => {
        eventDispatcher.dispatch('app-incoming-url', { urls: [uri], action: 'VIEW' });
      });

      await waitFor(() => expect(onOpenBookInReader).toHaveBeenCalledTimes(1));
      expect(h.appService.importBook).toHaveBeenCalledWith(uri, expect.any(Array), {
        transient: true,
      });
      expect(onOpenBookInReader.mock.calls[0]?.[0]?.detail).toEqual({
        bookHash: 'transient-pdf-hash',
      });
      expect(h.navigateToReader).not.toHaveBeenCalled();
      expect(h.navigateToLibrary).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.off('open-book-in-reader', onOpenBookInReader);
      h.appService.isIOSApp = true;
    }
  });

  test('switches the active reader to an existing library book without re-importing when pre-hash matches (#8019)', async () => {
    h.appService.isIOSApp = false;
    h.appService.loadSettings.mockResolvedValueOnce({ autoImportBooksOnOpen: false });
    h.partialMD5.mockResolvedValueOnce('existing-pdf-hash');
    useLibraryStore.setState({
      library: [makeBook({ hash: 'existing-pdf-hash', title: 'Existing PDF' })],
      libraryLoaded: true,
    });
    window.history.replaceState({}, '', '/reader?ids=previous-book-hash');
    const onOpenBookInReader = vi.fn();
    eventDispatcher.on('open-book-in-reader', onOpenBookInReader);

    try {
      const uri = 'content://com.android.providers.downloads.documents/document/5678';
      renderHook(() => useOpenWithBooks());
      act(() => {
        eventDispatcher.dispatch('app-incoming-url', { urls: [uri], action: 'VIEW' });
      });

      await waitFor(() => expect(onOpenBookInReader).toHaveBeenCalledTimes(1));
      expect(h.appService.importBook).not.toHaveBeenCalled();
      expect(onOpenBookInReader.mock.calls[0]?.[0]?.detail).toEqual({
        bookHash: 'existing-pdf-hash',
      });
      expect(h.navigateToReader).not.toHaveBeenCalled();
      expect(h.navigateToLibrary).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.off('open-book-in-reader', onOpenBookInReader);
      h.appService.isIOSApp = true;
    }
  });
});

describe('useOpenWithBooks subscriptions', () => {
  // The reader page calls this hook; the library changes on every page turn (the book's progress)
  test('a library change does not re-render the component using it', () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      useOpenWithBooks();
    });
    const before = renders;
    act(() => useLibraryStore.setState({ library: [] }));
    expect(renders).toBe(before);
  });
});
