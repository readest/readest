import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { createProgressThrottle, toProgressPercent, type ProgressPayload } from '@/utils/transfer';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { transferManager } from '@/services/transferManager';
import {
  getActiveFileSyncBackends,
  isReadestCloudEnabled,
} from '@/services/sync/cloudSyncProvider';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { runFileBookDownload, runFileBookUpload } from '@/services/sync/file/runLibrarySync';
import { isCalibreBook } from '@/utils/calibre';
import { downloadCalibreBook } from '@/services/calibre/download';
import { getLocalBookFilename } from '@/utils/book';

/**
 * One throttle runs per in-flight transfer, and every emit re-renders the
 * visible shelf, so a bulk download multiplies this rate by the batch size.
 * Matches the cadence of the single page-level throttle this replaced.
 */
const PROGRESS_THROTTLE_MS = 500;

interface BookDownloadOptions {
  redownload?: boolean;
  queued?: boolean;
  // Bulk callers (the select-mode Download action, #5244) report one summary
  // toast for the whole batch instead of one per book — a group can hold
  // hundreds.
  silent?: boolean;
  // Calibre books: download a specific format instead of the row's preferred
  // one (the "Download <FORMAT>" context-menu items).
  format?: string;
}

/**
 * Explicit per-book Upload/Download routing (#5062) — cloud sync providers are
 * independently selectable, so a book's destinations depend on which of
 * {Readest Cloud, a file backend} are switched on. Extracted out of the huge
 * library page component so this routing (previously untested) can be
 * exercised directly with `renderHook`, the same pattern already used for
 * {@link useBooksSync} and {@link useLibraryFileSync}.
 */
