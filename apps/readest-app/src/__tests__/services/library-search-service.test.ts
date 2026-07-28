import { describe, expect, it, vi } from 'vitest';

import { searchLibraryBooks } from '@/services/librarySearchService';
import { BookFileNotFoundError } from '@/services/errors';
import type { Book, BookContent, BookSearchConfig } from '@/types/book';
import type { AppService } from '@/types/system';

const makeBook = (hash: string, title: string): Book => ({
  hash,
  format: 'MD',
  title,
  author: 'Test Author',
  createdAt: 1,
  updatedAt: 1,
  primaryLanguage: 'en',
});

const makeFile = (text: string) => {
  const file = new File([text], 'book.md', { type: 'text/markdown' }) as File & {
    close: ReturnType<typeof vi.fn>;
  };
  file.close = vi.fn().mockResolvedValue(undefined);
  return file;
};

const makeService = (files: Map<string, File | null>) =>
  ({
    getBookFileSize: vi.fn(async (book: Book) => files.get(book.hash)?.size ?? null),
    loadBookContent: vi.fn(async (book: Book): Promise<BookContent> => {
      const file = files.get(book.hash);
      if (!file) throw new BookFileNotFoundError();
      return { book, file };
    }),
    resolveNativeBookFilePath: vi.fn().mockResolvedValue(null),
  }) as Pick<AppService, 'getBookFileSize' | 'loadBookContent' | 'resolveNativeBookFilePath'>;

const config: BookSearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

describe('searchLibraryBooks', () => {
  it('streams exact-CFI results and progress one book at a time', async () => {
    const first = makeBook('first', 'First Book');
    const second = makeBook('second', 'Second Book');
    const files = new Map<string, File | null>([
      ['first', makeFile('# First chapter\nA needle appears here.')],
      ['second', makeFile('# Second chapter\nAnother needle appears here.')],
    ]);
    const events = [];

    for await (const event of searchLibraryBooks(makeService(files), [first, second], 'needle', {
      config,
    })) {
      events.push(event);
    }

    const results = events.filter((event) => event.type === 'result');
    expect(results.map(({ book }) => book.title)).toEqual(['First Book', 'Second Book']);
    expect(results.every(({ result }) => result.subitems[0]!.cfi.startsWith('epubcfi('))).toBe(
      true,
    );
    expect(results[0]!.result.subitems[0]!.highlightCfi).not.toBe(
      results[0]!.result.subitems[0]!.cfi,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      searchedBooks: 2,
      skippedBooks: 0,
      erroredBooks: 0,
      matchCount: 2,
    });
    expect(events.findIndex(({ type }) => type === 'result')).toBeLessThan(
      events.findIndex(({ type }) => type === 'book-completed'),
    );
  });

  it('reports unavailable and invalid books without stopping later books', async () => {
    const unavailable = makeBook('missing', 'Missing Book');
    const invalid = makeBook('invalid', 'Invalid Book');
    const valid = makeBook('valid', 'Valid Book');
    const invalidFile = new File(['not an epub'], 'invalid.epub', {
      type: 'application/epub+zip',
    });
    const files = new Map<string, File | null>([
      ['missing', null],
      ['invalid', invalidFile],
      ['valid', makeFile('# Chapter\nThe needle survives.')],
    ]);
    const events = [];

    for await (const event of searchLibraryBooks(
      makeService(files),
      [unavailable, invalid, valid],
      'needle',
      { config },
    )) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'book-skipped', book: unavailable, reason: 'unavailable' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'book-error', book: invalid }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'result', book: valid }));
    expect(events.at(-1)).toMatchObject({ skippedBooks: 1, erroredBooks: 1, searchedBooks: 1 });
  });

  it('reports load failures and continues with later books', async () => {
    const failing = makeBook('failing', 'Failing Book');
    const valid = makeBook('valid', 'Valid Book');
    const files = new Map<string, File | null>([
      ['failing', makeFile('broken')],
      ['valid', makeFile('# Chapter\nneedle')],
    ]);
    const service = makeService(files);
    service.loadBookContent = vi.fn(async (book) => {
      if (book.hash === 'failing') throw new Error('load failed');
      return { book, file: files.get(book.hash)! };
    });
    const collected = [];

    for await (const event of searchLibraryBooks(service, [failing, valid], 'needle', { config })) {
      collected.push(event);
    }

    expect(collected).toContainEqual(
      expect.objectContaining({ type: 'book-error', book: failing, error: 'load failed' }),
    );
    expect(collected).toContainEqual(expect.objectContaining({ type: 'result', book: valid }));
  });

  it('searches a loadable book when its file size is unavailable', async () => {
    const book = makeBook('remote', 'Remote Book');
    const file = makeFile('# Chapter\nHogwarts');
    const service = makeService(new Map([['remote', file]]));
    service.getBookFileSize = vi.fn().mockResolvedValue(null);
    const collected = [];

    for await (const event of searchLibraryBooks(service, [book], 'Hogwarts', { config })) {
      collected.push(event);
    }

    expect(service.loadBookContent).toHaveBeenCalledWith(book);
    expect(collected).toContainEqual(expect.objectContaining({ type: 'result', book }));
    expect(collected.at(-1)).toMatchObject({ searchedBooks: 1, skippedBooks: 0 });
  });

  it('supports fuzzy section matching with segmented highlights', async () => {
    const book = makeBook('fuzzy', 'Fuzzy Book');
    const files = new Map<string, File | null>([
      ['fuzzy', makeFile('# Chapter\nUserAuthController validates the shcema.')],
    ]);
    const events = [];

    for await (const event of searchLibraryBooks(makeService(files), [book], 'UserController', {
      config: { ...config, mode: 'fuzzy' },
    })) {
      events.push(event);
    }

    const result = events.find((event) => event.type === 'result');
    expect(result?.result.subitems[0]?.excerpt.match).toBe('UserAuthController');
    expect(
      result?.result.subitems[0]?.excerpt.segments?.filter(({ emphasized }) => emphasized),
    ).toHaveLength(2);
    expect(result?.result.subitems[0]?.cfis).toHaveLength(2);
  });

  it('stops cooperatively and closes the current file when aborted', async () => {
    const first = makeBook('first', 'First Book');
    const second = makeBook('second', 'Second Book');
    const firstFile = makeFile('# Chapter\nneedle');
    const secondFile = makeFile('# Chapter\nneedle');
    const files = new Map<string, File | null>([
      ['first', firstFile],
      ['second', secondFile],
    ]);
    const controller = new AbortController();
    const events = [];

    for await (const event of searchLibraryBooks(makeService(files), [first, second], 'needle', {
      config,
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'result') controller.abort();
    }

    expect(events.some(({ type }) => type === 'completed')).toBe(false);
    expect(events.some((event) => event.type === 'book-started' && event.book === second)).toBe(
      false,
    );
    expect(firstFile.close).toHaveBeenCalledOnce();
  });

  it('closes the current file when the consumer returns early', async () => {
    const book = makeBook('book', 'Book');
    const file = makeFile('# Chapter\nneedle');
    const iterator = searchLibraryBooks(makeService(new Map([['book', file]])), [book], 'needle', {
      config,
    });

    let event = await iterator.next();
    while (!event.done && event.value.type !== 'result') event = await iterator.next();
    await iterator.return(undefined);

    expect(file.close).toHaveBeenCalledOnce();
  });
});
