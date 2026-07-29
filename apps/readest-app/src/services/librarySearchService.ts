import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { Book, BookSearchResult, LibrarySearchConfig, SearchExcerpt } from '@/types/book';
import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { findContainsMatches } from '@/utils/containsSearch';
import { findFuzzyMatches, MAX_FUZZY_QUERY_LENGTH } from '@/utils/fuzzySearch';
import type { LibrarySearchWorkerMatch } from '@/utils/librarySearchWorkerProtocol';
import { findNearbyMatches } from '@/utils/nearbySearch';
import { createRejectFilter } from '@/utils/node';
import { BookFileNotFoundError } from './errors';
import { createLibrarySearchWorker } from './librarySearchWorker';
import * as CFI from 'foliate-js/epubcfi.js';
import { TOCProgress } from 'foliate-js/progress.js';
import { searchMatcher } from 'foliate-js/search.js';
import { textWalker } from 'foliate-js/text-walker.js';

type LibrarySearchAppService = Pick<AppService, 'loadBookContent' | 'resolveNativeBookFilePath'>;

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
  | { type: 'result'; book: Book; result: BookSearchResult }
  | { type: 'book-completed'; book: Book; matchCount: number }
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
}

interface MatcherResult {
  range: Range;
  subRanges?: Range[];
  excerpt: SearchExcerpt;
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
const MAX_LIBRARY_SEARCH_RESULTS = 500;
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

interface PreparedSearchSection {
  key: string;
  text: string;
  cumulative: number[];
  makeRange: (...args: number[]) => Range;
  bytes: number;
}

const prepareSearchSection = (
  key: string,
  doc: Document,
  acceptNode: (node: Node) => number,
): PreparedSearchSection => {
  let prepared: PreparedSearchSection | null = null;
  Array.from(
    textWalker(
      doc,
      (strings: string[], makeRange: (...args: number[]) => Range) => {
        const text = strings.join('');
        const cumulative = [0];
        for (const value of strings) cumulative.push(cumulative.at(-1)! + value.length);
        prepared = {
          key,
          text,
          cumulative,
          makeRange,
          bytes: text.length * 2 + cumulative.length * 8,
        };
        return [];
      },
      acceptNode,
    ),
  );
  if (!prepared) throw new Error('Unable to prepare book section for search');
  return prepared;
};

const makeWorkerMatches = (
  section: PreparedSearchSection,
  matches: LibrarySearchWorkerMatch[],
  mode: 'fuzzy' | 'nearby-words',
): MatcherResult[] =>
  matches.map((match) => {
    const start = findNodeOffset(section.cumulative, match.start, 'right');
    const end = findNodeOffset(section.cumulative, match.end, 'left');
    const subRanges = match.runs.map((run) => {
      const runStart = findNodeOffset(section.cumulative, run.start, 'right');
      const runEnd = findNodeOffset(section.cumulative, run.end, 'left');
      return section.makeRange(runStart.index, runStart.offset, runEnd.index, runEnd.offset);
    });
    const excerpt = makeFuzzyExcerpt(section.text, match.start, match.end, match.runs);
    if (mode === 'nearby-words' && excerpt.segments) {
      excerpt.match = normalizeWhitespace(excerpt.match);
      excerpt.segments = excerpt.segments
        .map((segment) => ({ ...segment, text: normalizeWhitespace(segment.text) }))
        .filter(({ text }) => text.length > 0);
    }
    return {
      range: section.makeRange(start.index, start.offset, end.index, end.offset),
      subRanges,
      excerpt,
    };
  });

const createContainsMatcher = (
  config: LibrarySearchConfig,
  acceptNode: (node: Node) => number,
  defaultLocale?: string,
) => {
  return function* (doc: Document, query: string): Generator<MatcherResult> {
    const locale = doc.body.lang || doc.documentElement.lang || defaultLocale;
    const iterator = textWalker(
      doc,
      function* (strings: string[], makeRange: (...args: number[]) => Range) {
        const text = strings.join('');
        const cumulative = [0];
        for (const value of strings) cumulative.push(cumulative.at(-1)! + value.length);
        for (const match of findContainsMatches(text, query, config, locale)) {
          const start = findNodeOffset(cumulative, match.start, 'right');
          const end = findNodeOffset(cumulative, match.end, 'left');
          yield {
            range: makeRange(start.index, start.offset, end.index, end.offset),
            excerpt: makeExcerpt(text, match.start, match.end),
          };
        }
      },
      acceptNode,
    );
    yield* iterator as Generator<MatcherResult>;
  };
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

interface CachedSearchBook {
  file: File;
  bookDoc: SearchableBookDoc;
}

const MAX_PREPARED_SECTION_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_SECTIONS = 256;

export const createLibrarySearchSession = (appService: LibrarySearchAppService) => {
  const documents = new Map<string, { updatedAt: number; pending: Promise<CachedSearchBook> }>();
  const sectionDocuments = new Map<
    string,
    { bookHash: string; pending: Promise<Document | null> }
  >();
  const preparedSections = new Map<string, { bookHash: string; section: PreparedSearchSection }>();
  const searchWorker = createLibrarySearchWorker();
  let preparedBytes = 0;
  const removePreparedSection = (key: string) => {
    const entry = preparedSections.get(key);
    if (!entry) return;
    preparedBytes -= entry.section.bytes;
    preparedSections.delete(key);
  };
  const removeCachedBookSections = (bookHash: string) => {
    for (const [key, entry] of sectionDocuments) {
      if (entry.bookHash === bookHash) sectionDocuments.delete(key);
    }
    for (const [key, entry] of preparedSections) {
      if (entry.bookHash !== bookHash) continue;
      removePreparedSection(key);
    }
  };
  const dispose = (bookHash: string, { pending }: { pending: Promise<CachedSearchBook> }) => {
    removeCachedBookSections(bookHash);
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
    if (existing) dispose(book.hash, existing);

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

    if (documents.size > 10) {
      const oldestHash = documents.keys().next().value!;
      const oldest = documents.get(oldestHash)!;
      documents.delete(oldestHash);
      dispose(oldestHash, oldest);
    }
    return pending;
  };

  const getSectionDocument = async (book: Book, index: number) => {
    const cached = await open(book);
    const key = `${book.hash}:${book.updatedAt}:${index}`;
    const existing = sectionDocuments.get(key);
    if (existing) {
      sectionDocuments.delete(key);
      sectionDocuments.set(key, existing);
      return existing.pending;
    }
    const createDocument = cached.bookDoc.sections[index]?.createDocument;
    const pending = createDocument ? createDocument() : Promise.resolve(null);
    const entry = { bookHash: book.hash, pending };
    sectionDocuments.set(key, entry);
    void pending.catch(() => {
      if (sectionDocuments.get(key) === entry) sectionDocuments.delete(key);
    });
    while (sectionDocuments.size > MAX_CACHED_SECTIONS) {
      const oldestKey = sectionDocuments.keys().next().value!;
      sectionDocuments.delete(oldestKey);
      removePreparedSection(oldestKey);
    }
    return pending;
  };

  return {
    open,
    getSectionDocument,
    async getPreparedSection(book: Book, index: number, acceptNode: (node: Node) => number) {
      const key = `${book.hash}:${book.updatedAt}:${index}`;
      const existing = preparedSections.get(key);
      if (existing) {
        const document = sectionDocuments.get(key);
        if (document) {
          sectionDocuments.delete(key);
          sectionDocuments.set(key, document);
        }
        preparedSections.delete(key);
        preparedSections.set(key, existing);
        return existing.section;
      }
      const doc = await getSectionDocument(book, index);
      if (!doc) return null;
      const prepared = preparedSections.get(key);
      if (prepared) {
        preparedSections.delete(key);
        preparedSections.set(key, prepared);
        return prepared.section;
      }
      const section = prepareSearchSection(key, doc, acceptNode);
      if (section.bytes <= MAX_PREPARED_SECTION_BYTES) {
        while (
          preparedSections.size >= MAX_CACHED_SECTIONS ||
          (preparedSections.size > 0 && preparedBytes + section.bytes > MAX_PREPARED_SECTION_BYTES)
        ) {
          const oldestKey = preparedSections.keys().next().value!;
          removePreparedSection(oldestKey);
        }
        preparedSections.set(key, { bookHash: book.hash, section });
        preparedBytes += section.bytes;
      }
      return section;
    },
    searchWorker,
    async close() {
      const cached = [...documents.values()];
      documents.clear();
      sectionDocuments.clear();
      preparedSections.clear();
      preparedBytes = 0;
      searchWorker.close();
      await Promise.all(
        cached.map(({ pending }) =>
          pending.then(
            ({ bookDoc, file }) => closeBook(bookDoc, file),
            () => {},
          ),
        ),
      );
    },
  };
};

export type LibrarySearchSession = ReturnType<typeof createLibrarySearchSession>;

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

  if (
    books.length > 0 &&
    config.mode === 'nearby-words' &&
    query.trim().split(/\s+/).filter(Boolean).length < 2
  ) {
    const book = books[0];
    if (book) {
      yield {
        type: 'book-error',
        book,
        error: 'Nearby words search needs at least two words',
        code: 'NEARBY_NEEDS_TWO_WORDS',
      };
    }
    return;
  }
  if (
    books.length > 0 &&
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

  for (const [bookIndex, book] of books.entries()) {
    if (signal?.aborted) return;
    let file: File | null = null;
    let bookDoc: SearchableBookDoc | null = null;
    try {
      yield { type: 'book-started', book, bookIndex, totalBooks: books.length };
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

      const acceptNode = createRejectFilter({
        tags: book.primaryLanguage?.startsWith('ja') ? ['rt'] : [],
        attributes: ['cfi-inert'],
      });
      const usesSearchWorker = config.mode === 'fuzzy' || config.mode === 'nearby-words';
      const matcher = usesSearchWorker
        ? null
        : config.mode === 'contains'
          ? createContainsMatcher(config, acceptNode, book.primaryLanguage)
          : searchMatcher(textWalker, {
              ...config,
              defaultLocale: book.primaryLanguage,
              acceptNode,
            });
      const tocProgress = await createTOCProgress(bookDoc);
      const totalSections = bookDoc.sections.length;
      let bookMatches = 0;

      for (const [sectionIndex, section] of bookDoc.sections.entries()) {
        if (signal?.aborted) return;
        if (typeof section.createDocument === 'function') {
          const doc = options.session
            ? await options.session.getSectionDocument(book, sectionIndex)
            : await section.createDocument();
          if (!doc) continue;
          if (signal?.aborted) return;
          let matches: MatcherResult[];
          if (usesSearchWorker) {
            const prepared = options.session
              ? await options.session.getPreparedSection(book, sectionIndex, acceptNode)
              : prepareSearchSection(
                  `${book.hash}:${book.updatedAt}:${sectionIndex}`,
                  doc,
                  acceptNode,
                );
            if (!prepared || signal?.aborted) return;
            const locale =
              doc.body.lang || doc.documentElement.lang || book.primaryLanguage || 'en';
            const remainingResults = MAX_LIBRARY_SEARCH_RESULTS - totalMatches;
            const payload = {
              sectionKey: prepared.key,
              text: prepared.text,
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
              limit: remainingResults,
            };
            let numericMatches: LibrarySearchWorkerMatch[];
            let sectionTruncated: boolean;
            if (options.session) {
              const result = await options.session.searchWorker.search(payload, signal);
              numericMatches = result.matches;
              sectionTruncated = result.truncated;
            } else {
              const state: { truncated?: boolean } = {};
              numericMatches =
                config.mode === 'fuzzy'
                  ? findFuzzyMatches(
                      prepared.text,
                      query,
                      payload.fuzzyOptions,
                      payload.limit,
                      state,
                    )
                  : findNearbyMatches(
                      prepared.text,
                      query,
                      payload.nearbyOptions,
                      undefined,
                      payload.limit,
                      state,
                    );
              sectionTruncated = Boolean(state.truncated);
            }
            if (signal?.aborted) return;
            if (sectionTruncated || numericMatches.length >= remainingResults) truncated = true;
            matches = makeWorkerMatches(prepared, numericMatches, payload.mode);
          } else {
            matches = Array.from(matcher!(doc, query) as Iterable<MatcherResult>);
          }
          if (matches.length) {
            const subitems = matches.map((match) => {
              const baseCFI = section.cfi ?? CFI.fake.fromIndex(sectionIndex);
              const toCFI = (range: Range) => CFI.joinIndir(baseCFI, CFI.fromRange(range));
              return {
                cfi: toCFI(match.range),
                ...(match.subRanges?.length ? { cfis: match.subRanges.map(toCFI) } : {}),
                excerpt: match.excerpt,
              };
            });
            bookMatches += subitems.length;
            totalMatches += subitems.length;
            yield {
              type: 'result',
              book,
              result: {
                index: sectionIndex,
                label: tocProgress?.getProgress(sectionIndex, matches[0]!.range)?.label ?? '',
                subitems,
              },
            };
          }
          if (truncated) break;
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
        if (performance.now() - sliceStarted >= 8) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          sliceStarted = performance.now();
        }
      }

      searchedBooks++;
      yield { type: 'book-completed', book, matchCount: bookMatches };
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
    }
    if (truncated) break;
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
