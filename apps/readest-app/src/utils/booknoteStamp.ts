import { BookNote } from '@/types/book';

// A record pulled from sync can carry a server stamp ahead of this device's
// clock. A change to it — an edit, a deletion or a restore — must still sort
// after the record's last change, or sync treats the change as stale: it is
// never pushed, and the next pull hands the old copy back (#6544).
export const nextBooknoteStamp = (note: BookNote, now = Date.now()): number =>
  Math.max(now, note.updatedAt + 1, (note.deletedAt ?? 0) + 1);
