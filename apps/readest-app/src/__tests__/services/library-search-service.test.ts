import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createLibrarySearchSession,
  resolveSearchResultCfi,
  resolveSearchResultCfis,
  searchLibraryBooks,
} from '@/services/librarySearchService';
import { BOOK_NAV_VERSION, type BookNav } from '@/services/nav';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { BookFileNotFoundError } from '@/services/errors';
import type { Book, BookContent, LibrarySearchConfig } from '@/types/book';
import type { DatabaseService } from '@/types/database';
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

// In-memory per-path turso databases so the per-book search index behaves
// like a persistent search.db across repeated openDatabase calls. close() is
// a no-op wrapper because :memory: databases cannot be reopened.
const makeService = (files: Map<string, File | null>) => {
  const searchDbs = new Map<string, Promise<DatabaseService>>();
  return {
    getBookFileSize: vi.fn(async (book: Book) => files.get(book.hash)?.size ?? null),
    loadBookContent: vi.fn(async (book: Book): Promise<BookContent> => {
      const file = files.get(book.hash);
      if (!file) throw new BookFileNotFoundError();
      return { book, file };
    }),
    resolveNativeBookFilePath: vi.fn().mockResolvedValue(null),
    loadBookNav: vi.fn().mockResolvedValue(null),
    databaseExists: vi.fn(async (path: string) => searchDbs.has(path)),
    deleteDatabase: vi.fn(async (path: string) => {
      searchDbs.delete(path);
    }),
    openDatabase: vi.fn(async (schema: string, path: string): Promise<DatabaseService> => {
      let pending = searchDbs.get(path);
      if (!pending) {
        pending = (async () => {
          const db = await NodeDatabaseService.open(':memory:');
          await migrate(db, getMigrations(schema));
          return db;
        })();
        searchDbs.set(path, pending);
      }
      const db = await pending;
      return {
        execute: db.execute.bind(db),
        select: db.select.bind(db),
        batch: db.batch.bind(db),
        close: async () => {},
      };
    }),
  } as Pick<
    AppService,
    | 'databaseExists'
    | 'deleteDatabase'
    | 'getBookFileSize'
    | 'loadBookContent'
    | 'resolveNativeBookFilePath'
    | 'loadBookNav'
    | 'openDatabase'
  >;
};

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
    expect(
      results.every(({ result }) => {
        const locator = result.subitems[0]!.locator;
        return locator.section === result.index && locator.end - locator.start === 'needle'.length;
      }),
    ).toBe(true);
    expect(results.every(({ result }) => result.subitems[0]!.excerpt.match === 'needle')).toBe(
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
    // Books without a local file are skipped by the size probe before any
    // load attempt, so a cloud-only book never triggers a fetch, and no
    // search.db is created for it.
    expect(service.loadBookContent).not.toHaveBeenCalledWith(unavailable);
    expect(service.openDatabase).not.toHaveBeenCalledWith(
      'library-search',
      'missing/search.db',
      'Books',
    );

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
    expect(fuzzyResult?.result.subitems[0]?.locator.runs).toHaveLength(2);
    expect(
      nearbyResult?.result.subitems[0]?.excerpt.segments?.filter(({ emphasized }) => emphasized),
    ).toHaveLength(2);
    expect(nearbyResult?.result.subitems[0]?.locator.runs).toHaveLength(2);
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

  it('matches across soft hyphens in every mode, live and from the index', async () => {
    const book = makeBook('shy', 'Soft Hyphens');
    const text = 'the hy\u00ADphen\u00ADation of won\u00ADder\u00ADful words';
    const cases: Array<[string, Partial<LibrarySearchConfig>, string]> = [
      ['hyphenation', { mode: 'contains' }, 'hy\u00ADphen\u00ADation'],
      ['Hyphenation', { mode: 'contains', matchCase: true, matchDiacritics: true }, ''],
      [
        'hyphenation',
        { mode: 'contains', matchCase: true, matchDiacritics: true },
        'hy\u00ADphen\u00ADation',
      ],
      ['wonderful', { mode: 'whole-words' }, 'won\u00ADder\u00ADful'],
      ['phena', { mode: 'regex' }, 'phen\u00ADa'],
      ['hyphenation', { mode: 'fuzzy' }, 'hy\u00ADphen\u00ADation'],
      [
        'hyphenation wonderful',
        { mode: 'nearby-words' },
        `hy\u00ADphen\u00ADation of won\u00ADder\u00ADful`,
      ],
    ];

    for (const [query, mode, match] of cases) {
      const service = makeService(new Map([['shy', makeFile(`# Chapter\n${text}`)]]));
      // The first search scans the book live; the second is served from search.db.
      for (const pass of ['live', 'indexed']) {
        const label = `${pass} ${JSON.stringify(mode)} ${query}`;
        const events = [];
        for await (const event of searchLibraryBooks(service, [book], query, {
          config: { ...config, ...mode },
        })) {
          events.push(event);
        }
        const result = events.find((event) => event.type === 'result');
        if (!match) {
          expect(result, label).toBeUndefined();
          continue;
        }
        expect(result, label).toBeDefined();
        const { locator, excerpt } = result!.result.subitems[0]!;
        expect(excerpt.match, label).toBe(match);
        expect(locator.end - locator.start, label).toBe(match.length);
      }
      expect(service.loadBookContent).toHaveBeenCalledOnce();
    }
  });

  it('builds the search_nodes toc tree during index population', async () => {
    const book = makeBook('tree', 'Tree');
    const md = '# One\n\nalpha needle\n\n## One A\n\nbeta\n\n# Two\n\ngamma\n';
    const service = makeService(new Map([['tree', makeFile(md)]]));

    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      void event;
    }

    const db = await service.openDatabase('library-search', 'tree/search.db', 'Books');
    const nodes = await db.select<{
      node_id: number;
      parent_id: number | null;
      ord: number;
      depth: number;
      label: string;
      section_start: number;
      section_end: number;
    }>(
      'SELECT node_id, parent_id, ord, depth, label, section_start, section_end FROM search_nodes ORDER BY node_id',
    );

    expect(nodes.map(({ label }) => label)).toEqual(['One', 'One A', 'Two']);
    expect(nodes.map(({ depth }) => depth)).toEqual([0, 1, 0]);
    expect(nodes.map(({ parent_id }) => parent_id)).toEqual([null, 0, null]);
    expect(nodes.map(({ ord }) => ord)).toEqual([0, 0, 1]);
    const one = nodes[0]!;
    const two = nodes[2]!;
    expect(two.section_start).toBeGreaterThan(one.section_start);
    expect(one.section_end).toBeGreaterThanOrEqual(one.section_start);
    expect(one.section_end).toBeLessThan(two.section_start);
    expect(nodes[1]!.section_start).toBe(one.section_start);
  });

  it('checkpoints the wal into search.db after index population', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'library-search-db-'));
    try {
      const service = makeService(new Map([['walbook', makeFile('# Chapter\nneedle text')]]));
      (service.openDatabase as ReturnType<typeof vi.fn>).mockImplementation(
        async (schema: string, path: string): Promise<DatabaseService> => {
          const fullPath = join(dir, path);
          mkdirSync(dirname(fullPath), { recursive: true });
          const db = await NodeDatabaseService.open(fullPath);
          await migrate(db, getMigrations(schema));
          return db;
        },
      );

      for await (const event of searchLibraryBooks(
        service,
        [makeBook('walbook', 'Wal')],
        'needle',
        {
          config,
        },
      )) {
        void event;
      }

      const dbPath = join(dir, 'walbook/search.db');
      const walPath = `${dbPath}-wal`;
      // The indexed text must live in the main db file, not an uncheckpointed
      // wal that file-level copy or sync of the book directory could miss.
      expect(statSync(dbPath).size).toBeGreaterThan(4096);
      expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds search_nodes from the hydrated book nav and rebuilds when it changes', async () => {
    const book = makeBook('nav', 'Nav');
    const md = '# Raw One\n\nneedle text\n\n# Raw Two\n\nmore text\n';
    const service = makeService(new Map([['nav', makeFile(md)]]));
    const makeNav = (label: string): BookNav => ({
      version: BOOK_NAV_VERSION,
      toc: [{ id: 0, label, href: '0#one', index: 0 }],
      sections: {},
    });
    const loadBookNav = service.loadBookNav as ReturnType<typeof vi.fn>;
    loadBookNav.mockResolvedValue(makeNav('Enriched One'));

    const labels = async () => {
      const db = await service.openDatabase('library-search', 'nav/search.db', 'Books');
      const rows = await db.select<{ label: string }>(
        'SELECT label FROM search_nodes ORDER BY node_id',
      );
      return rows.map(({ label }) => label);
    };
    const search = async () => {
      for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
        void event;
      }
    };

    await search();
    expect(await labels()).toEqual(['Enriched One']);
    expect(service.loadBookContent).toHaveBeenCalledTimes(1);

    // Unchanged nav: repeat search stays on the indexed path.
    await search();
    expect(service.loadBookContent).toHaveBeenCalledTimes(1);

    // Nav changed (manual edit or recomputed enrichment): index is stale,
    // the book is rescanned, and the tree reflects the new nav.
    loadBookNav.mockResolvedValue(makeNav('Renamed One'));
    await search();
    expect(await labels()).toEqual(['Renamed One']);
    expect(service.loadBookContent).toHaveBeenCalledTimes(2);
  });

  it('serves a book without a local file from its existing index', async () => {
    const book = makeBook('cloudy', 'Cloudy');
    const files = new Map<string, File | null>([['cloudy', makeFile('# Chapter\nneedle here')]]);
    const service = makeService(files);

    const first = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      first.push(event);
    }
    expect(first.some(({ type }) => type === 'result')).toBe(true);

    // The file goes away (cloud-only now) but search.db remains.
    files.set('cloudy', null);
    const second = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      second.push(event);
    }
    expect(second.find((event) => event.type === 'result')?.result).toEqual(
      first.find((event) => event.type === 'result')?.result,
    );
    expect(second.some(({ type }) => type === 'book-skipped')).toBe(false);
    expect(service.loadBookContent).toHaveBeenCalledTimes(1);
  });

  it('serves repeat searches from the per-book index without reopening books', async () => {
    const book = makeBook('indexed', 'Indexed');
    const service = makeService(
      new Map([['indexed', makeFile('# Chapter\na needle in cached text')]]),
    );
    const firstEvents = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      firstEvents.push(event);
    }
    const secondEvents = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      secondEvents.push(event);
    }

    const firstResult = firstEvents.find((event) => event.type === 'result');
    const secondResult = secondEvents.find((event) => event.type === 'result');
    expect(firstResult).toBeDefined();
    expect(secondResult?.result).toEqual(firstResult?.result);
    expect(secondEvents.at(-1)).toMatchObject({ type: 'completed', matchCount: 1 });
    // The second search is answered entirely from search.db.
    expect(service.loadBookContent).toHaveBeenCalledOnce();
  });

  it('keeps serving the index after reading bumps the book updatedAt', async () => {
    const book = makeBook('reading', 'Reading');
    const service = makeService(new Map([['reading', makeFile('# Chapter\na needle here')]]));
    for await (const _ of searchLibraryBooks(service, [book], 'needle', { config })) {
    }
    // A page turn or progress save restamps the row; the file is unchanged.
    const turned = { ...book, updatedAt: book.updatedAt + 1000 };
    const events = [];
    for await (const event of searchLibraryBooks(service, [turned], 'needle', { config })) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ type: 'completed', matchCount: 1 });
    expect(service.loadBookContent).toHaveBeenCalledOnce();
  });

  // A book imported in place is read from the user's own file, which can be
  // edited (say, in Calibre) without the book getting a new hash.
  it('rebuilds the index when the book file was edited in place', async () => {
    const book = makeBook('in-place', 'In Place');
    const files = new Map([['in-place', makeFile('# Chapter\na needle here')]]);
    const service = makeService(files);
    for await (const _ of searchLibraryBooks(service, [book], 'needle', { config })) {
    }
    files.set('in-place', makeFile('# Chapter\na needle here, and an edited needle'));
    const events = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ type: 'completed', matchCount: 2 });
    expect(service.loadBookContent).toHaveBeenCalledTimes(2);
  });

  // The session's open document still reads the file as it was before the edit.
  it('rebuilds from the edited file when it changes during a session', async () => {
    const book = makeBook('in-place-session', 'In Place');
    const files = new Map([['in-place-session', makeFile('# Chapter\na needle here')]]);
    const service = makeService(files);
    const session = createLibrarySearchSession(service);
    const search = async (options: { session?: typeof session }) => {
      const events = [];
      for await (const event of searchLibraryBooks(service, [book], 'needle', {
        config,
        ...options,
      })) {
        events.push(event);
      }
      return events.at(-1);
    };

    await search({ session });
    files.set('in-place-session', makeFile('# Chapter\na needle here, and an edited needle'));
    expect(await search({ session })).toMatchObject({ type: 'completed', matchCount: 2 });
    // A later session is served from the index the rebuild wrote.
    const loads = vi.mocked(service.loadBookContent).mock.calls.length;
    expect(await search({})).toMatchObject({ type: 'completed', matchCount: 2 });
    expect(service.loadBookContent).toHaveBeenCalledTimes(loads);
    await session.close();
  });

  // Here the file changes back after the search measured it, so the document
  // the session reopens still holds the old text.
  it('stores the size of the file whose text it indexed', async () => {
    const book = makeBook('in-place-race', 'In Place');
    const files = new Map([['in-place-race', makeFile('# Chapter\na needle here')]]);
    const service = makeService(files);
    const session = createLibrarySearchSession(service);
    const search = async (options: { session?: typeof session }) => {
      const events = [];
      for await (const event of searchLibraryBooks(service, [book], 'needle', {
        config,
        ...options,
      })) {
        events.push(event);
      }
      return events.at(-1);
    };

    await search({ session });
    const edited = makeFile('# Chapter\na needle here, and an edited needle');
    vi.mocked(service.getBookFileSize).mockResolvedValueOnce(edited.size);
    await search({ session });
    await session.close();

    files.set('in-place-race', edited);
    expect(await search({})).toMatchObject({ type: 'completed', matchCount: 2 });
  });

  // On web, measuring a book reads the whole file, and in-book search resolves
  // every chapter's results through the session.
  it('resolves results without reading the book file again', async () => {
    const book = makeBook('resolving', 'Resolving');
    const service = makeService(new Map([['resolving', makeFile('# Chapter\na needle here')]]));
    const session = createLibrarySearchSession(service);
    const locators = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config, session })) {
      if (event.type === 'result') locators.push(...event.result.subitems.map((m) => m.locator));
    }
    const measured = vi.mocked(service.getBookFileSize).mock.calls.length;

    for (let i = 0; i < 3; i++) await resolveSearchResultCfis(session, book, locators);

    expect(locators).not.toHaveLength(0);
    expect(service.getBookFileSize).toHaveBeenCalledTimes(measured);
    expect(service.loadBookContent).toHaveBeenCalledOnce();
    await session.close();
  });

  describe('a book edited in place while a session holds it open', () => {
    const v1 = '# Chapter\na needle here';
    const v2 = '# Chapter\na needle here, and an edited needle';
    const setup = () => {
      const book = makeBook('held', 'Held');
      const files = new Map([['held', makeFile(v1)]]);
      const service = makeService(files);
      const session = createLibrarySearchSession(service);
      const search = async (options: { session?: typeof session } = {}) => {
        const events = [];
        for await (const event of searchLibraryBooks(service, [book], 'needle', {
          config,
          ...options,
        })) {
          events.push(event);
        }
        return events;
      };
      return { book, files, service, session, search };
    };

    it('is reopened once when two searches find it stale together', async () => {
      const { files, service, session, search } = setup();
      await search({ session });
      files.set('held', makeFile(v2));
      // Both searches get the session's document before either goes on.
      const open = session.open;
      let arrived = 0;
      let bothArrived!: () => void;
      const together = new Promise<void>((resolve) => {
        bothArrived = resolve;
      });
      vi.spyOn(session, 'open').mockImplementation(async (book) => {
        const pending = open(book);
        if (++arrived === 2) bothArrived();
        if (arrived <= 2) await together;
        return pending;
      });

      const [first, second] = await Promise.all([search({ session }), search({ session })]);

      expect(first.at(-1)).toMatchObject({ type: 'completed', matchCount: 2 });
      expect(second.at(-1)).toMatchObject({ type: 'completed', matchCount: 2 });
      expect(service.loadBookContent).toHaveBeenCalledTimes(2);
      await session.close();
    });

    // Another session rebuilt the index from the edited file, so this one
    // takes the indexed path and never opens the book itself.
    it('resolves results from a fresh index against the edited file', async () => {
      const { book, files, service, session, search } = setup();
      await search({ session });
      files.set('held', makeFile(v2));
      await search();

      const locators = (await search({ session }))
        .flatMap((event) => (event.type === 'result' ? event.result.subitems : []))
        .map((match) => match.locator);
      const fresh = createLibrarySearchSession(service);

      expect(locators).toHaveLength(2);
      expect(await resolveSearchResultCfis(session, book, locators)).toEqual(
        await resolveSearchResultCfis(fresh, book, locators),
      );
      await Promise.all([session.close(), fresh.close()]);
    });

    it("doesn't leave a failed close unhandled when it is dropped", async () => {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on('unhandledRejection', onRejection);
      try {
        const { book, files, session, search } = setup();
        const held = files.get('held') as File & { close: ReturnType<typeof vi.fn> };
        await session.open(book);
        held.close.mockRejectedValue(new Error('close failed'));
        files.set('held', makeFile(v2));

        expect((await search({ session })).at(-1)).toMatchObject({ matchCount: 2 });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(held.close).toHaveBeenCalledOnce();
        expect(rejections).toEqual([]);
        await session.close();
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });

    it('keeps a document another open replaced it with while it was checked', async () => {
      const { book, files, service, session } = setup();
      let finishLoad!: (content: BookContent) => void;
      vi.mocked(service.loadBookContent).mockReturnValueOnce(
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
      );
      void session.open(book);
      const checking = session.refresh(book, makeFile(v2).size);
      files.set('held', makeFile(v2));
      const reopened = { ...book, updatedAt: book.updatedAt + 1 };
      const replacement = await session.open(reopened);

      finishLoad({ book, file: makeFile(v1) });
      await checking;

      expect(await session.open(reopened)).toBe(replacement);
      expect(service.loadBookContent).toHaveBeenCalledTimes(2);
      await session.close();
    });

    // open() replaces a document cached for an older updatedAt anyway.
    it("doesn't wait for a document cached for an older updatedAt", async () => {
      const { book, service, session } = setup();
      vi.mocked(service.loadBookContent).mockReturnValueOnce(new Promise(() => {}));
      void session.open(book);
      const reopened = { ...book, updatedAt: book.updatedAt + 1 };

      const checked = await Promise.race([
        session.refresh(reopened, makeFile(v2).size).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 50)),
      ]);

      expect(checked).toBe(true);
    });
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

  it('searches without a cap when maxResultsPerBook is unlimited', async () => {
    const book = makeBook('uncapped', 'Uncapped');
    const file = makeFile('# Chapter\ntext');
    const service = makeService(new Map([['uncapped', file]]));
    const session = createLibrarySearchSession(service);
    const cached = await session.open(book);
    Object.assign(cached.bookDoc, {
      sections: [{ id: '0', createDocument: async () => makeDocument('a'.repeat(600)) }],
    });
    const events = [];

    for await (const event of searchLibraryBooks(service, [book], 'a', {
      config: { ...config, mode: 'fuzzy' },
      session,
      maxResultsPerBook: Infinity,
    })) {
      events.push(event);
    }

    const result = events.find((event) => event.type === 'result');
    const completed = events.find((event) => event.type === 'completed');
    expect(result?.result.subitems).toHaveLength(600);
    expect(completed).toMatchObject({ matchCount: 600, truncated: false });
    await session.close();
  });

  it('caps each book independently and continues to later books', async () => {
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
      sections: [{ id: '0', createDocument: async () => makeDocument('a'.repeat(600)) }],
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
    // Book one errors after 300 matches; book two still gets its own
    // 500-match budget and reports itself truncated.
    expect(emittedMatches).toBe(800);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'book-completed', book: second, truncated: true }),
    );
    expect(events.find((event) => event.type === 'completed')).toMatchObject({
      matchCount: 800,
      truncated: true,
    });
    await session.close();
  });

  it('scopes matching to a single section while indexing the whole book', async () => {
    const book = makeBook('scoped', 'Scoped Book');
    const files = new Map<string, File | null>([
      ['scoped', makeFile('# One\nneedle first\n\n# Two\nneedle second')],
    ]);
    const service = makeService(files);

    // Live path: only the requested section is matched, but every section is
    // still written to the index.
    const scoped = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', {
      config,
      sectionIndex: 1,
    })) {
      scoped.push(event);
    }
    const scopedResults = scoped.filter((event) => event.type === 'result');
    expect(scopedResults.map((event) => event.result.index)).toEqual([1]);
    expect(scoped.at(-1)).toMatchObject({ type: 'completed', matchCount: 1 });

    // The file disappears; the index built during the scoped scan still
    // serves matches from both sections.
    files.set('scoped', null);
    const all = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config })) {
      all.push(event);
    }
    expect(
      all.filter((event) => event.type === 'result').map((event) => event.result.index),
    ).toEqual([0, 1]);

    // Indexed path honors the filter too.
    const indexedScoped = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', {
      config,
      sectionIndex: 0,
    })) {
      indexedScoped.push(event);
    }
    expect(
      indexedScoped.filter((event) => event.type === 'result').map((event) => event.result.index),
    ).toEqual([0]);
  });

  it('resolves locator batches to CFIs matching the single resolver', async () => {
    const book = makeBook('cfis', 'Cfi Book');
    const service = makeService(
      new Map<string, File | null>([
        ['cfis', makeFile('# One\nneedle first here\n\n# Two\nneedle second here')],
      ]),
    );
    const session = createLibrarySearchSession(service);
    const locators = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle', { config, session })) {
      if (event.type === 'result') locators.push(...event.result.subitems.map((m) => m.locator));
    }
    expect(locators).toHaveLength(2);

    const resolved = await resolveSearchResultCfis(session, book, locators);
    expect(resolved).toHaveLength(2);
    for (const [i, entry] of resolved.entries()) {
      expect(entry?.cfi).toBeTruthy();
      expect(entry?.cfi).toBe(await resolveSearchResultCfi(session, book, locators[i]!));
    }

    // nearby-words locators carry per-word runs that resolve to one CFI each.
    const nearby = [];
    for await (const event of searchLibraryBooks(service, [book], 'needle here', {
      config: { ...config, mode: 'nearby-words', nearbyWords: 5 },
      session,
    })) {
      if (event.type === 'result') nearby.push(...event.result.subitems.map((m) => m.locator));
    }
    expect(nearby.length).toBeGreaterThan(0);
    const nearbyResolved = await resolveSearchResultCfis(session, book, nearby);
    expect(nearbyResolved[0]?.cfis?.length).toBe(2);
    await session.close();
  });
});
