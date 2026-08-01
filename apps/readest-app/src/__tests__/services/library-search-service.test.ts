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
