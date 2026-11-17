// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { Book, BookConfig } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { TTSSession } from '@/services/tts/TTSSessionManager';

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
    tauriHandleClose: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
    navigateToLibrary: vi.fn(),
    ensureMainLibraryWindow: vi.fn(async () => {}),
    windowLabel: 'reader-1',
    bookKeys: ['h1-k1'],
    dismissBook: vi.fn(),
    captured: {} as {
      onCloseBook?: (bookKey: string) => void;
      onGoToLibrary?: () => void;
    },
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
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));
vi.mock('@/utils/nav', () => ({
  closeReaderWindowOrGoToLibrary: vi.fn(),
  navigateToLibrary: h.navigateToLibrary,
  ensureMainLibraryWindow: h.ensureMainLibraryWindow,
}));
vi.mock('@/utils/window', () => ({
  tauriHandleClose: h.tauriHandleClose,
  tauriHandleOnCloseWindow: vi.fn(async () => () => {}),
  isMainAppWindow: () => h.windowLabel === 'main',
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
  default: (props: { onCloseBook: (bookKey: string) => void; onGoToLibrary: () => void }) => {
    h.captured.onCloseBook = props.onCloseBook;
    h.captured.onGoToLibrary = props.onGoToLibrary;
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
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
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

type ViewState = NonNullable<
  ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
>;

// Read Aloud keeps playing after its book closes and shows the library's mini
// player. Both live in this webview, so a reader window that would close
// with its last book stays open on the library while a session is live (#7523).
describe('ReaderContent closing the last book while Read Aloud is live', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let sessionSpy: ReturnType<typeof vi.spyOn>;

  const setLiveSession = (live: boolean) =>
    sessionSpy.mockReturnValue(
      live ? ({ bookHash: 'h1', bookKey: 'h1-k1' } as unknown as TTSSession) : null,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    h.windowLabel = 'reader-1';
    h.bookKeys = ['h1-k1'];
    h.captured.onCloseBook = undefined;
    h.captured.onGoToLibrary = undefined;
    h.parseOpenWithFiles.mockResolvedValue([]);
    dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue(undefined);
    sessionSpy = vi.spyOn(ttsSessionManager, 'getActiveSession');
    setLiveSession(true);
    useLibraryStore.getState().setLibrary([book]);
    // A reader window never mounted the library, so its launch-only restores
    // (open-with files, last open books) are still armed.
    useLibraryStore.setState({ checkOpenWithBooks: true, checkLastOpenBooks: true });
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
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true, viewSettings: {} } as ViewState,
      },
    });
  });

  afterEach(async () => {
    dispatchSpy.mockRestore();
    sessionSpy.mockRestore();
    cleanup();
    await flushPendingLibrarySave();
  });

  const renderReader = async () => {
    render(<ReaderContent settings={{} as SystemSettings} />);
    await waitFor(() => expect(h.captured.onCloseBook).toBeDefined());
  };

  const closeBook = async (bookKey: string) => {
    await renderReader();
    await act(async () => {
      await h.captured.onCloseBook!(bookKey);
    });
  };

  // Left armed, the library's first mount would reopen the book just closed.
  const expectLaunchRestoresDisarmed = () => {
    expect(useLibraryStore.getState().checkOpenWithBooks).toBe(false);
    expect(useLibraryStore.getState().checkLastOpenBooks).toBe(false);
  };

  test('a reader window stays open on the library', async () => {
    await closeBook('h1-k1');

    expect(dispatchSpy).toHaveBeenCalledWith('tts-close-book', { bookKey: 'h1-k1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-stop', expect.anything());
    expect(h.closeWindow).not.toHaveBeenCalled();
    expect(h.navigateToLibrary).toHaveBeenCalled();
    expectLaunchRestoresDisarmed();
  });

  test('a reader window with no session closes as before', async () => {
    setLiveSession(false);
    await closeBook('h1-k1');

    expect(h.closeWindow).toHaveBeenCalled();
    expect(h.navigateToLibrary).not.toHaveBeenCalled();
  });

  test('a book opened with files stays on the library instead of closing', async () => {
    h.windowLabel = 'main';
    h.parseOpenWithFiles.mockResolvedValue(['/tmp/moby-dick-mo.epub']);
    await closeBook('h1-k1');

    expect(h.tauriHandleClose).not.toHaveBeenCalled();
    expect(h.navigateToLibrary).toHaveBeenCalled();
  });

  test('Go to Library in a reader window stays open on the library', async () => {
    await renderReader();
    await act(async () => {
      await h.captured.onGoToLibrary!();
    });

    expect(dispatchSpy).toHaveBeenCalledWith('tts-close-book', { bookKey: 'h1-k1' });
    expect(h.closeWindow).not.toHaveBeenCalled();
    expect(h.ensureMainLibraryWindow).not.toHaveBeenCalled();
    expect(h.navigateToLibrary).toHaveBeenCalled();
    expectLaunchRestoresDisarmed();
  });

  test('Go to Library in a reader window with no session closes it as before', async () => {
    setLiveSession(false);
    await renderReader();
    await act(async () => {
      await h.captured.onGoToLibrary!();
    });

    expect(h.ensureMainLibraryWindow).toHaveBeenCalled();
    expect(h.closeWindow).toHaveBeenCalled();
    expect(h.navigateToLibrary).not.toHaveBeenCalled();
  });
});
