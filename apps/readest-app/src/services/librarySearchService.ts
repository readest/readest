import { DocumentLoader, type BookDoc } from '@/libs/document';
import type {
  Book,
  LibrarySearchConfig,
  LibrarySearchMatch,
  LibrarySearchSectionResult,
  SearchExcerpt,
  SearchResultLocator,
} from '@/types/book';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { findContainsMatches } from '@/utils/containsSearch';
import { findFuzzyMatches, MAX_FUZZY_QUERY_LENGTH } from '@/utils/fuzzySearch';
import type { LibrarySearchWorkerMatch } from '@/utils/librarySearchWorkerProtocol';
import { findNearbyMatches } from '@/utils/nearbySearch';
import { createRejectFilter } from '@/utils/node';
import { compileSearchRegex, filterWholeWordMatches, findRegexMatches } from '@/utils/textSearch';
import { BookFileNotFoundError } from './errors';
import {
  beginSearchIndex,
  buildSearchIndexNodes,
  checkpointSearchIndex,
  completeSearchIndex,
  hashSearchToc,
  isSearchIndexFresh,
  loadSearchIndexCandidates,
  loadSearchIndexSections,
  openLibrarySearchDb,
  readSearchIndexMeta,
  writeSearchIndexNodes,
  writeSearchIndexSection,
  type SearchIndexSection,
} from './librarySearchIndex';
import { hydrateBookNav, isBookNavCacheCurrent, type BookNav } from './nav';
import { createLibrarySearchWorker } from './librarySearchWorker';
import * as CFI from 'foliate-js/epubcfi.js';
import { TOCProgress } from 'foliate-js/progress.js';

type LibrarySearchAppService = Pick<
  AppService,
  | 'databaseExists'
  | 'deleteDatabase'
  | 'getBookFileSize'
  | 'loadBookContent'
  | 'resolveNativeBookFilePath'
  | 'loadBookNav'
  | 'openDatabase'
>;

// The nav the reader shows (nav.json enrichment applied via hydrateBookNav),
// or null when no current cached nav exists for the book.
const loadCurrentNav = async (
  appService: LibrarySearchAppService,
  book: Book,
): Promise<BookNav | null> => {
  try {
    const nav = await appService.loadBookNav(book);
    return isBookNavCacheCurrent(nav) ? nav : null;
  } catch {
    return null;
  }
};

type SearchableBookDoc = BookDoc & {
  destroy?: () => void | Promise<void>;
  getTOCFragment?: (doc: Document, fragment: string) => Element | null;
};

export type LibrarySearchEvent =
  | { type: 'book-started'; book: Book; bookIndex: number; totalBooks: number }
  | {
      type: 'progress';
      book: Book;
      bookProgress: number;
      progress: number;
      sectionsCompleted: number;
      totalSections: number;
    }
  | { type: 'result'; book: Book; result: LibrarySearchSectionResult }
  | { type: 'book-completed'; book: Book; matchCount: number; truncated?: boolean }
  | { type: 'book-skipped'; book: Book; reason: 'unavailable' }
  | { type: 'book-error'; book: Book; error: string; code?: string }
  | {
      type: 'completed';
      searchedBooks: number;
      skippedBooks: number;
      erroredBooks: number;
      matchCount: number;
      truncated?: boolean;
    };

export interface LibrarySearchOptions {
  config?: Partial<LibrarySearchConfig>;
  signal?: AbortSignal;
  session?: LibrarySearchSession;
  // Restrict matching to one section (reader "current chapter" scope). Index
  // population is never restricted: a live scan still writes every section.
  sectionIndex?: number;
}

const DEFAULT_CONFIG: LibrarySearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
};

const CONTEXT_LENGTH = 50;
const CONTEXT_SCAN_CHUNK = 2048;
const MAX_BOOK_SEARCH_RESULTS = 500;
const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ');

const contextStart = (value: string) => {
  let end = Math.min(CONTEXT_LENGTH, value.length);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return value.slice(0, end);
};

const contextEnd = (value: string) => {
  let start = Math.max(0, value.length - CONTEXT_LENGTH);
  const first = value.charCodeAt(start);
  const previous = value.charCodeAt(start - 1);
  if (first >= 0xdc00 && first <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) start++;
  return value.slice(start);
};

