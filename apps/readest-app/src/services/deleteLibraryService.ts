import { AppService } from '@/types/system';
import { deleteCloudLibrary } from '@/libs/user';

/**
 * Wipe the user's whole library: the cloud `books` rows first, then every book
 * on this device.
 *
 * The cloud call goes first on purpose. It is the recoverable half — if it
 * fails, nothing local has been touched yet and the user still has every book.
 * The local purge is irreversible, so it only runs once the network step has
 * succeeded.
 *
 * Both halves are hard removals rather than `deletedAt` tombstones. Tombstones
 * would be pushed back up on the next sync, refilling the very rows we just
 * deleted and clearing the library on every other signed-in device.
 */
export const deleteAllBooks = async (appService: AppService): Promise<void> => {
  await deleteCloudLibrary();

  const books = await appService.loadLibraryBooks();
  for (const book of books) {
    try {
      // 'purge' erases the whole Books/<hash>/ dir — the book file, cover,
      // config.json (progress, bookmarks, annotations), nav.json and the TTS
      // cache. Its `source.kind === 'managed'` guard is why this must go
      // through deleteBook: books imported in place keep their original file
      // at the user-controlled path (see the in-place delete regression).
      await appService.deleteBook(book, 'purge');
    } catch (error) {
      // One unreadable book must not strand the rest of the library.
      console.error('Failed to purge book:', book.hash, error);
    }
  }

  await appService.saveLibraryBooks([], { replace: true });
};
