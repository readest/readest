import { BookNote } from '@/types/book';

export interface UpdateBooknoteNoteTextResult {
  booknotes: BookNote[];
  updatedBooknote: BookNote;
  previousNoteText: string;
}

/**
 * Replace the `note` text of the live (`!deletedAt`) booknote identified by
 * `booknoteId`. Returns a new booknotes array — `booknotes` itself is never
 * mutated. Blank/whitespace-only `noteText` is normalized to an empty
 * string; non-blank text is stored exactly as given, with no trimming.
 * `now` is the caller-supplied timestamp for `updatedAt`, keeping this
 * function deterministic and independent of when it happens to run.
 *
 * Matches by `id` alone — intentionally agnostic to `BookNote['type']`, so
 * it updates the `note` field of a bookmark or excerpt record exactly like
 * an annotation. Callers that only want to touch annotations are
 * responsible for filtering by type themselves.
 *
 * Returns `null` when no matching, non-deleted record exists — e.g. it was
 * tombstoned by a concurrent sync before this edit was saved — so the
 * caller can abort instead of resurrecting a deleted note.
 */
export function updateBooknoteNoteText(
  booknotes: readonly BookNote[],
  booknoteId: string,
  noteText: string,
  now: number,
): UpdateBooknoteNoteTextResult | null {
  const existingIndex = booknotes.findIndex(
    (booknote) => booknote.id === booknoteId && !booknote.deletedAt,
  );
  if (existingIndex === -1) return null;

  const existingBooknote = booknotes[existingIndex]!;
  const normalizedNoteText = noteText.trim() ? noteText : '';
  const updatedBooknote: BookNote = {
    ...existingBooknote,
    note: normalizedNoteText,
    updatedAt: now,
  };

  return {
    booknotes: booknotes.map((booknote, index) =>
      index === existingIndex ? updatedBooknote : booknote,
    ),
    updatedBooknote,
    previousNoteText: existingBooknote.note,
  };
}
