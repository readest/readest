import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { Book, BookSearchConfig, BookSearchResult, SearchExcerpt } from '@/types/book';
import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
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
const SENTENCE_CONTAINER = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6';
const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ');

const getTextPosition = (root: Element, offset: number) => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let consumed = 0;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= consumed + length) return { node, offset: offset - consumed };
    consumed += length;
    node = walker.nextNode();
  }
  return null;
};

const expandToSentence = (range: Range, locale?: string) => {
  try {
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const root = startElement?.closest(SENTENCE_CONTAINER) ?? startElement;
    if (!root?.contains(range.endContainer)) return range;

    const before = root.ownerDocument.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const matchStart = before.toString().length;
    const matchEnd = matchStart + range.toString().length;
    const text = root.textContent ?? '';
    const segments = Array.from(
      new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text),
    );
    const startSegment = segments.find(
      ({ index, segment }) => index <= matchStart && matchStart < index + segment.length,
    );
    const endOffset = Math.max(matchStart, matchEnd - 1);
    const endSegment = segments.find(
      ({ index, segment }) => index <= endOffset && endOffset < index + segment.length,
    );
    if (!startSegment || !endSegment) return range;

    const sentenceStart = startSegment.index;
    const sentenceEnd = endSegment.index + endSegment.segment.length;
    const start = getTextPosition(root, sentenceStart);
    const end = getTextPosition(root, sentenceEnd);
    if (!start || !end) return range;

    const sentence = root.ownerDocument.createRange();
    sentence.setStart(start.node, start.offset);
    sentence.setEnd(end.node, end.offset);
    return sentence;
  } catch {
    return range;
  }
};

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
      const [content, nativeFilePath] = await Promise.all([
        appService.loadBookContent(book),
        appService.resolveNativeBookFilePath(book),
      ]);
      file = content.file;
      if (signal?.aborted) return;
      bookDoc = (
        await new DocumentLoader(file, { nativeFilePath: nativeFilePath ?? undefined }).open()
      ).book as SearchableBookDoc;
      if (signal?.aborted) return;

      const acceptNode = createRejectFilter({
        tags: book.primaryLanguage?.startsWith('ja') ? ['rt'] : [],
        attributes: ['cfi-inert'],
      });
      const matcher =
        config.mode === 'fuzzy'
          ? createFuzzyMatcher(config, acceptNode)
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
          const doc = await section.createDocument();
          if (signal?.aborted) return;
          const matches = Array.from(matcher(doc, query) as Iterable<MatcherResult>);
          if (matches.length) {
            const subitems = matches.map((match) => {
              const baseCFI = section.cfi ?? CFI.fake.fromIndex(sectionIndex);
              const toCFI = (range: Range) => CFI.joinIndir(baseCFI, CFI.fromRange(range));
              return {
                cfi: toCFI(match.range),
                highlightCfi: toCFI(expandToSentence(match.range, book.primaryLanguage)),
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
      await closeBook(bookDoc, file);
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
