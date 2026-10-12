import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book, BookConfig } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';

// `@/libs/document` loads the vendored pdf.js build (absent in a bare checkout);
// the store only uses its `BookDoc` as a type, so stub the module.
vi.mock('@/libs/document', () => ({}));

import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';

// saveConfig used to `return` the moment a book was missing from the library
// hashIndex (`if (idx === undefined) return;`). A mid-session library reload can
// drop the in-memory entry, and that early return silently skipped writing the
// per-book config.json too — losing the highlight/bookmark/progress the user
// had just made. The fix falls back to writing config.json (the sync source of
// truth) from the open book, skipping only the library move-to-front.

const HASH = 'deadbeef';

const makeBook = (): Book =>
  ({ hash: HASH, format: 'EPUB', title: 't', author: 'a' }) as unknown as Book;

const makeConfig = (): BookConfig =>
  ({ bookHash: HASH, progress: [1, 100], booknotes: [] }) as unknown as BookConfig;

const saveBookConfig = vi.fn().mockResolvedValue(undefined);
const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);

const envConfig = {
  getAppService: async () => ({ saveBookConfig, saveLibraryBooks }),
} as unknown as EnvConfigType;

const settings = { globalViewSettings: {} } as unknown as SystemSettings;

beforeEach(() => {
  saveBookConfig.mockClear();
  saveLibraryBooks.mockClear();
  // Library index does NOT contain the book (simulates the dropped entry).
  useLibraryStore.setState({ library: [], hashIndex: new Map() });
  // But the book is open in the reader.
  useBookDataStore.setState({
    booksData: {
      [HASH]: {
        id: HASH,
        book: makeBook(),
        file: null,
        config: makeConfig(),
        bookDoc: null,
        isFixedLayout: false,
      },
    },
  });
});

describe('bookDataStore.saveConfig — missing from library index', () => {
  it('still writes the per-book config.json from the open book', async () => {
    await useBookDataStore
      .getState()
      .saveConfig(envConfig, `${HASH}-view1`, makeConfig(), settings);

    expect(saveBookConfig).toHaveBeenCalledTimes(1);
    const [bookArg] = saveBookConfig.mock.calls[0]!;
    expect((bookArg as Book).hash).toBe(HASH);
  });

  it('gives up only when the book is absent from both the index and the reader', async () => {
    useBookDataStore.setState({ booksData: {} });

    await useBookDataStore
      .getState()
      .saveConfig(envConfig, `${HASH}-view1`, makeConfig(), settings);

    expect(saveBookConfig).not.toHaveBeenCalled();
  });
});
