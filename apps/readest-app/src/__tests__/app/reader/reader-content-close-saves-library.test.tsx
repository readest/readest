import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

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
  default: () => ({ bookKeys: ['h1-k1'], dismissBook: vi.fn(), getNextBookKey: vi.fn() }),
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
  getCurrentWindow: () => ({ label: 'main', close: vi.fn() }),
}));
vi.mock('@/utils/discord', () => ({ clearDiscordPresence: vi.fn() }));
vi.mock('@/app/reader/components/sidebar/SideBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/Notebook', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTransitionAlert', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/BooksGrid', () => ({ default: () => null }));
vi.mock('@/app/reader/components/audiobook/AudiobookPairingDialog', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/hardcover/HardcoverLinkDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/pagebound/PageboundLinkDialog', () => ({ default: () => null }));
vi.mock('@/components/localsend/LocalSendManager', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/metadata', () => ({ BookDetailModal: () => null }));
vi.mock('@/app/library/components/ShareBookDialog', () => ({ default: () => null }));

import ReaderContent from '@/app/reader/components/ReaderContent';
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

describe('ReaderContent window close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.getState().setLibrary([book]);
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book,
          file: null,
          config: { progress: [29, 39], location: 'cfi-29', updatedAt: 1 } as BookConfig,
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true } as NonNullable<
          ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
        >,
      },
    });
  });

  afterEach(async () => {
    cleanup();
    await flushPendingLibrarySave();
  });

  // Closing the reader window quits the app on Windows/Linux: the close
  // handler must not resolve until the library row carries the final
  // progress, or the shelf shows the old percentage on next launch (#6623).
  test('saves the library progress before the window is allowed to close', async () => {
    render(<ReaderContent settings={{} as SystemSettings} />);
    await waitFor(() => expect(h.onCloseWindow).toHaveBeenCalled());

    const onClose = h.onCloseWindow.mock.calls.at(-1)![0];
    await onClose();

    expect(h.appService.saveLibraryBooks).toHaveBeenCalled();
    const saved = h.appService.saveLibraryBooks.mock.calls.at(-1)![0] as Book[];
    expect(saved.find((b) => b.hash === 'h1')?.progress).toEqual([29, 39]);
  });
});
