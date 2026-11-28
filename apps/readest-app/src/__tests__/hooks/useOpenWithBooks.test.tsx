// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  appService: {
    isIOSApp: true,
    hasWindow: false,
    loadSettings: vi.fn(async () => ({ autoImportBooksOnOpen: true })),
    openFile: vi.fn(async () => ({})),
    importBook: vi.fn(),
  },
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  partialMD5: vi.fn(),
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
    useLibraryStore: create<{
      library: { hash: string }[];
      libraryLoaded: boolean;
      setLibrary: (library: { hash: string }[]) => void;
      getBookByHash: (hash: string) => { hash: string } | undefined;
      setCheckOpenWithBooks: typeof h.setCheckOpenWithBooks;
    }>()((set, get) => ({
      library: [],
      libraryLoaded: true,
      setLibrary: (library) => set({ library }),
      getBookByHash: (hash) => get().library.find((book) => book.hash === hash),
      setCheckOpenWithBooks: h.setCheckOpenWithBooks,
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
import type { Book } from '@/types/book';

afterEach(() => {
  cleanup();
  delete window.OPEN_WITH_FILES;
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

// #8019: Android "Open with Readest" with Auto Import off opens the file
// without importing it. A reader that is already showing the last book (the
// app was left on it, or "open last books" mounted it on a cold start) must
// switch to the chosen file instead of keeping the old book on screen.
describe('useOpenWithBooks Android "Open with" without import', () => {
  const uri = 'content://com.android.providers.downloads.documents/document/msf%3A42';
  const opened = vi.fn();
  const onOpened = (event: CustomEvent) => opened(event.detail);

  beforeEach(() => {
    h.appService.isIOSApp = false;
    h.appService.loadSettings.mockResolvedValue({ autoImportBooksOnOpen: false });
    h.partialMD5.mockResolvedValue('pdfHash');
    h.appService.importBook.mockImplementation(async (_file: string, books: { hash: string }[]) => {
      const book = { hash: 'pdfHash' };
      books.push(book);
      return book;
    });
    const lastBook: Book = {
      hash: 'lastBook',
      format: 'EPUB',
      title: 'Last Book',
      author: '',
      createdAt: 0,
      updatedAt: 0,
    };
    useLibraryStore.setState({ library: [lastBook] });
    eventDispatcher.on('open-book-in-reader', onOpened);
  });

  afterEach(() => {
    eventDispatcher.off('open-book-in-reader', onOpened);
    h.appService.isIOSApp = true;
    h.appService.loadSettings.mockResolvedValue({ autoImportBooksOnOpen: true });
    window.history.replaceState(null, '', '/');
  });

  test('switches an open reader to the chosen file', async () => {
    window.history.replaceState(null, '', '/reader?ids=lastBook');
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri], action: 'VIEW' });
    });
    await waitFor(() => expect(opened).toHaveBeenCalledWith({ bookHash: 'pdfHash' }));
    expect(h.appService.importBook).toHaveBeenCalledWith(uri, expect.any(Array), {
      transient: true,
    });
    expect(h.navigateToReader).not.toHaveBeenCalled();
  });

  test('switches a reader that mounted while the file was loading', async () => {
    // Cold start: the intent lands on the library, and "open last books"
    // mounts the reader with the old book before the file has loaded.
    window.history.replaceState(null, '', '/library');
    h.partialMD5.mockImplementationOnce(async () => {
      window.history.replaceState(null, '', '/reader?ids=lastBook');
      return 'pdfHash';
    });
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri], action: 'VIEW' });
    });
    await waitFor(() => expect(opened).toHaveBeenCalledWith({ bookHash: 'pdfHash' }));
    expect(h.navigateToReader).not.toHaveBeenCalled();
  });

  test('navigates to the reader from the library', async () => {
    window.history.replaceState(null, '', '/library');
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri], action: 'VIEW' });
    });
    await waitFor(() => expect(h.navigateToReader).toHaveBeenCalledWith({}, ['pdfHash']));
    expect(opened).not.toHaveBeenCalled();
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
