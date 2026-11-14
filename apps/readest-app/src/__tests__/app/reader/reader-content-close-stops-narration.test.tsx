// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { Book, BookConfig } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

const h = vi.hoisted(() => {
  const appService = {
    hasWindow: true,
    isDesktopApp: false,
    saveSettings: vi.fn(async () => {}),
    saveBookConfig: vi.fn(async () => {}),
    saveLibraryBooks: vi.fn(async (_books: unknown[]) => {}),
  };
  return {
    appService,
    envConfig: { getAppService: async () => appService },
    onCloseWindow: vi.fn(async (_callback: () => unknown) => () => {}),
    closeWindow: vi.fn(async () => {}),
    windowLabel: 'reader-1',
    bookKeys: ['h1-k1'],
    dismissBook: vi.fn(),
    captured: {} as { onCloseBook?: (bookKey: string) => void },
    parseOpenWithFiles: vi.fn(async () => [] as string[]),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: h.envConfig, appService: h.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useAndroidGamepadConnection', () => ({
  useAndroidGamepadConnection: () => false,
}));
vi.mock('@/hooks/useGamepad', () => ({ useGamepad: () => {} }));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({
    bookKeys: h.bookKeys,
    dismissBook: h.dismissBook,
    getNextBookKey: vi.fn(() => h.bookKeys[0]),
  }),
}));
vi.mock('@/app/reader/hooks/useBookShortcuts', () => ({ default: () => {} }));
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: async () => ({ ok: true }),
  discardNotebookDocument: vi.fn(),
}));
vi.mock('@/app/reader/services/notebookDocumentCoordinator', () => ({
  canTransitionWithNotebookRecovery: () => true,
}));
vi.mock('@/utils/window', () => ({
  tauriHandleClose: vi.fn(),
  tauriHandleOnCloseWindow: h.onCloseWindow,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: h.windowLabel, close: h.closeWindow }),
}));
vi.mock('@/helpers/openWith', () => ({
  parseOpenWithFiles: h.parseOpenWithFiles,
}));
vi.mock('@/utils/discord', () => ({ clearDiscordPresence: vi.fn() }));
vi.mock('@/app/reader/components/sidebar/SideBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/Notebook', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTransitionAlert', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/BooksGrid', () => ({
  default: (props: { onCloseBook: (bookKey: string) => void }) => {
    h.captured.onCloseBook = props.onCloseBook;
    return null;
  },
}));
vi.mock('@/app/reader/components/audiobook/AudiobookPairingDialog', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/hardcover/HardcoverLinkDialog', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/pagebound/PageboundLinkDialog', () => ({
  default: () => null,
}));
vi.mock('@/components/localsend/LocalSendManager', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/metadata', () => ({ BookDetailModal: () => null }));
vi.mock('@/app/library/components/ShareBookDialog', () => ({ default: () => null }));

import ReaderContent from '@/app/reader/components/ReaderContent';
import { eventDispatcher } from '@/utils/event';
import { flushPendingLibrarySave, useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'Book',
  author: 'Author',
  progress: [27, 39],
  createdAt: 1,
  updatedAt: 1,
} as Book;

const book2 = {
  hash: 'h2',
  format: 'EPUB',
  title: 'Book 2',
  author: 'Author',
  progress: [1, 10],
  createdAt: 1,
  updatedAt: 1,
} as Book;

type ViewState = NonNullable<
  ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
>;

describe('ReaderContent closing a book stops narration when the window dies', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.windowLabel = 'reader-1';
    h.bookKeys = ['h1-k1'];
    h.captured.onCloseBook = undefined;
    h.parseOpenWithFiles.mockResolvedValue([]);
    dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue(undefined);
    useLibraryStore.getState().setLibrary([book]);
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book,
          file: null,
          config: { progress: [29, 39], location: 'cfi-29', updatedAt: 1 } as BookConfig,
          bookDoc: {} as NonNullable<
            ReturnType<typeof useBookDataStore.getState>['booksData'][string]
          >['bookDoc'],
          isFixedLayout: false,
        },
        h2: {
          id: 'h2',
          book: book2,
          file: null,
          config: { progress: [1, 10], location: 'cfi-1', updatedAt: 1 } as BookConfig,
          bookDoc: {} as NonNullable<
            ReturnType<typeof useBookDataStore.getState>['booksData'][string]
          >['bookDoc'],
          isFixedLayout: false,
        },
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true, viewSettings: {} } as ViewState,
        'h2-k2': { key: 'h2-k2', isPrimary: false, viewSettings: {} } as ViewState,
      },
    });
  });

  afterEach(async () => {
    dispatchSpy.mockRestore();
    cleanup();
    await flushPendingLibrarySave();
  });

  const closeBook = async (bookKey: string) => {
    render(<ReaderContent settings={{} as SystemSettings} />);
    await waitFor(() => expect(h.captured.onCloseBook).toBeDefined());
    await act(async () => {
      await h.captured.onCloseBook!(bookKey);
    });
  };

  // Closing the last book in a reader window destroys its webview: the
  // narration cannot continue headless there, so the close must stop it
  // instead of detaching it (#7523).
  test('closing the last book in a reader window stops the narration', async () => {
    await closeBook('h1-k1');

    expect(dispatchSpy).toHaveBeenCalledWith('tts-stop', { bookKey: 'h1-k1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-close-book', expect.anything());
  });

  // The main window stays alive behind the library: background playback is
  // the intended behaviour there and must keep working.
  test('closing the last book in the main window keeps narration playing', async () => {
    h.windowLabel = 'main';
    await closeBook('h1-k1');

    expect(dispatchSpy).toHaveBeenCalledWith('tts-close-book', { bookKey: 'h1-k1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
  });

  // Closing one pane leaves the webview (and the other book) alive.
  test('closing one of two books keeps narration playing', async () => {
    h.bookKeys = ['h1-k1', 'h2-k2'];
    await closeBook('h1-k1');

    expect(dispatchSpy).toHaveBeenCalledWith('tts-close-book', { bookKey: 'h1-k1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
  });

  // A book opened with files closes its window even from the main window.
  test('closing a book opened with files stops the narration', async () => {
    h.windowLabel = 'main';
    h.parseOpenWithFiles.mockResolvedValue(['/tmp/moby-dick-mo.epub']);
    await closeBook('h1-k1');

    expect(dispatchSpy).toHaveBeenCalledWith('tts-stop', { bookKey: 'h1-k1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-close-book', expect.anything());
  });
});
