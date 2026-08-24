import { describe, it, expect, beforeEach, vi } from 'vitest';
import { backfillAbsCovers } from '@/services/audiobookshelf/librarySync';
import { useABSServerStore } from '@/store/absServerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { makeAbsFilePath } from '@/utils/audiobook';
import { getCoverFilename } from '@/utils/book';
import type { ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

// absServerStore publishes replica upserts/deletes from its mutators; state
// here is seeded via setState, but the module imports replicaPublish at load.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
}));

import { downloadFile } from '@/libs/storage';

const mockedDownloadFile = vi.mocked(downloadFile);

const server: ABSServer = {
  id: 'srv1',
  contentId: 'srv1',
  addedAt: 1,
  name: 'Home',
  url: 'http://abs.local',
};

const makeAbsBook = (itemId: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash: `hash-${itemId}`,
    format: 'ABS',
    title: `Title ${itemId}`,
    author: 'Author',
    filePath: makeAbsFilePath('srv1', itemId),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Book;

const makeAppService = (coverExists = false) =>
  ({
    resolveFilePath: vi.fn(async (path: string) => `/cache/${path}`),
    exists: vi.fn(async () => coverExists),
    readFile: vi.fn(async () => new ArrayBuffer(8)),
    writeFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    computeCoverHash: vi.fn(async () => 'new-cover-hash'),
    generateCoverImageUrl: vi.fn(async () => 'blob:new-cover-url'),
    saveLibraryBooks: vi.fn(async () => {}),
  }) as unknown as AppService;

describe('backfillAbsCovers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDownloadFile.mockResolvedValue(undefined as never);
    useABSServerStore.setState({ servers: [server] });
    useLibraryStore.setState({ library: [] });
    useSettingsStore.setState({
      settings: { absServers: [] } as unknown as SystemSettings,
    });
  });

  it('downloads a missing cover unauthenticated and persists the updated book', async () => {
    const book = makeAbsBook('item1');
    useLibraryStore.setState({ library: [book] });
    const appService = makeAppService(false);

    await backfillAbsCovers(appService);

    expect(mockedDownloadFile).toHaveBeenCalledTimes(1);
    // Cover endpoint is public — the URL must carry no token.
    const arg = mockedDownloadFile.mock.calls[0]![0] as { url: string };
    expect(arg.url).toBe('http://abs.local/api/items/item1/cover');

    const updated = useLibraryStore.getState().library.find((b) => b.hash === book.hash)!;
    expect(updated.coverHash).toBe('new-cover-hash');
    expect(updated.coverImageUrl).toBe('blob:new-cover-url');
    // The store entry must be a fresh object; the original book object in the
    // pre-save library must not have been mutated in place.
    expect(updated).not.toBe(book);
    expect(book.coverHash).toBeUndefined();

    expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(appService.saveLibraryBooks).mock.calls[0]![0] as Book[];
    expect(saved.find((b) => b.hash === book.hash)?.coverHash).toBe('new-cover-hash');
  });

  it('skips books whose server row is absent', async () => {
    useABSServerStore.setState({ servers: [] });
    useLibraryStore.setState({ library: [makeAbsBook('item1')] });
    const appService = makeAppService(false);

    await backfillAbsCovers(appService);

    expect(mockedDownloadFile).not.toHaveBeenCalled();
    expect(appService.saveLibraryBooks).not.toHaveBeenCalled();
  });

  it('skips books whose cover file already exists locally', async () => {
    const book = makeAbsBook('item1');
    useLibraryStore.setState({ library: [book] });
    const appService = makeAppService(true);

    await backfillAbsCovers(appService);

    expect(vi.mocked(appService.exists)).toHaveBeenCalledWith(getCoverFilename(book), 'Books');
    expect(mockedDownloadFile).not.toHaveBeenCalled();
    expect(appService.saveLibraryBooks).not.toHaveBeenCalled();
  });

  it('skips deleted books and non-ABS books', async () => {
    useLibraryStore.setState({
      library: [
        makeAbsBook('item1', { deletedAt: 123 }),
        { hash: 'h-epub', format: 'EPUB', title: 'T', filePath: '/books/t.epub' } as Book,
      ],
    });
    const appService = makeAppService(false);

    await backfillAbsCovers(appService);

    expect(mockedDownloadFile).not.toHaveBeenCalled();
    expect(appService.saveLibraryBooks).not.toHaveBeenCalled();
  });

  it('leaves the library untouched when the download fails', async () => {
    mockedDownloadFile.mockRejectedValue(new Error('offline'));
    const book = makeAbsBook('item1');
    useLibraryStore.setState({ library: [book] });
    const appService = makeAppService(false);

    await backfillAbsCovers(appService);

    const entry = useLibraryStore.getState().library.find((b) => b.hash === book.hash)!;
    expect(entry.coverHash).toBeUndefined();
    expect(appService.saveLibraryBooks).not.toHaveBeenCalled();
  });
});
