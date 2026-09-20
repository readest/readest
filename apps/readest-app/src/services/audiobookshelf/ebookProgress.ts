// Reading-position sync for ABS-backed ebooks (issue #6257). The audiobook
// side of this lives in progressSync.ts and speaks in seconds against a
// listening session; an ebook has no session and no duration, so it rides on
// the same `/api/me/progress/:itemId` record through its `ebookLocation` +
// `ebookProgress` fields — the pair Audiobookshelf's own ereader reads and
// writes, so a position set in either app resumes in the other.

import type { ABSMediaProgress } from '@/types/audiobookshelf';
import { isLocalProgressFresher } from '@/services/audiobookshelf/progressSync';

/**
 * How far the server fraction must differ from the local one before it is
 * worth moving the reader. Mirrors useProgressSync's SIBLING_FORWARD_EPSILON:
 * it keeps the position we ourselves pushed (rounded on the way through the
 * server) from re-triggering a jump and a "synced" hint on every open.
 */
const FRACTION_EPSILON = 0.002;

/**
 * The book-level progress row ABS keeps for `itemId`, if any. Podcast-episode
 * rows carry the show's item id too, so they are excluded the way
 * AbsProgressSyncer matches its own row.
 */
export const findAbsEbookProgress = (
  mediaProgress: ABSMediaProgress[] | undefined,
  itemId: string,
): ABSMediaProgress | undefined =>
  mediaProgress?.find((entry) => entry.libraryItemId === itemId && !entry.episodeId);

/** What to do with the server position when an ABS ebook is opened. */
export type AbsEbookResume =
  | { kind: 'location'; location: string }
  | { kind: 'fraction'; fraction: number }
  | null;

const usableFraction = (fraction?: number): number | undefined =>
  typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0
    ? Math.min(fraction, 1)
    : undefined;

/**
 * Resume rule for an ABS ebook: newest wins, server wins ties — the same
 * comparison the audiobook path makes, through `isLocalProgressFresher`, so a
 * book read in both apps can't be governed by two different rules.
 *
 * ABS stores the position as an EPUB CFI in `ebookLocation` (its ereader
 * writes epub.js CFIs; Readest writes foliate ones — both are spec CFIs
 * resolvable by the other). Anything else in that field is a format-specific
 * locator, e.g. a PDF page number, which only means something to the reader
 * that wrote it; those fall back to the fraction, which every format can
 * resolve through `view.goToFraction`.
 */
export const resolveAbsEbookResume = (input: {
  remote?: ABSMediaProgress;
  localLocation?: string;
  localFraction?: number;
  /**
   * When THIS device last wrote a reading position for the book, from
   * `readLocalLastPlayedAt` (0 when it never has). The book config's
   * `updatedAt` cannot stand in for it: a config is stamped with the current
   * time the moment a book is first opened, so it would always beat an older
   * server row and a book carried over from another device would never resume.
   */
  localLastReadAt?: number;
}): AbsEbookResume => {
  const { remote, localLocation, localFraction, localLastReadAt } = input;
  if (!remote) return null;
  if (isLocalProgressFresher(localLastReadAt ?? 0, remote.lastUpdate ?? 0)) return null;

  const location = remote.ebookLocation;
  if (location && location.startsWith('epubcfi(')) {
    return location === localLocation ? null : { kind: 'location', location };
  }

  const fraction = usableFraction(remote.ebookProgress);
  if (fraction === undefined) return null;
  if (Math.abs(fraction - (localFraction ?? 0)) <= FRACTION_EPSILON) return null;
  return { kind: 'fraction', fraction };
};

/**
 * The PATCH body for a reading position. `ebookLocation`/`ebookProgress` are
 * what the ABS ereader resumes from; `progress` is the generic field its
 * library UI draws the progress bar and "Continue Reading" shelf from, which
 * would otherwise sit at zero for a book only ever read in Readest.
 */
export const buildAbsEbookProgressPatch = (input: {
  location?: string;
  fraction: number;
}): { ebookLocation: string | null; ebookProgress: number; progress: number } => {
  const fraction = Math.min(1, Math.max(0, input.fraction));
  return {
    // Sent even when empty: ABS keeps a field the patch omits, so a
    // fraction-only push would leave an older CFI in the record, and the
    // resume rule prefers a CFI over the fraction standing next to it.
    ebookLocation: input.location ?? null,
    ebookProgress: fraction,
    progress: fraction,
  };
};
