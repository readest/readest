import { describe, it, expect, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import {
  createCollectionPack,
  extractCollectionPack,
  isReadestPackFile,
  MAX_PACK_ENTRY_BYTES,
  READEST_PACK_EXT,
} from '@/services/pack/packService';
import { configureZip } from '@/utils/zip';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abcdef1234567890abcdef1234567890',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Test Author',
    createdAt: 1000,
    updatedAt: 2000,
    tags: ['Classics', 'Fiction'],
    groupName: 'My Collection',
    ...overrides,
  };
}

function makeMockAppService(fileContent = 'mock epub content'): AppService {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(fileContent).buffer;

  return {
    exists: vi.fn(async (_path: string) => true),
    readFile: vi.fn(async (_path: string, _base: string, _mode: string) => buffer),
    resolveFilePath: vi.fn(async (path: string) => `/mock/path/${path}`),
  } as unknown as AppService;
}

describe('packService', () => {
  describe('isReadestPackFile', () => {
    it('identifies .rbooks files correctly regardless of casing', () => {
      expect(isReadestPackFile('collection.rbooks')).toBe(true);
      expect(isReadestPackFile('/path/to/my_books.RBOOKS')).toBe(true);
      expect(isReadestPackFile('books.epub')).toBe(false);
      expect(isReadestPackFile('archive.zip')).toBe(false);
    });
  });

  describe('createCollectionPack', () => {
    it('returns null if book list is empty', async () => {
      const appService = makeMockAppService();
      const result = await createCollectionPack(appService, []);
      expect(result).toBeNull();
    });

    it('creates a .rbooks archive with manifest and book entries', async () => {
      const appService = makeMockAppService('dummy epub binary data');
      const book1 = makeBook({ title: 'Book One', hash: 'hash1' });
      const book2 = makeBook({ title: 'Book Two', hash: 'hash2', format: 'PDF' });

      const progressCalls: Array<{ current: number; total: number; title: string }> = [];
      const onProgress = (current: number, total: number, title: string) => {
        progressCalls.push({ current, total, title });
      };

      const result = await createCollectionPack(
        appService,
        [book1, book2],
        'World Classics',
        onProgress,
      );

      expect(result).not.toBeNull();
      expect(result?.filename).toBe(`World_Classics.${READEST_PACK_EXT}`);
      expect(result?.count).toBe(2);
      expect(progressCalls.length).toBe(2);

      // Verify the archive content by extracting it
      const extracted = await extractCollectionPack(result!.data);
      expect(extracted).not.toBeNull();
      expect(extracted?.collectionName).toBe('World Classics');
      expect(extracted?.books.length).toBe(2);

      const fileNames = extracted!.books.map((b) => b.file.name);
      expect(fileNames.some((name) => name.includes('Book One') || name.includes('Book_One'))).toBe(
        true,
      );
      expect(fileNames.some((name) => name.includes('Book Two') || name.includes('Book_Two'))).toBe(
        true,
      );

      // Verify manifest metadata
      expect(extracted?.manifest?.format).toBe('rbooks');
      expect(extracted?.manifest?.books.length).toBe(2);
      expect(extracted?.manifest?.collection?.name).toBe('World Classics');
    });

    it('handles duplicate file names safely by appending index', async () => {
      const appService = makeMockAppService();
      const book1 = makeBook({ title: 'Same Title', hash: 'hashA' });
      const book2 = makeBook({ title: 'Same Title', hash: 'hashB' });
      const book3 = makeBook({ title: 'Same Title', hash: 'hashC' });

      const result = await createCollectionPack(appService, [book1, book2, book3], 'Duplicates');
      expect(result).not.toBeNull();

      const extracted = await extractCollectionPack(result!.data);
      expect(extracted?.books.length).toBe(3);
      const names = extracted!.books.map((b) => b.file.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(3);
    });

    it("keeps each book's group when the pack spans several groups", async () => {
      const appService = makeMockAppService();
      const books = [
        makeBook({ title: 'One', hash: 'hashA', groupName: 'Classics' }),
        makeBook({ title: 'Two', hash: 'hashB', groupName: 'Classics/Poetry' }),
        makeBook({ title: 'Three', hash: 'hashC', groupName: 'Essays' }),
        makeBook({ title: 'Four', hash: 'hashD', groupName: undefined }),
      ];

      const result = await createCollectionPack(appService, books);
      const extracted = await extractCollectionPack(result!.data);

      expect(extracted?.collectionName).toBeUndefined();
      expect(extracted?.books.map((book) => book.groupName)).toEqual([
        'Classics',
        'Classics/Poetry',
        'Essays',
        undefined,
      ]);
    });

    it('puts books without their own group in the pack collection', async () => {
      const manifest = {
        format: 'rbooks',
        version: 1,
        createdAt: 0,
        collection: { name: 'Classics', count: 2 },
        books: [{ filename: 'books/a.epub', title: 'A', format: 'EPUB' }],
      };
      const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');
      const blobWriter = new BlobWriter();
      const zipWriter = new ZipWriter(blobWriter);
      const encode = (text: string) => new Uint8ArrayReader(new TextEncoder().encode(text));
      await zipWriter.add('books/a.epub', encode('a'));
      await zipWriter.add('books/b.epub', encode('b'));
      await zipWriter.add('readest-manifest.json', encode(JSON.stringify(manifest)));
      await zipWriter.close();

      const extracted = await extractCollectionPack(
        await (await blobWriter.getData()).arrayBuffer(),
      );

      expect(extracted?.books.map((book) => book.groupName)).toEqual(['Classics', 'Classics']);
    });
  });

  describe('extractCollectionPack', () => {
    it('returns null on invalid or corrupt archive data', async () => {
      const corruptedData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
      const result = await extractCollectionPack(corruptedData);
      expect(result).toBeNull();
    });

    it('protects against Zip-Slip path traversal entries', async () => {
      await configureZip();
      const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter);

      // Add a malicious traversal entry
      await zipWriter.add(
        '../../etc/passwd',
        new Uint8ArrayReader(new TextEncoder().encode('malicious content')),
      );
      // Add a valid book entry
      await zipWriter.add(
        'books/legit.epub',
        new Uint8ArrayReader(new TextEncoder().encode('valid book content')),
      );

      await zipWriter.close();
      const blob = await blobWriter.getData();
      const buffer = await blob.arrayBuffer();

      const extracted = await extractCollectionPack(buffer);
      expect(extracted).not.toBeNull();
      // Only the legit book should be extracted, the path traversal entry must be dropped
      expect(extracted?.books.length).toBe(1);
      expect(extracted?.books[0]?.file.name).toBe('legit.epub');
    });

    it('extracts book files from generic zip archives without manifest', async () => {
      await configureZip();
      const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter);

      await zipWriter.add(
        'my_novel.epub',
        new Uint8ArrayReader(new TextEncoder().encode('novel content')),
      );
      await zipWriter.add(
        'document.pdf',
        new Uint8ArrayReader(new TextEncoder().encode('pdf content')),
      );
      await zipWriter.add(
        'notes.txt',
        new Uint8ArrayReader(new TextEncoder().encode('text notes')),
      );

      await zipWriter.close();
      const blob = await blobWriter.getData();
      const buffer = await blob.arrayBuffer();

      const extracted = await extractCollectionPack(buffer);
      expect(extracted).not.toBeNull();
      expect(extracted?.collectionName).toBeUndefined();
      expect(extracted?.books.length).toBe(3);
    });

    it('rejects the whole archive when the cumulative size limit is exceeded', async () => {
      await configureZip();
      const { BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } = await import('@zip.js/zip.js');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter);
      for (let i = 1; i <= 5; i++) {
        await zipWriter.add(
          `book${i}.epub`,
          new Uint8ArrayReader(new TextEncoder().encode(`content ${i}`)),
        );
      }
      await zipWriter.close();
      const buffer = await (await blobWriter.getData()).arrayBuffer();

      // Report each entry at the per-book limit so five of them pass 4 GB in total
      const getEntries = ZipReader.prototype.getEntries;
      const spy = vi.spyOn(ZipReader.prototype, 'getEntries').mockImplementation(async function (
        this: InstanceType<typeof ZipReader>,
        options,
      ) {
        const entries = await getEntries.call(this, options);
        for (const entry of entries) entry.uncompressedSize = MAX_PACK_ENTRY_BYTES;
        return entries;
      });
      try {
        expect(await extractCollectionPack(buffer)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('safely handles and sanitizes invalid collection.name in manifest', async () => {
      await configureZip();
      const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter);

      // Add manifest with invalid collection.name (object instead of string)
      const invalidManifest = {
        format: 'rbooks',
        version: 1,
        collection: { name: { invalid: 123 } },
        books: [{ id: 'b1', filename: 'book1.epub' }],
      };

      await zipWriter.add(
        'readest-manifest.json',
        new Uint8ArrayReader(new TextEncoder().encode(JSON.stringify(invalidManifest))),
      );
      await zipWriter.add(
        'book1.epub',
        new Uint8ArrayReader(new TextEncoder().encode('epub content')),
      );

      await zipWriter.close();
      const blob = await blobWriter.getData();
      const buffer = await blob.arrayBuffer();

      const extracted = await extractCollectionPack(buffer);
      expect(extracted).not.toBeNull();
      expect(extracted?.collectionName).toBeUndefined();
      expect(extracted?.books.length).toBe(1);
    });
  });
});
