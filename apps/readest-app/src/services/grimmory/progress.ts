import type { KoSyncProgress } from '@/services/sync/KOSyncClient';
import type { GrimmoryBookMatch } from './GrimmorySyncStore';
import type { GrimmoryBook, GrimmoryProgressUpdate } from './types';

/**
 * A Grimmory book's reading position, in the shape the progress sync hook
 * reads: an EPUB CFI for reflowable books, the 1-based page for fixed layout.
 */
export const grimmoryRemoteProgress = (
  book: GrimmoryBook,
  fixedLayout: boolean,
): KoSyncProgress | null => {
  let progress: string | undefined;
  let percentage: number | null | undefined;
  if (fixedLayout) {
    const page = book.pdfProgress ?? book.cbxProgress;
    progress = page?.page != null ? String(page.page) : undefined;
    percentage = page?.percentage;
  } else {
    progress = book.epubProgress?.cfi ?? undefined;
    percentage = book.epubProgress?.percentage;
  }
  if (!progress && percentage == null) return null;
  const readAt = book.lastReadTime ? Date.parse(book.lastReadTime) : NaN;
  return {
    progress,
    percentage: (percentage ?? 0) / 100,
    timestamp: Number.isNaN(readAt) ? undefined : readAt / 1000,
    device: 'Grimmory',
  };
};

/** The progress update for the matched file; Grimmory derives the rest from its type. */
export const grimmoryProgressBody = (
  match: GrimmoryBookMatch,
  progress: string,
  percentage: number,
): GrimmoryProgressUpdate => ({
  bookId: match.bookId,
  fileProgress: {
    bookFileId: match.bookFileId,
    positionData: progress,
    progressPercent: Math.round(percentage * 1000) / 10,
  },
});
