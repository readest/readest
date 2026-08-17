import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { transferManager } from '@/services/transferManager';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';

/**
 * Delay before queueing so the transfer manager has a chance to finish
 * initializing when an OPDS import lands right after libraryLoaded.
 */
const UPLOAD_QUEUE_DELAY_MS = 3000;

/**
 * Queue Readest Cloud uploads for OPDS-imported books — the manual catalog
 * download and the subscription auto-sync share this policy. Unlike the
 * explicit per-book Upload action, these are automatic uploads, so they honor
 * the Manage Sync "Books" toggle the same way normal library imports do
 * (`importBook` in ingestService); previously both OPDS paths skipped it and
 * uploaded book files while the user had Books sync off.
 */
export const queueOPDSBookUploads = (
  isLoggedIn: boolean,
  settings: SystemSettings,
  books: Book[],
): void => {
  if (!isLoggedIn || !isReadestCloudStorageActive(settings)) return;
  if (!isSyncCategoryEnabled('book')) return;
  // Two feed entries can resolve to the same file; dedupe by hash and skip
  // books that already have a cloud copy.
  const toUpload = [...new Map(books.map((b) => [b.hash, b])).values()].filter(
    (b) => !b.uploadedAt,
  );
  if (toUpload.length === 0) return;
  setTimeout(() => {
    for (const book of toUpload) {
      transferManager.queueUpload(book);
    }
  }, UPLOAD_QUEUE_DELAY_MS);
};
