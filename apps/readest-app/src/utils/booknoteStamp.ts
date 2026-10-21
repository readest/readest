import { BookNote } from '@/types/book';

// A record pulled from sync can carry a server stamp ahead of this device's
// clock. A change to it — an edit, a deletion or a restore — must still sort
// after the record's last change, or sync treats the change as stale: it is
// never pushed, and the next pull hands the old copy back (#6544).
export const nextBooknoteStamp = (note: BookNote, now = Date.now()): number =>
  Math.max(now, note.updatedAt + 1, (note.deletedAt ?? 0) + 1);

const latestChangeAt = (note: BookNote) => Math.max(note.updatedAt ?? 0, note.deletedAt ?? 0);

// Latest change wins, the same rule the server's dedupeLatest applies across
// duplicate rows, so a note edited or restored after a remote deletion
// survives it and a deletion made after a remote edit sticks (#6762). A tie
// goes to the tombstone.
export const incomingNoteWins = (existing: BookNote, incoming: BookNote): boolean => {
  const existingAt = latestChangeAt(existing);
  const incomingAt = latestChangeAt(incoming);
  return (
    incomingAt > existingAt ||
    (incomingAt === existingAt && !!incoming.deletedAt && !existing.deletedAt)
  );
};