const makeContext = (text: string, offset: number, direction: 'before' | 'after') => {
  if (direction === 'before') {
    let cursor = offset;
    let normalized = '';
    while (cursor > 0 && normalized.trimStart().length < CONTEXT_LENGTH) {
      let start = Math.max(0, cursor - CONTEXT_SCAN_CHUNK);
      const first = text.charCodeAt(start);
      const previous = text.charCodeAt(start - 1);
      if (
        start > 0 &&
        first >= 0xdc00 &&
        first <= 0xdfff &&
        previous >= 0xd800 &&
        previous <= 0xdbff
      ) {
        start--;
      }
      normalized = normalizeWhitespace(text.slice(start, cursor) + normalized);
      cursor = start;
    }
    const value = normalized.trimStart();
    return `${cursor > 0 || value.length >= CONTEXT_LENGTH ? '…' : ''}${contextEnd(value)}`;
  }
  let cursor = offset;
  let normalized = '';
  while (cursor < text.length && normalized.trimEnd().length < CONTEXT_LENGTH) {
    let end = Math.min(text.length, cursor + CONTEXT_SCAN_CHUNK);
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      end++;
    }
    normalized = normalizeWhitespace(normalized + text.slice(cursor, end));
    cursor = end;
  }
  const value = normalized.trimEnd();
  return `${contextStart(value)}${cursor < text.length || value.length >= CONTEXT_LENGTH ? '…' : ''}`;
};

