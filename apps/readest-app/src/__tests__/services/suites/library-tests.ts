import { describe, it, expect } from 'vitest';
import { Book } from '@/types/book';
import { AppService } from '@/types/system';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abc123',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Test Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

export function libraryTests(getService: () => AppService) {
  describe('Library', () => {
    it('should return empty array when no library file exists', async () => {
      const books = await getService().loadLibraryBooks();
      expect(books).toEqual([]);
    });

    it('should save and load a single book', async () => {
      const service = getService();
      const book = makeBook();
      await service.saveLibraryBooks([book]);

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.hash).toBe('abc123');
      expect(loaded[0]!.title).toBe('Test Book');
      expect(loaded[0]!.author).toBe('Test Author');
    });

    it('should save and load multiple books', async () => {
      const service = getService();
      const books = [
        makeBook({ hash: 'h1', title: 'Book One' }),
        makeBook({ hash: 'h2', title: 'Book Two' }),
        makeBook({ hash: 'h3', title: 'Book Three' }),
      ];
      await service.saveLibraryBooks(books);

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toHaveLength(3);
      const titles = loaded.map((b) => b.title).sort();
      expect(titles).toEqual(['Book One', 'Book Three', 'Book Two']);
    });

    it('should strip coverImageUrl when saving', async () => {
      const service = getService();
      const book = makeBook({ coverImageUrl: 'http://example.com/cover.jpg' });
      await service.saveLibraryBooks([book]);

      const raw = (await service.readFile('library.json', 'Books', 'text')) as string;
      const parsed = JSON.parse(raw) as Book[];
      expect(parsed[0]!.coverImageUrl).toBeUndefined();
    });

    it('should create backup file alongside main file', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook()]);

      expect(await service.exists('library.json', 'Books')).toBe(true);
      expect(await service.exists('library.json.bak', 'Books')).toBe(true);
    });

    it('should fall back to backup when main file is corrupted', async () => {
      const service = getService();
      const book = makeBook({ hash: 'good' });
      await service.saveLibraryBooks([book]);

      // Corrupt the main file
      await service.writeFile('library.json', 'Books', '{corrupted data!!!');

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.hash).toBe('good');
    });

    it('should return empty array when both main and backup are corrupted', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook()]);

      await service.writeFile('library.json', 'Books', 'bad');
      await service.writeFile('library.json.bak', 'Books', 'bad');

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toEqual([]);
    });

    it('should overwrite (and shrink) the library only when replace is set', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook({ hash: 'old' })]);

      const newBooks = [makeBook({ hash: 'new1' }), makeBook({ hash: 'new2' })];
      await service.saveLibraryBooks(newBooks, { replace: true });

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toHaveLength(2);
      const hashes = loaded.map((b) => b.hash).sort();
      expect(hashes).toEqual(['new1', 'new2']);
    });

    it('should preserve all book fields through round-trip', async () => {
      const service = getService();
      const book = makeBook({
        hash: 'full',
        title: 'Full Book',
        author: 'Full Author',
        format: 'PDF',
        tags: ['fiction', 'sci-fi'],
        groupName: 'Series A',
        progress: [5, 100],
        createdAt: 1000,
        updatedAt: 2000,
      });
      await service.saveLibraryBooks([book]);

      const loaded = await service.loadLibraryBooks();
      expect(loaded[0]!.hash).toBe('full');
      expect(loaded[0]!.format).toBe('PDF');
      expect(loaded[0]!.tags).toEqual(['fiction', 'sci-fi']);
      expect(loaded[0]!.groupName).toBe('Series A');
      expect(loaded[0]!.progress).toEqual([5, 100]);
    });

    it('should set updatedAt from lastUpdated for legacy books', async () => {
      const service = getService();
      // Write a legacy book JSON with lastUpdated but no updatedAt
      const legacyBook = {
        hash: 'legacy',
        format: 'EPUB',
        title: 'Old',
        author: 'A',
        createdAt: 1000,
        lastUpdated: 5000,
      };
      await service.writeFile('library.json', 'Books', JSON.stringify([legacyBook]));

      const loaded = await service.loadLibraryBooks();
      expect(loaded[0]!.updatedAt).toBe(5000);
    });

    it('should clear the library when saving an empty array with replace', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook()]);
      await service.saveLibraryBooks([], { replace: true });

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toEqual([]);
    });

    // Merge-floor safebelt: a routine save may ADD or MODIFY rows (including
    // setting `deletedAt` tombstones) but must never silently DROP a book that
    // exists on disk. Guards against a stale or partially-loaded in-memory
    // library wiping library.json (the cold-start "Open with" race).
    it('should not drop on-disk books absent from the saved set (merge floor)', async () => {
      const service = getService();
      await service.saveLibraryBooks([
        makeBook({ hash: 'a', title: 'A' }),
        makeBook({ hash: 'b', title: 'B' }),
        makeBook({ hash: 'c', title: 'C' }),
      ]);

      // A later save that only knows about 'a' must not erase 'b' and 'c'.
      await service.saveLibraryBooks([makeBook({ hash: 'a', title: 'A2' })]);

      const loaded = await service.loadLibraryBooks();
      const byHash = Object.fromEntries(loaded.map((b) => [b.hash, b.title]));
      expect(loaded).toHaveLength(3);
      expect(byHash).toEqual({ a: 'A2', b: 'B', c: 'C' });
    });

    it('should preserve the whole library when an empty set is saved (no wipe)', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook({ hash: 'a' }), makeBook({ hash: 'b' })]);

      await service.saveLibraryBooks([]);

      const loaded = await service.loadLibraryBooks();
      expect(loaded.map((b) => b.hash).sort()).toEqual(['a', 'b']);
    });

    it('should keep tombstones (deletedAt) not present in the incoming set', async () => {
      const service = getService();
      await service.saveLibraryBooks([
        makeBook({ hash: 'live' }),
        makeBook({ hash: 'gone', deletedAt: 1234 }),
      ]);

      // A save that omits the tombstone must neither lose nor resurrect it.
      await service.saveLibraryBooks([makeBook({ hash: 'live' })]);

      const loaded = await service.loadLibraryBooks();
      const tomb = loaded.find((b) => b.hash === 'gone');
      expect(loaded).toHaveLength(2);
      expect(tomb?.deletedAt).toBe(1234);
    });

    it('should let the incoming row win on a hash conflict (modify in place)', async () => {
      const service = getService();
      await service.saveLibraryBooks([makeBook({ hash: 'a', title: 'old' })]);
      await service.saveLibraryBooks([makeBook({ hash: 'a', title: 'new' })]);

      const loaded = await service.loadLibraryBooks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.title).toBe('new');
    });
  });
}
