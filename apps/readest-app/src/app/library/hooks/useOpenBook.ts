import { Dispatch, SetStateAction, useCallback } from 'react';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { hasFileSyncMirror, useMakeBookAvailable } from '@/hooks/useMakeBookAvailable';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader, showReaderWindow } from '@/utils/nav';
import { isAudiobook } from '@/utils/audiobook';

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
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const makeBookAvailable = useMakeBookAvailable({ setLoading, handleBookDownload });

  const openBook = useCallback(
    async (book: Book, cfi?: string, options?: { highlightSearchResult?: boolean }) => {
      // A streaming audiobook has no local file and no document loader path -
      // it opens in the full-screen player instead of the reader. Short-circuit
      // before any of the file-availability logic below, which assumes a real
      // file backs `book.filePath`.
      if (isAudiobook(book)) {
        router.push(`/player?id=${book.hash}`);
        return;
      }
      // In-place books point at a file outside Books/<hash>/ that the user (or
      // another app) may have moved, renamed, or deleted between sessions. Probe
      // the source before navigating: if it's gone, drop the stale record
      // instead of opening the reader only to fail and bounce back. Restricted
      // to purely-local in-place books — cloud-synced books (`uploadedAt`) still
      // go through `makeBookAvailable`'s on-demand download path.
      //
      // This dispatch is the only automatic route into `handleBookDelete('both')`,
      // which tombstones the book and lets the file sync GC its directory off the
      // remote — so a device with a file mirror must never take it (#5265). A
      // missing LOCAL file is not evidence that the user wants the REMOTE copy
      // destroyed, and there the book is very likely still on the mirror;
      // `makeBookAvailable` below fetches it back instead.
      if (book.filePath && !book.uploadedAt && !book.deletedAt && !hasFileSyncMirror()) {
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
      const params = new URLSearchParams();
      if (cfi) params.set('cfi', cfi);
      if (cfi && options?.highlightSearchResult) params.set('highlight', 'search');
      const queryParams = params.size ? params.toString() : undefined;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        showReaderWindow(appService, [book.hash], queryParams);
      } else {
        setTimeout(() => {
          navigateToReader(router, [book.hash], queryParams);
        }, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, makeBookAvailable, settings.openBookInNewWindow],
  );

  return { openBook, makeBookAvailable };
};
