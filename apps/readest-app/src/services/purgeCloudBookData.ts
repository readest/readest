import { BookConfig, BookNote } from '@/types/book';
import { DBBookConfig, DBBookNote } from '@/types/records';
import { SyncClient } from '@/libs/sync';
import { transformBookNoteFromDB } from '@/utils/transform';

/**
 * Erase a book's synced reading data — progress and notes/bookmarks — from
 * the cloud, so "Purge all reading data" does not resurrect them the next time
 * the book is opened (#6532).
 *
 * Both are overwritten with newer records rather than hard-deleted, so the
 * erase propagates to other signed-in devices through the normal pull: notes
 * get a `deletedAt` tombstone, and the config's position fields are nulled.
 */
export const purgeCloudBookData = async (bookHash: string, syncClient = new SyncClient()) => {
  const [{ configs }, { notes }] = await Promise.all([
    syncClient.pullChanges(0, 'configs', bookHash),
    syncClient.pullChanges(0, 'notes', bookHash),
  ]);

  // Pulled rows are DB-shaped (snake_case) despite the record types.
  const now = Date.now();
  const deletedNotes: BookNote[] = ((notes ?? []) as unknown as DBBookNote[])
    .filter((note) => note.book_hash === bookHash && !note.deleted_at)
    .map((note) => ({ ...transformBookNoteFromDB(note), deletedAt: now, updatedAt: now }));

  // Explicit nulls (not undefined, which JSON drops) clear the columns.
  const clearedConfigs = ((configs ?? []) as unknown as DBBookConfig[])
    .filter((config) => config.book_hash === bookHash)
    .map(
      (config) =>
        ({
          bookHash,
          metaHash: config.meta_hash,
          location: null,
          xpointer: null,
          progress: null,
          rsvpPosition: null,
          searchConfig: null,
          viewSettings: null,
          updatedAt: now,
        }) as unknown as BookConfig,
    );

  if (deletedNotes.length === 0 && clearedConfigs.length === 0) return;
  await syncClient.pushChanges({ notes: deletedNotes, configs: clearedConfigs });
};