export const useBookTransferActions = (
  envConfig: EnvConfigType,
  appService: AppService | null,
  updateBook: (envConfig: EnvConfigType, book: Book) => Promise<void>,
  setBooksTransferProgress: Dispatch<SetStateAction<{ [key: string]: number }>>,
) => {
  const _ = useTranslation();

  /**
   * Per-book progress reporting for the cover overlay: returns the handler to
   * hand to the transfer, and the teardown to run once it settles.
   *
   * Progress is throttled per transfer (native plugins emit dense per-chunk
   * bursts) and the entry is dropped on teardown, so a stale value cannot
   * linger. The overlay starts indeterminate rather than blank, since no
   * backend knows the byte total until its first progress event.
   *
   * `done()` latches: Tauri delivers Channel progress messages over IPC
   * independently of the invoke response, so a final payload can arrive after
   * the transfer resolved. Nothing clears the entry a second time, so a late
   * event that re-armed the throttle would strand the cover behind a stale
   * overlay with its action button gone, permanently.
   */
  const trackProgress = (bookHash: string) => {
    let settled = false;
    const throttle = createProgressThrottle((progress: ProgressPayload) => {
      setBooksTransferProgress((prev) => {
        const next = toProgressPercent(progress);
        if (prev[bookHash] === next) return prev;
        return { ...prev, [bookHash]: next };
      });
    }, PROGRESS_THROTTLE_MS);
    throttle.push({ progress: 0, total: 0, transferSpeed: 0 });
    return {
      onProgress: (progress: ProgressPayload) => {
        if (!settled) throttle.push(progress);
      },
      done: () => {
        settled = true;
        throttle.cancel();
        setBooksTransferProgress((prev) => {
          if (prev[bookHash] == null) return prev;
          const next = { ...prev };
          delete next[bookHash];
          return next;
        });
      },
    };
  };

  const handleBookUpload = useCallback(
    async (book: Book, _syncBooks = true) => {
      const settingsNow = useSettingsStore.getState().settings;
      const backends = getActiveFileSyncBackends(settingsNow);
      const readest = isReadestCloudEnabled(settingsNow);
      // Peers list a Readest Cloud file only through its `books` row, which is
      // pushed only while Books sync is on, so an upload without it is unreachable.
      const booksSyncOff = readest && !isSyncCategoryEnabled('book');

      // An explicit Upload must reach EVERY destination the user selected
      // (#5062), not just the first one.
      const pushed = backends.length > 0 ? await runFileBookUpload(envConfig, book) : false;
      // Readest Cloud uploads go through the transfer queue (resumable, with its
      // own progress panel), so it reports "queued", not "uploaded".
      const queued = readest && !booksSyncOff ? !!transferManager.queueUpload(book, 1) : false;

      if (queued) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Upload queued: {{title}}', { title: book.title }),
        });
        return true;
      }
      if (pushed) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Book uploaded: {{title}}', { title: book.title }),
        });
        return true;
      }
      // An explicit Upload action must never silently no-op. A failed file
      // backend upload is the real error, so the Books hint is only for when
      // Readest Cloud was the sole destination.
      if (booksSyncOff && backends.length === 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 5000,
          message: _('Turn on Books in Manage Sync to upload this book'),
        });
        return false;
      }
      eventDispatcher.dispatch('toast', {
        type: backends.length > 0 || readest ? 'error' : 'info',
        timeout: 5000,
        message:
          backends.length > 0 || readest
            ? _('Failed to upload book: {{title}}', { title: book.title })
            : _('Turn on a provider in Cloud Sync settings to upload this book'),
      });
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleBookDownload = useCallback(
    async (book: Book, downloadOptions: BookDownloadOptions = {}) => {
      const { redownload = false, queued = false, silent = false } = downloadOptions;
      // Calibre books download from their own server into the managed shelf
      // dir (keeping the row's hash) — covers undownloaded stubs and
      // downloaded copies whose local file was deleted; identity rides
      // metadata.calibreSource either way. The on-disk file doubles as the
      // "already downloaded" check, so a redownload request must evict it
      // first.
      const tryCalibreDownload = async (): Promise<{ ok: boolean; missingOnServer?: boolean }> => {
        if (!appService) return { ok: false };
        if (redownload) {
          await appService.deleteFile(getLocalBookFilename(book), 'Books').catch(() => {});
        }
        const tracker = trackProgress(book.hash);
        try {
          const result = await downloadCalibreBook(appService, book, {
            onProgress: tracker.onProgress,
            format: downloadOptions.format,
          });
          tracker.done();
          if (result.ok) {
            await updateBook(envConfig, book);
            if (!silent) {
              eventDispatcher.dispatch('toast', {
                type: 'info',
                timeout: 2000,
                message: _('Book downloaded: {{title}}', { title: book.title }),
              });
            }
            return { ok: true };
          }
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              message: result.missingOnServer
                ? _('This book is missing its file on the server. Fix it in Calibre-Web.')
                : _('Failed to download book: {{title}}', { title: book.title }),
              type: 'error',
            });
          }
          return { ok: result.ok, missingOnServer: result.missingOnServer };
        } catch {
          tracker.done();
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              message: _('Failed to download book: {{title}}', { title: book.title }),
              type: 'error',
            });
          }
          return { ok: false };
        }
      };
      const isCalibre = isCalibreBook(book);
      // Calibre-first only when no cloud copy exists to prefer (undownloaded
      // stubs), or when the user explicitly asked for a fresh pull. A book
      // with a cloud copy must go the cloud route FIRST: on a peer device
      // that never configured this calibre server, the calibre attempt can
      // only fail, and the cloud file is the same bytes under the same hash.
      let calibreTried = false;
      if (isCalibre && (!book.uploadedAt || redownload)) {
        calibreTried = true;
        if ((await tryCalibreDownload()).ok) return true;
        if (!book.uploadedAt) return false; // no cloud copy to fall back to
      }
      const settingsNow = useSettingsStore.getState().settings;
      const backends = getActiveFileSyncBackends(settingsNow);
      const readest = isReadestCloudEnabled(settingsNow);
      // `uploadedAt` proves that some cloud copy exists, but it does not encode
      // provenance: the file-sync engine stamps it for WebDAV/Drive/S3/etc. too.
      // Try the enabled file mirrors first so a metadata-only shelf row is not
      // misrouted into Readest Cloud. When none has the file, fall through to
      // the native, resumable path if that backend is also enabled (#5009).
      if (backends.length > 0) {
        const tracker = trackProgress(book.hash);
        let ok = false;
        try {
          ok = await runFileBookDownload(envConfig, book, tracker.onProgress);
        } finally {
          tracker.done();
        }
        if (ok) {
          await updateBook(envConfig, book);
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              type: 'info',
              timeout: 2000,
              message: _('Book downloaded: {{title}}', { title: book.title }),
            });
          }
          return true;
        }

        if (!readest || !book.uploadedAt) {
          // Cloud mirrors can't serve it — the calibre server still can.
          if (isCalibre && !calibreTried) {
            calibreTried = true;
            return (await tryCalibreDownload()).ok;
          }
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              type: 'error',
              timeout: 2000,
              message: _('Failed to download book: {{title}}', { title: book.title }),
            });
          }
          return false;
        }
      }

      if (redownload || !queued) {
        const tracker = trackProgress(book.hash);
        try {
          await appService?.downloadBook(book, false, redownload, tracker.onProgress);
          tracker.done();
          await updateBook(envConfig, book);
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              type: 'info',
              timeout: 2000,
              message: _('Book downloaded: {{title}}', {
                title: book.title,
              }),
            });
          }
          return true;
        } catch {
          tracker.done();
          if (isCalibre && !calibreTried && appService) {
            calibreTried = true;
            return (await tryCalibreDownload()).ok;
          }
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              message: _('Failed to download book: {{title}}', {
                title: book.title,
              }),
              type: 'error',
            });
          }
          return false;
        }
      }

      // Use transfer queue for normal downloads - priority 1 for manual downloads.
      // A silent (bulk) download also stays quiet when each transfer completes.
      const transferId = transferManager.queueDownload(book, 1, silent);
      if (transferId) {
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            timeout: 2000,
            message: _('Download queued: {{title}}', {
              title: book.title,
            }),
          });
        }
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  return { handleBookUpload, handleBookDownload };
};
