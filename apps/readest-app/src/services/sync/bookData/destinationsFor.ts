import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveCloudSyncGate } from '@/services/sync/cloudSyncProvider';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { getUserID } from '@/utils/access';
import type { AppService } from '@/types/system';
import { createReadestCloudDestination } from './cloudDestination';
import { createFileSyncDestination } from './fileSyncDestination';
import type { BookDataDestination } from './types';

/**
 * Where a book's data syncs right now: every enabled file-sync backend
 * (unless the plan has them paused, #4959), and Readest Cloud when Books sync
 * runs through it and the book may be uploaded there. `uploadedAt` only rules
 * out a local book: it is also set for a book a file-sync backend holds, so the
 * Readest Cloud destination checks for the book file itself. Empty with the
 * Book Data category off.
 */
export const getBookDataDestinations = async (
  appService: AppService,
  bookHash: string,
): Promise<BookDataDestination[]> => {
  if (!isSyncCategoryEnabled('book_data')) return [];
  const settings = useSettingsStore.getState().settings;
  const gate = resolveCloudSyncGate(settings);
  const destinations: BookDataDestination[] = [];

  const book = useLibraryStore.getState().getBookByHash(bookHash);
  if (gate.readest && isSyncCategoryEnabled('book') && book?.uploadedAt && (await getUserID())) {
    destinations.push(createReadestCloudDestination(appService));
  }
  if (!gate.paused) {
    for (const backend of gate.backends) {
      const provider = await createFileSyncProvider(backend, settings).catch(() => null);
      if (provider) destinations.push(createFileSyncDestination(backend, provider));
    }
  }
  return destinations;
};
