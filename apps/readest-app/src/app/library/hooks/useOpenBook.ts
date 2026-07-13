import { Dispatch, SetStateAction, useCallback } from 'react';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader, showReaderWindow } from '@/utils/nav';

interface UseOpenBookOptions {
  setLoading: Dispatch<SetStateAction<boolean>>;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
}

/**
 * Shared "open this book" flow used both by per-item taps (`BookshelfItem`) and
 * the recently-read shelf. Centralizing it keeps the availability handling in
 * one place: cloud-synced books (which arrive on other devices as metadata +
 * progress without the file blob) are downloaded on demand, and a stale
 * in-place record is dropped instead of bouncing the user into a broken reader.
 */
export const useOpenBook = ({ setLoading, handleBookDownload }: UseOpenBookOptions) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();

  const makeBookAvailable = useCallback(
    async (book: Book) => {
      // A book with no cloud copy has nothing to fetch; `openBook` below already
      // handles the case where such a book's local file is gone.
      if (!book.uploadedAt) return true;
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

  const openBook = useCallback(
    async (book: Book) => {
      // In-place books point at a file outside Books/<hash>/ that the user (or
      // another app) may have moved, renamed, or deleted between sessions. Probe
      // the source before navigating: if it's gone, drop the stale record
      // instead of opening the reader only to fail and bounce back. Restricted
      // to purely-local in-place books — cloud-synced books (`uploadedAt`) still
      // go through `makeBookAvailable`'s on-demand download path.
      if (book.filePath && !book.uploadedAt && !book.deletedAt) {
        const available = await appService?.isBookAvailable(book);
        if (!available) {
          eventDispatcher.dispatch('toast', {
            message: _(
              'Book file no longer exists. Confirm deletion to remove it from the library.',
            ),
            type: 'info',
          });
          eventDispatcher.dispatch('delete-books', { ids: [book.hash] });
          return;
        }
      }
      const available = await makeBookAvailable(book);
      if (!available) return;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        showReaderWindow(appService, [book.hash]);
      } else {
        setTimeout(() => {
          navigateToReader(router, [book.hash]);
        }, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, makeBookAvailable, settings.openBookInNewWindow],
  );

  return { openBook, makeBookAvailable };
};
