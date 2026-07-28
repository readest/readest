import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';

/**
 * Issue #5265 (the residue of #5084): "Delete locally" must never cost the user
 * their Google Drive copy.
 *
 * The only automatic route into the destructive `handleBookDelete('both')` is
 * this hook's stale-record cleanup: a book whose local file is missing is
 * offered for deletion, the confirm tombstones it, and the file sync then GCs
 * the book's directory off the remote. #5087 fixed the misclassification that
 * fed it (peers adopting a foreign `filePath`, provider-synced books never
 * stamped `uploadedAt`) — but a device that synced on an older build still
 * carries poisoned rows, so the escalation itself has to stop being possible:
 * a missing LOCAL file is not evidence that the REMOTE copy is unwanted.
 */

const routing = vi.hoisted(() => ({
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const isBookAvailable = vi.hoisted(() => vi.fn(async () => false));
const navigateToReader = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader,
  showReaderWindow: vi.fn(),
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
}));

const appService = {
  isBookAvailable,
  hasWindow: false,
  saveLibraryBooks: vi.fn(async () => {}),
} as unknown as AppService;

const envConfig = { getAppService: async () => appService } as unknown as EnvConfigType;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig, appService }),
}));

const { useOpenBook } = await import('@/app/library/hooks/useOpenBook');
const { eventDispatcher } = await import('@/utils/event');

const makeBook = (over: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'Title',
  sourceTitle: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const setup = (downloadOk = true) => {
  const handleBookDownload = vi.fn(async () => downloadOk);
  const { result } = renderHook(() => useOpenBook({ setLoading: vi.fn(), handleBookDownload }));
  return { result, handleBookDownload };
};

/** `openBook` hands the reader navigation to a setTimeout(0); let it land. */
const flushNavigation = () => new Promise((resolve) => setTimeout(resolve, 0));

let deleteIntents: string[][] = [];

eventDispatcher.on('delete-books', (event: CustomEvent) => {
  deleteIntents.push(event.detail.ids as string[]);
});

beforeEach(() => {
  vi.clearAllMocks();
  routing.backends = [];
  isBookAvailable.mockResolvedValue(false);
  deleteIntents = [];
});

describe('useOpenBook — a missing local file must not delete the cloud copy (#5265)', () => {
  it('never offers to delete a book whose bytes may still be on the file mirror', async () => {
    routing.backends = ['gdrive'];
    // The row right after "Remove from Device Only" on a device whose library
    // was poisoned by a pre-#5087 client: a peer's absolute `filePath`, and no
    // `uploadedAt` because the engine kept misreading that path as the source.
    const book = makeBook({ filePath: 'C:\\Users\\other\\Book.epub', downloadedAt: null });

    const { result, handleBookDownload } = setup();
    await result.current.openBook(book);
    await flushNavigation();

    expect(deleteIntents).toEqual([]);
    // Instead of proposing a deletion, fetch the book back from the mirror.
    expect(handleBookDownload).toHaveBeenCalledTimes(1);
    expect(navigateToReader).toHaveBeenCalled();
  });

  it('still cleans up a stale in-place record when no mirror could hold the book', async () => {
    routing.backends = [];
    const book = makeBook({ filePath: '/home/reader/moved-away.epub' });

    const { result } = setup();
    await result.current.openBook(book);
    await flushNavigation();

    expect(deleteIntents).toEqual([['h1']]);
    expect(navigateToReader).not.toHaveBeenCalled();
  });

  it('reports failure rather than deleting when the mirror does not have it either', async () => {
    routing.backends = ['gdrive'];
    const book = makeBook({ filePath: 'C:\\Users\\other\\Book.epub' });

    const { result } = setup(false);
    await result.current.openBook(book);
    await flushNavigation();

    expect(deleteIntents).toEqual([]);
    expect(navigateToReader).not.toHaveBeenCalled();
  });
});
