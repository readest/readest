import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getCoverFilename, isCurrentlyReadingBook } from '@/utils/book';
import { updateBookshelfWidget } from '@/utils/bridge';
import type { BookshelfWidgetTts } from '@/utils/bridge';

export interface BookshelfWidgetBook {
  hash: string;
  title: string;
  author: string;
  percent: number;
  coverPath: string;
}

export interface BookshelfWidgetPayload {
  books: BookshelfWidgetBook[];
  sectionTitle: string;
  emptyTitle: string;
  tts?: BookshelfWidgetTts;
}

export const computeReadingPercent = (book: Book): number => {
  const progress = book.progress;
  if (!progress) return 0;
  const [current, total] = progress;
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
};

export const selectBookshelfWidgetBooks = (library: Book[], limit = 3): Book[] =>
  library
    .filter(isCurrentlyReadingBook)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

export interface BookshelfWidgetLabels {
  sectionTitle: string;
  emptyTitle: string;
}

export const buildBookshelfWidgetPayload = async (
  books: Book[],
  appService: AppService,
  labels: BookshelfWidgetLabels,
  tts?: BookshelfWidgetTts,
): Promise<BookshelfWidgetPayload> => {
  // resolveFilePath('', 'Books') returns the absolute Books dir (no trailing
  // slash) by delegating to fs.getPrefix internally. Both platforms use `/`,
  // so plain string concatenation is correct and keeps the builder
  // unit-testable without the Tauri path plugin.
  const booksDir = (await appService.resolveFilePath('', 'Books')).replace(/\/+$/, '');
  const widgetBooks: BookshelfWidgetBook[] = books.map((book) => ({
    hash: book.hash,
    title: book.title ?? '',
    author: book.author ?? '',
    percent: computeReadingPercent(book),
    coverPath: `${booksDir}/${getCoverFilename(book)}`,
  }));
  return {
    books: widgetBooks,
    sectionTitle: labels.sectionTitle,
    emptyTitle: labels.emptyTitle,
    ...(tts ? { tts } : {}),
  };
};

export const refreshBookshelfWidget = async (
  appService: AppService,
  labels: BookshelfWidgetLabels,
  tts?: BookshelfWidgetTts,
): Promise<void> => {
  if (!appService.isMobileApp) return;
  const library = useLibraryStore.getState().library;
  const selected = selectBookshelfWidgetBooks(library);
  const payload = await buildBookshelfWidgetPayload(selected, appService, labels, tts);
  try {
    await updateBookshelfWidget(payload);
  } catch (err) {
    console.warn('Failed to update bookshelf widget', err);
  }
};