const findNodeOffset = (cumulative: number[], offset: number, bias: 'left' | 'right') => {
  let low = 0;
  let high = cumulative.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cumulative[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  if (bias === 'left') {
    while (low > 0 && cumulative[low] === offset) low--;
  }
  return { index: low, offset: offset - cumulative[low]! };
};

const makeExcerpt = (text: string, start: number, end: number): SearchExcerpt => {
  return {
    pre: makeContext(text, start, 'before'),
    match: text.slice(start, end),
    post: makeContext(text, end, 'after'),
  };
};

const makeFuzzyExcerpt = (
  text: string,
  start: number,
  end: number,
  runs: Array<{ start: number; end: number }>,
): SearchExcerpt => {
  const segments: NonNullable<SearchExcerpt['segments']> = [];
  let cursor = start;
  for (const run of runs) {
    if (run.start > cursor) {
      segments.push({ text: text.slice(cursor, run.start), emphasized: false });
    }
    segments.push({ text: text.slice(run.start, run.end), emphasized: true });
    cursor = run.end;
  }
  return {
    pre: makeContext(text, start, 'before'),
    match: text.slice(start, end),
    post: makeContext(text, end, 'after'),
    segments,
  };
};

// foliate's text-walker reads NodeFilter at module scope, which only exists
// in browsers; the reader and library pages import this service statically,
// so Next.js would evaluate that global while collecting page data on the
// server. Load the walker lazily instead — every caller of
// prepareSearchSection awaits loadTextWalker() first.
type TextWalker = typeof import('foliate-js/text-walker.js')['textWalker'];
let textWalker: TextWalker | null = null;
const loadTextWalker = async (): Promise<TextWalker> =>
  (textWalker ??= (await import('foliate-js/text-walker.js')).textWalker);

interface PreparedSearchSection {
  key: string;
  text: string;
  cumulative: number[];
  makeRange: (...args: number[]) => Range;
}

const prepareSearchSection = (
  key: string,
  doc: Document,
  acceptNode: (node: Node) => number,
): PreparedSearchSection => {
  let prepared: PreparedSearchSection | null = null;
  if (!textWalker) throw new Error('text walker not loaded');
  Array.from(
    textWalker(
      doc,
      (strings: string[], makeRange: (...args: number[]) => Range) => {
        const text = strings.join('');
        const cumulative = [0];
        for (const value of strings) cumulative.push(cumulative.at(-1)! + value.length);
        prepared = { key, text, cumulative, makeRange };
        return [];
      },
      acceptNode,
    ),
  );
  if (!prepared) throw new Error('Unable to prepare book section for search');
  return prepared;
};

const createTOCProgress = async (book: SearchableBookDoc) => {
  if (!book.splitTOCHref || !book.getTOCFragment) return null;
  const progress = new TOCProgress();
  await progress.init({
    toc: book.toc ?? [],
    ids: book.sections.map(({ id }) => id),
    splitHref: book.splitTOCHref.bind(book),
    getFragment: book.getTOCFragment.bind(book),
  });
  return progress;
};

const closeBook = async (book: SearchableBookDoc | null, file: File | null) => {
  try {
    await book?.destroy?.();
  } finally {
    const closableFile = file as ClosableFile | null;
    if (closableFile?.close) await closableFile.close();
  }
};

const makeAcceptNode = (book: Book) =>
  createRejectFilter({
    tags: book.primaryLanguage?.startsWith('ja') ? ['rt'] : [],
    attributes: ['cfi-inert'],
  });

interface CachedSearchBook {
  file: File;
  bookDoc: SearchableBookDoc;
}

const MAX_CACHED_BOOKS = 10;
const MAX_OPEN_INDEX_DBS = 16;

export const createLibrarySearchSession = (appService: LibrarySearchAppService) => {
  const documents = new Map<string, { updatedAt: number; pending: Promise<CachedSearchBook> }>();
  // One handle per search.db within the session: OPFS permits a single access
  // handle per file per origin, so concurrent opens of the same DB would throw.
  const indexDbs = new Map<string, Promise<DatabaseService | null>>();
  // Memoized per session: the hash of each book's current cached nav toc
  // (null when no current nav exists), used to detect stale node trees
  // without re-reading nav.json on every query.
  const navHashes = new Map<string, Promise<string | null>>();
  const searchWorker = createLibrarySearchWorker();

  const dispose = ({ pending }: { pending: Promise<CachedSearchBook> }) => {
    void pending.then(
      ({ bookDoc, file }) => closeBook(bookDoc, file),
      () => {},
    );
  };

  const open = (book: Book) => {
    const existing = documents.get(book.hash);
    if (existing?.updatedAt === book.updatedAt) {
      documents.delete(book.hash);
      documents.set(book.hash, existing);
      return existing.pending;
    }
    if (existing) dispose(existing);

    const pending = (async () => {
      const [content, nativeFilePath] = await Promise.all([
        appService.loadBookContent(book),
        appService.resolveNativeBookFilePath(book),
      ]);
      try {
        const bookDoc = (
          await new DocumentLoader(content.file, {
            nativeFilePath: nativeFilePath ?? undefined,
          }).open()
        ).book as SearchableBookDoc;
        return { file: content.file, bookDoc };
      } catch (error) {
        await closeBook(null, content.file);
        throw error;
      }
    })();
    const entry = { updatedAt: book.updatedAt, pending };
    documents.set(book.hash, entry);
    void pending.catch(() => {
      if (documents.get(book.hash) === entry) documents.delete(book.hash);
    });

    if (documents.size > MAX_CACHED_BOOKS) {
      const oldestHash = documents.keys().next().value!;
      const oldest = documents.get(oldestHash)!;
      documents.delete(oldestHash);
      dispose(oldest);
    }
    return pending;
  };

  const getIndexDb = (book: Book): Promise<DatabaseService | null> => {
    const existing = indexDbs.get(book.hash);
    if (existing) {
      indexDbs.delete(book.hash);
      indexDbs.set(book.hash, existing);
      return existing;
    }
    const pending = openLibrarySearchDb(appService, book).catch(() => null);
    indexDbs.set(book.hash, pending);
    while (indexDbs.size > MAX_OPEN_INDEX_DBS) {
      const oldestHash = indexDbs.keys().next().value!;
      const oldest = indexDbs.get(oldestHash)!;
      indexDbs.delete(oldestHash);
      void oldest.then((db) => db?.close()).catch(() => {});
    }
    return pending;
  };

  const getNavHash = (book: Book): Promise<string | null> => {
    const existing = navHashes.get(book.hash);
    if (existing) return existing;
    const pending = loadCurrentNav(appService, book).then((nav) =>
      nav ? hashSearchToc(nav.toc) : null,
    );
    navHashes.set(book.hash, pending);
    return pending;
  };

  const dropIndexDb = (book: Book) => {
    const pending = indexDbs.get(book.hash);
    if (!pending) return;
    indexDbs.delete(book.hash);
    void pending.then((db) => db?.close()).catch(() => {});
  };

  return {
    open,
    getIndexDb,
    dropIndexDb,
    getNavHash,
    searchWorker,
    async close() {
      const cachedBooks = [...documents.values()];
      const cachedDbs = [...indexDbs.values()];
      documents.clear();
      indexDbs.clear();
      searchWorker.close();
      await Promise.all([
        ...cachedBooks.map(({ pending }) =>
          pending.then(
            ({ bookDoc, file }) => closeBook(bookDoc, file),
            () => {},
          ),
        ),
        // Checkpoint before close so aborted or failed builds don't leave
        // their writes stranded in the wal (completeSearchIndex handles the
        // successful-build case).
        ...cachedDbs.map((pending) =>
          pending
            .then(async (db) => {
              if (!db) return;
              await checkpointSearchIndex(db);
              await db.close();
            })
            .catch(() => {}),
        ),
      ]);
    },
  };
};

export type LibrarySearchSession = ReturnType<typeof createLibrarySearchSession>;

interface SectionMatchOutcome {
  matches: LibrarySearchWorkerMatch[];
  truncated: boolean;
}

const toSubitems = (
  mode: LibrarySearchConfig['mode'],
  sectionIndex: number,
  text: string,
  matches: LibrarySearchWorkerMatch[],
): LibrarySearchMatch[] =>
  matches.map((match) => {
    const locator: SearchResultLocator = {
      section: sectionIndex,
      start: match.start,
      end: match.end,
      ...(match.runs.length ? { runs: match.runs } : {}),
    };
    if (!match.runs.length) {
      return { locator, excerpt: makeExcerpt(text, match.start, match.end) };
    }
    const excerpt = makeFuzzyExcerpt(text, match.start, match.end, match.runs);
    if (mode === 'nearby-words' && excerpt.segments) {
      excerpt.match = normalizeWhitespace(excerpt.match);
      excerpt.segments = excerpt.segments
        .map((segment) => ({ ...segment, text: normalizeWhitespace(segment.text) }))
        .filter(({ text: segmentText }) => segmentText.length > 0);
    }
    return { locator, excerpt };
  });

export async function* searchLibraryBooks(
  appService: LibrarySearchAppService,
  books: Book[],
  query: string,
  options: LibrarySearchOptions = {},
): AsyncGenerator<LibrarySearchEvent> {
  const config: LibrarySearchConfig = { ...DEFAULT_CONFIG, ...options.config, scope: 'book' };
  const { signal } = options;
  let searchedBooks = 0;
  let skippedBooks = 0;
  let erroredBooks = 0;
  let totalMatches = 0;
  let truncated = false;
  let sliceStarted = performance.now();

  if (books.length === 0) {
    yield {
      type: 'completed',
      searchedBooks: 0,
      skippedBooks: 0,
      erroredBooks: 0,
      matchCount: 0,
    };
    return;
  }

  if (config.mode === 'nearby-words' && query.trim().split(/\s+/).filter(Boolean).length < 2) {
    yield {
      type: 'book-error',
      book: books[0]!,
      error: 'Nearby words search needs at least two words',
      code: 'NEARBY_NEEDS_TWO_WORDS',
    };
    return;
  }
  if (
    config.mode === 'fuzzy' &&
    Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(query.trim()))
      .length > MAX_FUZZY_QUERY_LENGTH
  ) {
    yield {
      type: 'book-error',
      book: books[0]!,
      error: `Fuzzy search query cannot exceed ${MAX_FUZZY_QUERY_LENGTH} characters`,
      code: 'FUZZY_QUERY_TOO_LONG',
    };
    return;
  }
  let searchRegex: RegExp | null = null;
  if (config.mode === 'regex') {
    try {
      searchRegex = compileSearchRegex(query, config.matchCase);
    } catch (error) {
      yield {
        type: 'book-error',
        book: books[0]!,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_REGEX',
      };
      return;
    }
  }

  const usesSearchWorker = config.mode === 'fuzzy' || config.mode === 'nearby-words';

  const matchSectionText = async (
    book: Book,
    sectionIndex: number,
    text: string,
    locale: string,
    limit: number,
  ): Promise<SectionMatchOutcome> => {
    if (usesSearchWorker) {
      const payload = {
        sectionKey: `${book.hash}:${book.updatedAt}:${sectionIndex}`,
        text,
        query,
        mode: config.mode as 'fuzzy' | 'nearby-words',
        fuzzyOptions: {
          matchCase: config.matchCase,
          matchDiacritics: config.matchDiacritics,
        },
        nearbyOptions: {
          locale,
          matchCase: config.matchCase,
          matchDiacritics: config.matchDiacritics,
          nearbyWords: config.nearbyWords ?? DEFAULT_CONFIG.nearbyWords!,
        },
        limit,
      };
      if (options.session) {
        return await options.session.searchWorker.search(payload, signal);
      }
      const state: { truncated?: boolean } = {};
      const matches =
        config.mode === 'fuzzy'
          ? findFuzzyMatches(text, query, payload.fuzzyOptions, limit, state)
          : findNearbyMatches(text, query, payload.nearbyOptions, undefined, limit, state);
      return { matches, truncated: Boolean(state.truncated) };
    }

    let spans: Array<{ start: number; end: number }>;
    if (config.mode === 'regex') {
      spans = findRegexMatches(text, searchRegex!, limit);
    } else {
      spans = [];
      for (const match of findContainsMatches(text, query, config, locale)) {
        spans.push(match);
        // Whole-words filters after collection, so don't stop at the raw cap.
        if (config.mode !== 'whole-words' && spans.length >= limit) break;
      }
      if (config.mode === 'whole-words') {
        spans = filterWholeWordMatches(text, spans, locale).slice(0, limit);
      }
    }
    return {
      matches: spans.map(({ start, end }) => ({ start, end, runs: [] })),
      truncated: spans.length >= limit,
    };
  };

  const yieldSlice = async () => {
    if (performance.now() - sliceStarted >= 8) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStarted = performance.now();
    }
  };

  for (const [bookIndex, book] of books.entries()) {
    if (signal?.aborted) return;
    let file: File | null = null;
    let bookDoc: SearchableBookDoc | null = null;
    let indexDb: DatabaseService | null = null;
    const ownsIndexDb = !options.session;
    try {
      yield { type: 'book-started', book, bookIndex, totalBooks: books.length };
      const locale = book.primaryLanguage || 'en';

      // Opening (and thereby creating) a search.db is not free, so probe
      // cheaply first: a book with neither a local file nor an existing index
      // is skipped without touching the database layer at all.
      const localSize = await appService.getBookFileSize(book).catch(() => null);
      if (localSize == null) {
        const hasIndex = await appService
          .databaseExists(`${book.hash}/search.db`, 'Books')
          .catch(() => false);
        if (!hasIndex) {
          skippedBooks++;
          yield { type: 'book-skipped', book, reason: 'unavailable' };
          continue;
        }
      }

      indexDb = options.session
        ? await options.session.getIndexDb(book)
        : await openLibrarySearchDb(appService, book).catch(() => null);
      const meta = indexDb ? await readSearchIndexMeta(indexDb).catch(() => null) : null;

      // Node trees follow the nav the reader shows (hydrateBookNav), which
      // can change without touching the book file — manual TOC edits or
      // recomputed nav.json enrichment. A nav hash mismatch invalidates the
      // index like a book update does; with no current nav the TOC can only
      // change with the file, so the stored tree stands.
      const currentNavHash = options.session
        ? await options.session.getNavHash(book)
        : await loadCurrentNav(appService, book).then((nav) =>
            nav ? hashSearchToc(nav.toc) : null,
          );
      const nodesFresh = currentNavHash == null || currentNavHash === meta?.navHash;

      let bookMatches = 0;
      let bookTruncated = false;

      if (indexDb && isSearchIndexFresh(meta, book) && nodesFresh) {
        // Indexed path: search cached text; the book file is never opened.
        const usePrefilter = config.mode === 'contains' || config.mode === 'whole-words';
        let sections: SearchIndexSection[] = usePrefilter
          ? await loadSearchIndexCandidates(indexDb, query)
          : await loadSearchIndexSections(indexDb);
        if (options.sectionIndex != null) {
          sections = sections.filter((section) => section.idx === options.sectionIndex);
        }
        if (signal?.aborted) return;
        const totalSections = meta!.totalSections;
        for (const section of sections) {
          if (signal?.aborted) return;
          const remaining = MAX_BOOK_SEARCH_RESULTS - bookMatches;
          if (remaining <= 0) {
            bookTruncated = true;
            break;
          }
          const outcome = await matchSectionText(
            book,
            section.idx,
            section.text,
            locale,
            remaining,
          );
          if (signal?.aborted) return;
          if (outcome.truncated) bookTruncated = true;
          if (outcome.matches.length) {
            const subitems = toSubitems(config.mode, section.idx, section.text, outcome.matches);
            bookMatches += subitems.length;
            totalMatches += subitems.length;
            yield {
              type: 'result',
              book,
              result: { index: section.idx, label: section.label, subitems },
            };
          }
          if (bookTruncated) break;
          await yieldSlice();
        }
        yield {
          type: 'progress',
          book,
          bookProgress: 1,
          progress: (bookIndex + 1) / books.length,
          sectionsCompleted: totalSections,
          totalSections,
        };
      } else if (localSize == null) {
        // A stale or incomplete index and no local file to rescan from: the
        // db is a useless artifact that would cost a full database open on
        // every future search, so delete it and skip.
        if (indexDb) {
          if (options.session) options.session.dropIndexDb(book);
          else {
            await indexDb.close().catch(() => {});
            indexDb = null;
          }
          await appService.deleteDatabase(`${book.hash}/search.db`, 'Books').catch(() => {});
        }
        skippedBooks++;
        yield { type: 'book-skipped', book, reason: 'unavailable' };
        continue;
      } else {
        // Live path: extract text section by section, persist it to the
        // per-book index, and match the same extracted text.
        if (options.session) {
          const cached = await options.session.open(book);
          file = cached.file;
          bookDoc = cached.bookDoc;
        } else {
          const [content, nativeFilePath] = await Promise.all([
            appService.loadBookContent(book),
            appService.resolveNativeBookFilePath(book),
          ]);
          file = content.file;
          bookDoc = (
            await new DocumentLoader(file, { nativeFilePath: nativeFilePath ?? undefined }).open()
          ).book as SearchableBookDoc;
        }
        if (signal?.aborted) return;

        const nav = await loadCurrentNav(appService, book);
        if (nav) {
          try {
            hydrateBookNav(bookDoc, nav);
          } catch {
            // Keep the raw toc when hydration fails.
          }
        }
        const usedNavHash = nav ? hashSearchToc(nav.toc) : '';
        await loadTextWalker();
        const acceptNode = makeAcceptNode(book);
        const tocProgress = await createTOCProgress(bookDoc);
        const totalSections = bookDoc.sections.length;
        if (indexDb) {
          await beginSearchIndex(indexDb, book, totalSections, usedNavHash).catch(() => {
            indexDb = null;
          });
        }
        let indexComplete = true;
        if (indexDb) {
          const doc = bookDoc;
          const idToIndex = new Map(
            doc.sections.map((section, index) => [String(section.id), index]),
          );
          const resolveSection = (href: string) => {
            const id = doc.splitTOCHref?.(href)?.[0];
            return id == null ? undefined : idToIndex.get(String(id));
          };
          const nodes = buildSearchIndexNodes(doc.toc, resolveSection, totalSections);
          await writeSearchIndexNodes(indexDb, nodes).catch(() => {
            indexComplete = false;
          });
        }

        for (const [sectionIndex, section] of bookDoc.sections.entries()) {
          if (signal?.aborted) return;
          if (typeof section.createDocument === 'function') {
            const doc = await section.createDocument();
            if (signal?.aborted) return;
            if (doc) {
              const prepared = prepareSearchSection(
                `${book.hash}:${book.updatedAt}:${sectionIndex}`,
                doc,
                acceptNode,
              );
              const sectionLocale = doc.body?.lang || doc.documentElement?.lang || locale;
              const label = tocProgress?.getProgress(sectionIndex, null)?.label ?? '';
              if (indexDb) {
                await writeSearchIndexSection(indexDb, sectionIndex, label, prepared.text).catch(
                  () => {
                    indexComplete = false;
                  },
                );
              }
              const remaining = MAX_BOOK_SEARCH_RESULTS - bookMatches;
              if (options.sectionIndex != null && options.sectionIndex !== sectionIndex) {
                // Scoped search: this section is only extracted for the index.
              } else if (remaining <= 0) {
                bookTruncated = true;
              } else {
                const outcome = await matchSectionText(
                  book,
                  sectionIndex,
                  prepared.text,
                  sectionLocale,
                  remaining,
                );
                if (signal?.aborted) return;
                if (outcome.truncated) bookTruncated = true;
                if (outcome.matches.length) {
                  const subitems = toSubitems(
                    config.mode,
                    sectionIndex,
                    prepared.text,
                    outcome.matches,
                  );
                  bookMatches += subitems.length;
                  totalMatches += subitems.length;
                  yield {
                    type: 'result',
                    book,
                    result: { index: sectionIndex, label, subitems },
                  };
                }
              }
            }
          }
          if (signal?.aborted) return;
          const sectionsCompleted = sectionIndex + 1;
          const bookProgress = totalSections ? sectionsCompleted / totalSections : 1;
          yield {
            type: 'progress',
            book,
            bookProgress,
            progress: (bookIndex + bookProgress) / books.length,
            sectionsCompleted,
            totalSections,
          };
          // Keep indexing the remaining sections even after the result cap so
          // the cache ends complete; only the matcher work is skipped.
          await yieldSlice();
        }

        if (indexDb && indexComplete) {
          await completeSearchIndex(indexDb).catch(() => {});
        }
      }

      searchedBooks++;
      if (bookTruncated) truncated = true;
      yield {
        type: 'book-completed',
        book,
        matchCount: bookMatches,
        ...(bookTruncated ? { truncated: true } : {}),
      };
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof BookFileNotFoundError) {
        skippedBooks++;
        yield { type: 'book-skipped', book, reason: 'unavailable' };
        continue;
      }
      erroredBooks++;
      yield {
        type: 'book-error',
        book,
        error: error instanceof Error ? error.message : String(error),
        ...((error as { code?: string })?.code ? { code: (error as { code: string }).code } : {}),
      };
    } finally {
      if (!options.session) await closeBook(bookDoc, file);
      if (ownsIndexDb && indexDb) {
        await checkpointSearchIndex(indexDb);
        await indexDb.close().catch(() => {});
      }
    }
  }

  if (!signal?.aborted) {
    yield {
      type: 'completed',
      searchedBooks,
      skippedBooks,
      erroredBooks,
      matchCount: totalMatches,
      truncated,
    };
  }
}

