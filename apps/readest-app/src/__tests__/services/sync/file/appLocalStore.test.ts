import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';

/**
 * Regression test for the library-clobber data-loss path: when "Sync now"
 * runs while the library store hasn't loaded yet (the app launched straight
 * into the reader / settings, never mounting the Library view), the engine's
 * addBookToLibrary / updateBookMetadata used to merge against the EMPTY
 * in-memory library and persist a downloaded book (or a metadata update) as
 * the *entire* library, wiping everything already on disk. The store bridge
 * now hydrates from disk first.
 */

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

let savedLibrary: Book[] | null;
let appService: AppService;
let envConfig: EnvConfigType;

const onDisk = [makeBook('a'), makeBook('b')];

beforeEach(() => {
  savedLibrary = null;
  // Simulate the unloaded store: the user hasn't visited the Library view.
  useLibraryStore.setState({ library: [], libraryLoaded: false, hashIndex: new Map() });
  appService = {
    loadLibraryBooks: vi.fn(async () => onDisk.map((b) => ({ ...b }))),
    saveLibraryBooks: vi.fn(async (books: Book[]) => {
      savedLibrary = books;
    }),
    generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  } as unknown as AppService;
  envConfig = { getAppService: async () => appService } as unknown as EnvConfigType;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeStore = () =>
  createAppLocalStore({ appService, settings: {} as SystemSettings, envConfig });

describe('createAppLocalStore — library hydration (data-loss guard)', () => {
  test('addBookToLibrary keeps existing on-disk books when the store is unloaded', async () => {
    await makeStore().addBookToLibrary(makeBook('c'));

    expect(appService.loadLibraryBooks).toHaveBeenCalledTimes(1);
    expect(savedLibrary).not.toBeNull();
    const hashes = savedLibrary!.map((b) => b.hash).sort();
    // The downloaded book is appended; a, b must survive (no clobber to [c]).
    expect(hashes).toEqual(['a', 'b', 'c']);
  });

  test('updateBookMetadata does not wipe the library when the store is unloaded', async () => {
    await makeStore().updateBookMetadata(makeBook('a', { title: 'New Title', updatedAt: 9 }));

    expect(appService.loadLibraryBooks).toHaveBeenCalled();
    expect(savedLibrary).not.toBeNull();
    const hashes = savedLibrary!.map((b) => b.hash).sort();
    // Both books survive; a is updated in place, b is untouched.
    expect(hashes).toEqual(['a', 'b']);
    expect(savedLibrary!.find((b) => b.hash === 'a')!.title).toBe('New Title');
  });

  test('addBookToLibrary merges against an already-loaded store without reloading', async () => {
    useLibraryStore.getState().setLibrary([makeBook('a'), makeBook('b')]);
    await makeStore().addBookToLibrary(makeBook('c'));

    expect(appService.loadLibraryBooks).not.toHaveBeenCalled();
    expect(savedLibrary!.map((b) => b.hash).sort()).toEqual(['a', 'b', 'c']);
  });
});
