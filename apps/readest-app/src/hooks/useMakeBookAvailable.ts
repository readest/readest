import { Dispatch, SetStateAction, useCallback } from 'react';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';

/**
 * Whether a third-party file mirror (WebDAV / Google Drive / S3 / OneDrive) is
 * switched on. Read straight off the store: the callback below is memoized
 * without `settings` in its dependency list, so a captured copy would go
 * stale the moment the user toggles a provider.
 */
export const hasFileSyncMirror = (): boolean =>
  getActiveFileSyncBackends(useSettingsStore.getState().settings).length > 0;

interface UseMakeBookAvailableOptions {
  setLoading: Dispatch<SetStateAction<boolean>>;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
}

/**
 * "Get this book's file onto the device, downloading it if needed." Shared by
 * every route into the reader that can be handed a cloud-synced book: the
 * library's own taps ({@link import('@/app/library/hooks/useOpenBook')}) and
 * home-screen widget taps ({@link import('./useOpenBookLink')}), which reach
 * the reader without passing through the shelf at all.
 */
export const useMakeBookAvailable = ({
  setLoading,
  handleBookDownload,
}: UseMakeBookAvailableOptions) => {
  const { envConfig, appService } = useEnv();
  const updateBook = useLibraryStore((state) => state.updateBook);

  return useCallback(
    async (book: Book) => {
      // A book with no cloud copy has nothing to fetch; the callers already
      // handle the case where such a book's local file is gone. `uploadedAt` is
      // not the whole story for a file backend: it is stamped by the sync engine,
      // so a row it has not reconciled yet (or one poisoned by a pre-#5087
      // client, #5265) can be sitting on the mirror without carrying the stamp.
      // Ask the mirror before giving up on it.
      if (!book.uploadedAt && !hasFileSyncMirror()) return true;
      // The row's `downloadedAt` is not proof that the file is still here: a
      // "Remove from Device Only" evicts the file, and an in-place original can
      // be moved or deleted behind our back. Probe, and re-fetch from the cloud
      // when it's really gone, instead of opening a reader that cannot load.
      if (await appService?.isBookAvailable(book)) {
        if (!book.downloadedAt || !book.coverDownloadedAt) {
          book.downloadedAt = Date.now();
          book.coverDownloadedAt = Date.now();
          await updateBook(envConfig, book);
        }
        return true;
      }
      let available = false;
      const loadingTimeout = setTimeout(() => setLoading(true), 200);
      try {
        available = await handleBookDownload(book, { queued: false });
        await updateBook(envConfig, book);
      } finally {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        setLoading(false);
      }
      return available;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, envConfig, handleBookDownload, setLoading],
  );
};
