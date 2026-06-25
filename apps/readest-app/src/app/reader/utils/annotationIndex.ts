import { BookNote } from '@/types/book';
import { createCfiLocationMatcher, getCfiSpinePrefix } from '@/utils/cfi';

export interface AnnotationIndex {
  /** Live annotations bucketed by CFI spine prefix (the chapter id). */
  bySection: Map<string, BookNote[]>;
  /** Book-wide (`global`) highlights, pre-filtered so we don't re-walk the list. */
  globals: BookNote[];
}

/**
 * Index live annotations by their CFI spine prefix so a relocate only has to
 * scan the bucket for the current chapter instead of the whole booknotes
 * array. With heavy users (>1k highlights) a naive `booknotes.filter(...)` per
 * page turn was the dominant contributor to epubcfi parse self-time. The
 * bucketed read turns the per-relocate filter into O(notes-in-chapter).
 *
 * An annotation earns a bucket entry when it has a highlight `style` (a drawn
 * highlight) OR a non-empty `note` (a note bubble) — these are independent
 * overlays (see `removeBookNoteOverlays`), so a note-only annotation with no
 * style must still be tracked.
 *
 * `global` highlights are split into their own pre-filtered array: their
 * semantics is book-wide so they're fanned out across every rendered section
 * rather than matched against the current location.
 */
export function buildAnnotationIndex(booknotes: BookNote[]): AnnotationIndex {
  const bySection = new Map<string, BookNote[]>();
  const globals: BookNote[] = [];
  for (const item of booknotes) {
    if (item.deletedAt) continue;
    if (item.type !== 'annotation') continue;
    const hasNote = !!item.note && item.note.trim().length > 0;
    if (!item.style && !hasNote) continue;
    // Globals fan out a highlight across every occurrence of `text`, so they
    // require a style; a note-only annotation is never global and falls
    // through to the per-section bucket like any other local note.
    if (item.style && item.global) {
      globals.push(item);
      continue;
    }
    const spine = getCfiSpinePrefix(item.cfi);
    if (!spine) continue;
    const bucket = bySection.get(spine);
    if (bucket) bucket.push(item);
    else bySection.set(spine, [item]);
  }
  return { bySection, globals };
}

/**
 * Classify the annotations that fall inside `location` into the in-page
 * highlight list and the in-page note list, scanning only the current
 * chapter's bucket from {@link buildAnnotationIndex}.
 *
 * Mirrors the original two-filter behavior: an annotation joins `annotations`
 * iff it has a `style` (a drawn highlight) and joins `notes` iff it has a
 * non-empty `note` (a note bubble) — the two are independent, so a styled note
 * lands in both and a note-only annotation lands in `notes` alone.
 */
export function selectLocationAnnotations(
  index: AnnotationIndex,
  location: string | null | undefined,
): { annotations: BookNote[]; notes: BookNote[] } {
  const annotations: BookNote[] = [];
  const notes: BookNote[] = [];
  const sectionKey = getCfiSpinePrefix(location);
  if (!sectionKey) return { annotations, notes };

  const candidates = index.bySection.get(sectionKey) ?? [];
  const matchesLocation = createCfiLocationMatcher(location);
  for (const item of candidates) {
    // Re-check `deletedAt` at read time: the index is memoized, so a highlight
    // deleted in place after the index was built still sits in this bucket. Re-
    // drawing it here would orphan its overlay (visible until reopen) — #4773.
    if (item.deletedAt) continue;
    if (!matchesLocation(item.cfi)) continue;
    if (item.style) annotations.push(item);
    if (item.note && item.note.trim().length > 0) notes.push(item);
  }
  return { annotations, notes };
}
