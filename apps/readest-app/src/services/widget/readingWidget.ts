import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getCoverFilename } from '@/utils/book';
import { updateReadingWidget } from '@/utils/bridge';
import type { ReadingWidgetTts } from '@/utils/bridge';

export interface ReadingWidgetBook {
  hash: string;
  title: string;
  author: string;
  percent: number;
  coverPath: string;
}

export interface ReadingWidgetPayload {
  books: ReadingWidgetBook[];
  sectionTitle: string;
  emptyTitle: string;
  tts?: ReadingWidgetTts;
}

const EXCLUDED_STATUSES = new Set(['finished', 'abandoned']);

export const computeReadingPercent = (book: Book): number => {
  const progress = book.progress;
  if (!progress) return 0;
  const [current, total] = progress;
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
};

export const selectReadingWidgetBooks = (library: Book[], limit = 3): Book[] =>
  library
    .filter((b) => !b.deletedAt && !EXCLUDED_STATUSES.has(b.readingStatus ?? 'unread'))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

export interface ReadingWidgetLabels {
  sectionTitle: string;
  emptyTitle: string;
}

export const buildReadingWidgetPayload = async (
  books: Book[],
  appService: AppService,
  labels: ReadingWidgetLabels,
  tts?: ReadingWidgetTts,
): Promise<ReadingWidgetPayload> => {
  // resolveFilePath('', 'Books') returns the absolute Books dir (no trailing
  // slash) by delegating to fs.getPrefix internally. Both platforms use `/`,
  // so plain string concatenation is correct and keeps the builder
  // unit-testable without the Tauri path plugin.
  const booksDir = (await appService.resolveFilePath('', 'Books')).replace(/\/+$/, '');
  const widgetBooks: ReadingWidgetBook[] = books.map((book) => ({
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

export const refreshReadingWidget = async (
  appService: AppService,
  labels: ReadingWidgetLabels,
  tts?: ReadingWidgetTts,
): Promise<void> => {
  if (!appService.isMobileApp) return;
  const library = useLibraryStore.getState().library;
  const selected = selectReadingWidgetBooks(library);
  const payload = await buildReadingWidgetPayload(selected, appService, labels, tts);
  try {
    await updateReadingWidget(payload);
  } catch (err) {
    console.warn('Failed to update reading widget', err);
  }
};
