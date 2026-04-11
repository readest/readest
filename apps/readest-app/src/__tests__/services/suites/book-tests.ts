import { describe, it, expect, beforeEach } from 'vitest';
import { Book, BookNote } from '@/types/book';
import { AppService } from '@/types/system';

function makeFakeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'nonexistent-hash',
    format: 'EPUB',
    title: 'Missing Book',
    author: 'Nobody',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function bookTests(
  getService: () => AppService,
  getBookFile: (name: string) => Promise<File | string>,
) {
  // Ensure the Books base directory exists before each book test.
  // writeFile creates parent dirs, but importBook uses createDir (non-recursive).
  beforeEach(async () => {
    await getService().createDir('', 'Books', true);
  });

  describe('Book import', () => {
    it('should import an EPUB book with correct metadata', async () => {
      const service = getService();
      const file = await getBookFile('sample-alice.epub');
      const books: Book[] = [];
      const book = await service.importBook(file, books);

      expect(book).not.toBeNull();
      expect(book!.format).toBe('EPUB');
      expect(book!.hash).toBeTruthy();
      expect(book!.title).toBeTruthy();
      expect(book!.author).toBeTruthy();
      expect(books).toHaveLength(1);
    });

    it('should deduplicate when importing the same file twice', async () => {
      const service = getService();
      const books: Book[] = [];

      const file1 = await getBookFile('sample-alice.epub');
      const first = await service.importBook(file1, books);

      const file2 = await getBookFile('sample-alice.epub');
      const second = await service.importBook(file2, books);

      expect(books).toHaveLength(1);
      expect(second!.hash).toBe(first!.hash);
    });

    it('should not add duplicate when reimporting with overwrite', async () => {
      const service = getService();
      const books: Book[] = [];

      const file1 = await getBookFile('sample-alice.epub');
      const first = await service.importBook(file1, books);

      const file2 = await getBookFile('sample-alice.epub');
      const second = await service.importBook(file2, books, { overwrite: true });

      expect(books).toHaveLength(1);
      expect(second!.hash).toBe(first!.hash);
      expect(second!.updatedAt).toBeGreaterThanOrEqual(first!.updatedAt);
    });

    it('should set hash and timestamps on imported book', async () => {
      const service = getService();
      const books: Book[] = [];
      const before = Date.now();
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      expect(book!.hash).toBeTruthy();
      expect(book!.createdAt).toBeGreaterThanOrEqual(before);
      expect(book!.updatedAt).toBeGreaterThanOrEqual(before);
      expect(book!.downloadedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('Book availability', () => {
    it('should report imported book as available', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      expect(await service.isBookAvailable(book!)).toBe(true);
    });

    it('should report non-existent book as unavailable', async () => {
      const service = getService();
      expect(await service.isBookAvailable(makeFakeBook())).toBe(false);
    });
  });

  describe('Book file size', () => {
    it('should return file size for imported book', async () => {
      const service = getService();
      const file = await getBookFile('sample-alice.epub');
      const books: Book[] = [];
      const book = await service.importBook(file, books);

      const size = await service.getBookFileSize(book!);
      expect(size).toBeGreaterThan(0);
    });

    it('should return null for non-existent book', async () => {
      const service = getService();
      expect(await service.getBookFileSize(makeFakeBook())).toBeNull();
    });
  });

  describe('Book content', () => {
    it('should load content for imported book', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      const content = await service.loadBookContent(book!);
      expect(content.book.hash).toBe(book!.hash);
      expect(content.file).toBeDefined();
      expect(content.file.size).toBeGreaterThan(0);
    });

    it('should throw when loading content for non-existent book', async () => {
      const service = getService();
      await expect(service.loadBookContent(makeFakeBook())).rejects.toThrow();
    });
  });

  describe('Book config', () => {
    it('should load default config for newly imported book', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      const settings = await service.loadSettings();
      const config = await service.loadBookConfig(book!, settings);

      expect(config).toBeDefined();
      expect(config.updatedAt).toBeDefined();
      expect(config.viewSettings).toBeDefined();
      expect(config.searchConfig).toBeDefined();
    });

    it('should save and load book config with progress and location', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      const settings = await service.loadSettings();
      const config = await service.loadBookConfig(book!, settings);

      config.location = 'epubcfi(/6/4!/4/2/1:0)';
      config.progress = [5, 100];

      await service.saveBookConfig(book!, config, settings);
      const loaded = await service.loadBookConfig(book!, settings);

      expect(loaded.location).toBe('epubcfi(/6/4!/4/2/1:0)');
      expect(loaded.progress).toEqual([5, 100]);
    });

    it('should save and load book config with annotations', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      const settings = await service.loadSettings();
      const config = await service.loadBookConfig(book!, settings);

      const note: BookNote = {
        id: 'note-1',
        type: 'annotation',
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        note: 'Test annotation',
        style: 'highlight',
        color: 'yellow',
        text: 'highlighted text',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      config.booknotes = [note];

      await service.saveBookConfig(book!, config, settings);
      const loaded = await service.loadBookConfig(book!, settings);

      expect(loaded.booknotes).toHaveLength(1);
      expect(loaded.booknotes![0]!.id).toBe('note-1');
      expect(loaded.booknotes![0]!.note).toBe('Test annotation');
      expect(loaded.booknotes![0]!.text).toBe('highlighted text');
    });

    it('should save config without settings and load with settings', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);

      const rawConfig = {
        updatedAt: Date.now(),
        location: 'raw-location',
        progress: [10, 200] as [number, number],
      };

      await service.saveBookConfig(book!, rawConfig);
      const settings = await service.loadSettings();
      const loaded = await service.loadBookConfig(book!, settings);

      expect(loaded.location).toBe('raw-location');
      expect(loaded.progress).toEqual([10, 200]);
    });
  });

  describe('Refresh metadata', () => {
    it('should refresh metadata for a single book', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);
      expect(book).not.toBeNull();

      // Clear metadata to simulate a book imported before metadata parsing was added
      book!.metadata = undefined;
      book!.primaryLanguage = undefined;

      const result = await service.refreshBookMetadata(book!);
      expect(result).toBe(true);
      expect(book!.metadata).toBeDefined();
    });

    it('should not update updatedAt', async () => {
      const service = getService();
      const books: Book[] = [];
      const book = await service.importBook(await getBookFile('sample-alice.epub'), books);
      expect(book).not.toBeNull();

      const oldUpdatedAt = book!.updatedAt;
      await service.refreshBookMetadata(book!);
      expect(book!.updatedAt).toBe(oldUpdatedAt);
    });
  });
}
