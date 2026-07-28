import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { Book, BookSearchConfig, BookSearchResult, SearchExcerpt } from '@/types/book';
import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { findContainsMatches } from '@/utils/containsSearch';
import { findFuzzyMatches } from '@/utils/fuzzySearch';
import { createRejectFilter } from '@/utils/node';
import { BookFileNotFoundError } from './errors';
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
    };

export interface LibrarySearchOptions {
  config?: Partial<BookSearchConfig>;
  signal?: AbortSignal;
  session?: LibrarySearchSession;
}

interface MatcherResult {
  range: Range;
  subRanges?: Range[];
  excerpt: SearchExcerpt;
}

const DEFAULT_CONFIG: BookSearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
};

const CONTEXT_LENGTH = 50;
const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ');

const findNodeOffset = (cumulative: number[], offset: number) => {
  let low = 0;
  let high = cumulative.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cumulative[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { index: low, offset: offset - cumulative[low]! };
};

const makeExcerpt = (text: string, start: number, end: number): SearchExcerpt => {
  const before = normalizeWhitespace(text.slice(0, start)).trimStart();
  const after = normalizeWhitespace(text.slice(end)).trimEnd();
  return {
    pre: `${before.length < CONTEXT_LENGTH ? '' : '…'}${before.slice(-CONTEXT_LENGTH)}`,
    match: text.slice(start, end),
    post: `${after.slice(0, CONTEXT_LENGTH)}${after.length < CONTEXT_LENGTH ? '' : '…'}`,
  };
};

const makeFuzzyExcerpt = (
  text: string,
  start: number,
  end: number,
  runs: Array<{ start: number; end: number }>,
): SearchExcerpt => {
  const before = normalizeWhitespace(text.slice(0, start)).trimStart();
  const after = normalizeWhitespace(text.slice(end)).trimEnd();
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
    pre: `${before.length < CONTEXT_LENGTH ? '' : '…'}${before.slice(-CONTEXT_LENGTH)}`,
    match: text.slice(start, end),
    post: `${after.slice(0, CONTEXT_LENGTH)}${after.length < CONTEXT_LENGTH ? '' : '…'}`,
    segments,
  };
};

const createFuzzyMatcher = (config: BookSearchConfig, acceptNode: (node: Node) => number) => {
  return function* (doc: Document, query: string): Generator<MatcherResult> {
    const iterator = textWalker(
      doc,
      function* (strings: string[], makeRange: (...args: number[]) => Range) {
        const text = strings.join('');
        const cumulative = [0];
        for (const value of strings) cumulative.push(cumulative.at(-1)! + value.length);
        for (const match of findFuzzyMatches(text, query, config)) {
          const start = findNodeOffset(cumulative, match.start);
          const end = findNodeOffset(cumulative, match.end);
          const range = makeRange(start.index, start.offset, end.index, end.offset);
          const subRanges = match.runs.map((run) => {
            const runStart = findNodeOffset(cumulative, run.start);
            const runEnd = findNodeOffset(cumulative, run.end);
            return makeRange(runStart.index, runStart.offset, runEnd.index, runEnd.offset);
          });
          yield {
            range,
            subRanges,
            excerpt: makeFuzzyExcerpt(text, match.start, match.end, match.runs),
          };
        }
      },
      acceptNode,
    );
    yield* iterator as Generator<MatcherResult>;
  };
};

const createContainsMatcher = (
  config: BookSearchConfig,
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
          const start = findNodeOffset(cumulative, match.start);
          const end = findNodeOffset(cumulative, match.end);
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
  sectionDocuments: Map<number, Promise<Document | null>>;
}

export const createLibrarySearchSession = (appService: LibrarySearchAppService) => {
  const documents = new Map<string, { updatedAt: number; pending: Promise<CachedSearchBook> }>();
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
        return { file: content.file, bookDoc, sectionDocuments: new Map() };
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
      dispose(oldest);
    }
    return pending;
  };

  return {
    open,
    async getSectionDocument(book: Book, index: number) {
      const cached = await open(book);
      const existing = cached.sectionDocuments.get(index);
      if (existing) return existing;
      const createDocument = cached.bookDoc.sections[index]?.createDocument;
      const pending = createDocument ? createDocument() : Promise.resolve(null);
      cached.sectionDocuments.set(index, pending);
      void pending.catch(() => cached.sectionDocuments.delete(index));
      return pending;
    },
    async close() {
      const cached = [...documents.values()];
      documents.clear();
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
  const config: BookSearchConfig = { ...DEFAULT_CONFIG, ...options.config, scope: 'book' };
  const { signal } = options;
  let searchedBooks = 0;
  let skippedBooks = 0;
  let erroredBooks = 0;
  let totalMatches = 0;

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
      const matcher =
        config.mode === 'fuzzy'
          ? createFuzzyMatcher(config, acceptNode)
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
          const matches = Array.from(matcher(doc, query) as Iterable<MatcherResult>);
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
      }

      searchedBooks++;
      totalMatches += bookMatches;
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
  }

  if (!signal?.aborted) {
    yield {
      type: 'completed',
      searchedBooks,
      skippedBooks,
      erroredBooks,
      matchCount: totalMatches,
    };
  }
}