/**
 * Resolve a text-offset locator to a CFI by re-extracting the section with the
 * same walker/filter the index was built with. Called lazily when the user
 * opens a search result — searching itself never materializes Ranges.
 * Falls back to the section CFI when the section text has drifted.
 */
export interface ResolvedSearchResultCfi {
  cfi: string;
  // nearby-words: one CFI per matched word run (>= 2); absent otherwise
  cfis?: string[];
}

export const resolveSearchResultCfis = async (
  session: LibrarySearchSession,
  book: Book,
  locators: SearchResultLocator[],
): Promise<Array<ResolvedSearchResultCfi | null>> => {
  const resolved: Array<ResolvedSearchResultCfi | null> = new Array(locators.length).fill(null);
  let bookDoc: SearchableBookDoc;
  try {
    ({ bookDoc } = await session.open(book));
    await loadTextWalker();
  } catch {
    return resolved;
  }
  const bySection = new Map<number, number[]>();
  locators.forEach((locator, position) => {
    const group = bySection.get(locator.section);
    if (group) group.push(position);
    else bySection.set(locator.section, [position]);
  });
  for (const [sectionIndex, positions] of bySection) {
    try {
      const section = bookDoc.sections?.[sectionIndex];
      const baseCFI = section?.cfi ?? CFI.fake.fromIndex(sectionIndex);
      const doc =
        section && typeof section.createDocument === 'function'
          ? await section.createDocument()
          : null;
      if (!doc) {
        for (const position of positions) resolved[position] = { cfi: baseCFI };
        continue;
      }
      const prepared = prepareSearchSection('resolve', doc, makeAcceptNode(book));
      const rangeCfi = (start: number, end: number): string | null => {
        if (end > prepared.text.length || start >= end) return null;
        const from = findNodeOffset(prepared.cumulative, start, 'right');
        const to = findNodeOffset(prepared.cumulative, end, 'left');
        const range = prepared.makeRange(from.index, from.offset, to.index, to.offset);
        return CFI.joinIndir(baseCFI, CFI.fromRange(range));
      };
      for (const position of positions) {
        const locator = locators[position]!;
        const cfi = rangeCfi(locator.start, locator.end) ?? baseCFI;
        const runCfis = locator.runs
          ?.map((run) => rangeCfi(run.start, run.end))
          .filter((value): value is string => value != null);
        resolved[position] = runCfis && runCfis.length >= 2 ? { cfi, cfis: runCfis } : { cfi };
      }
    } catch {
      // Leave this section's entries null.
    }
  }
  return resolved;
};

export const resolveSearchResultCfi = async (
  session: LibrarySearchSession,
  book: Book,
  locator: SearchResultLocator,
): Promise<string | null> =>
  (await resolveSearchResultCfis(session, book, [locator]))[0]?.cfi ?? null;
