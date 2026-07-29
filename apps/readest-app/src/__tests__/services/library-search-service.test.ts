import { describe, expect, it, vi } from 'vitest';

import { createLibrarySearchSession, searchLibraryBooks } from '@/services/librarySearchService';
import { BookFileNotFoundError } from '@/services/errors';
import type { Book, BookContent, LibrarySearchConfig } from '@/types/book';
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

const makeDocument = (text: string) => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.textContent = text;
  return doc;
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

const config: LibrarySearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

describe('searchLibraryBooks', () => {
  it('streams results and progress, recovers per book, and stops cooperatively', async () => {
    const unavailable = makeBook('missing', 'Missing Book');
    const invalid = makeBook('invalid', 'Invalid Book');
    const first = makeBook('first', 'First Book');
    const second = makeBook('second', 'Second Book');
    const invalidFile = new File(['not an epub'], 'invalid.epub', {
      type: 'application/epub+zip',
    });
    const files = new Map<string, File | null>([
      ['missing', null],
      ['invalid', invalidFile],
      ['first', makeFile('# First chapter\nA needle appears here.')],
      ['second', makeFile('# Second chapter\nAnother needle appears here.')],
    ]);
    const service = makeService(files);
    const events = [];

    for await (const event of searchLibraryBooks(
      service,
      [unavailable, invalid, first, second],
      'needle',
      { config },
    )) {
      events.push(event);
    }

    const results = events.filter((event) => event.type === 'result');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'book-skipped', book: unavailable, reason: 'unavailable' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'book-error', book: invalid }));
    expect(events.some(({ type }) => type === 'progress')).toBe(true);
    expect(results.map(({ book }) => book.title)).toEqual(['First Book', 'Second Book']);
    expect(results.every(({ result }) => result.subitems[0]!.cfi.startsWith('epubcfi('))).toBe(
      true,
    );
    expect(events.findIndex(({ type }) => type === 'result')).toBeLessThan(
      events.findIndex(({ type }) => type === 'book-completed'),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      searchedBooks: 2,
      skippedBooks: 1,
      erroredBooks: 1,
      matchCount: 2,
    });
    expect(service.getBookFileSize).not.toHaveBeenCalled();

    const abortFirst = makeBook('abort-first', 'Abort First');
    const abortSecond = makeBook('abort-second', 'Abort Second');
    const abortFile = makeFile('# Chapter\nneedle');
    const abortService = makeService(
      new Map([
        ['abort-first', abortFile],
        ['abort-second', makeFile('# Chapter\nneedle')],
      ]),
    );
    const controller = new AbortController();
    const abortedEvents = [];

    for await (const event of searchLibraryBooks(
      abortService,
      [abortFirst, abortSecond],
      'needle',
      { config, signal: controller.signal },
    )) {
      abortedEvents.push(event);
      if (event.type === 'result') controller.abort();
    }

    expect(abortedEvents.some(({ type }) => type === 'completed')).toBe(false);
    expect(
      abortedEvents.some((event) => event.type === 'book-started' && event.book === abortSecond),
    ).toBe(false);
    expect(abortFile.close).toHaveBeenCalledOnce();
  });

  it('reuses one session across content modes and closes cached files', async () => {
    const book = makeBook('book', 'Book');
    const file = makeFile('# Chapter\nneedle and UserAuthController near one words');
    const service = makeService(new Map([['book', file]]));
    const session = createLibrarySearchSession(service);
    const containsEvents = [];
    const fuzzyEvents = [];
    const nearbyEvents = [];

    for await (const event of searchLibraryBooks(service, [book], 'needle', { config, session })) {
      containsEvents.push(event);
    }
    for await (const event of searchLibraryBooks(service, [book], 'UserController', {
      config: { ...config, mode: 'fuzzy' },
      session,
    })) {
      fuzzyEvents.push(event);
    }
    for await (const event of searchLibraryBooks(service, [book], 'near words', {
      config: { ...config, mode: 'nearby-words', nearbyWords: 5 },
      session,
    })) {
      nearbyEvents.push(event);
    }

    const fuzzyResult = fuzzyEvents.find((event) => event.type === 'result');
    const nearbyResult = nearbyEvents.find((event) => event.type === 'result');
    expect(containsEvents).toContainEqual(expect.objectContaining({ type: 'result', book }));
    expect(fuzzyResult?.result.subitems[0]?.excerpt.match).toBe('UserAuthController');
    expect(
      fuzzyResult?.result.subitems[0]?.excerpt.segments?.filter(({ emphasized }) => emphasized),
    ).toHaveLength(2);
    expect(fuzzyResult?.result.subitems[0]?.cfis).toHaveLength(2);
    expect(
      nearbyResult?.result.subitems[0]?.excerpt.segments?.filter(({ emphasized }) => emphasized),
    ).toHaveLength(2);
    expect(nearbyResult?.result.subitems[0]?.cfis).toHaveLength(2);
    expect(service.loadBookContent).toHaveBeenCalledOnce();
    expect(file.close).not.toHaveBeenCalled();

    await session.close();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('keeps excerpt context across long whitespace runs', async () => {
    const book = makeBook('context', 'Context');
    const whitespace = ' '.repeat(300);
    const service = makeService(
      new Map([['context', makeFile(`# Chapter\nlead🙂${whitespace}needle${whitespace}🙂trail`)]]),
    );
    const events = [];

    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      events.push(event);
    }

    const result = events.find((event) => event.type === 'result');
    expect(result).toBeDefined();
    expect(result?.result.subitems[0]?.excerpt.pre).toContain('lead🙂 ');
    expect(result?.result.subitems[0]?.excerpt.post).toContain(' 🙂trail');
  });

  it('bounds cached section documents', async () => {
    const book = makeBook('sections', 'Sections');
    const file = makeFile('# Chapter\ntext');
    const service = makeService(new Map([['sections', file]]));
    const session = createLibrarySearchSession(service);
    const cached = await session.open(book);
    const createDocuments = Array.from({ length: 257 }, (_, index) =>
      vi.fn(async () => makeDocument(String(index))),
    );
    Object.assign(cached.bookDoc, {
      sections: createDocuments.map((createDocument, index) => ({
        id: String(index),
        createDocument,
      })),
    });

    for (let index = 0; index < createDocuments.length; index++) {
      await session.getSectionDocument(book, index);
    }
    await session.getSectionDocument(book, 0);

    expect(createDocuments[0]).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it('stops worker-backed searches at the result limit', async () => {
    const book = makeBook('limit', 'Limit');
    const file = makeFile('# Chapter\ntext');
    const service = makeService(new Map([['limit', file]]));
    const session = createLibrarySearchSession(service);
    const cached = await session.open(book);
    Object.assign(cached.bookDoc, {
      sections: [{ id: '0', createDocument: async () => makeDocument('a'.repeat(600)) }],
    });
    const events = [];

    for await (const event of searchLibraryBooks(service, [book], 'a', {
      config: { ...config, mode: 'fuzzy' },
      session,
    })) {
      events.push(event);
    }

    const result = events.find((event) => event.type === 'result');
    const completed = events.find((event) => event.type === 'completed');
    expect(result?.result.subitems).toHaveLength(500);
    expect(completed).toMatchObject({ matchCount: 500, truncated: true });
    await session.close();
  });

  it('counts results emitted before a later section error toward the limit', async () => {
    const first = makeBook('partial', 'Partial');
    const second = makeBook('remainder', 'Remainder');
    const service = makeService(
      new Map([
        ['partial', makeFile('# Partial\ntext')],
        ['remainder', makeFile('# Remainder\ntext')],
      ]),
    );
    const session = createLibrarySearchSession(service);
    const [firstCached, secondCached] = await Promise.all([
      session.open(first),
      session.open(second),
    ]);
    Object.assign(firstCached.bookDoc, {
      sections: [
        { id: '0', createDocument: async () => makeDocument('a'.repeat(300)) },
        { id: '1', createDocument: async () => Promise.reject(new Error('broken section')) },
      ],
    });
    Object.assign(secondCached.bookDoc, {
      sections: [{ id: '0', createDocument: async () => makeDocument('a'.repeat(300)) }],
    });
    const events = [];

    for await (const event of searchLibraryBooks(service, [first, second], 'a', {
      config: { ...config, mode: 'fuzzy' },
      session,
    })) {
      events.push(event);
    }

    const emittedMatches = events
      .filter((event) => event.type === 'result')
      .reduce((total, event) => total + event.result.subitems.length, 0);
    expect(emittedMatches).toBe(500);
    expect(events.find((event) => event.type === 'completed')).toMatchObject({
      matchCount: 500,
      truncated: true,
    });
    await session.close();
  });
});
