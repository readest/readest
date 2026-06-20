import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { throttle } from '@/utils/throttle';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';

export const useBookCoverAutoSave = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookCover = useCallback(
    throttle(
      () => {
        setTimeout(async () => {
          const settings = useSettingsStore.getState().settings;
          const bookData = useBookDataStore.getState().getBookData(bookKey);
          const book = bookData?.book;
          const savedBookHash = settings.savedBookCoverForLockScreen;
          const savedCoverPath = settings.savedBookCoverForLockScreenPath;
          if (appService && book && savedBookHash && savedBookHash !== book?.hash) {
            try {
              const lastCoverFilename = 'last-book-cover.png';
              const builtinImagesPath = await appService.resolveFilePath('', 'Images');
              const useBuiltinDest = !savedCoverPath || savedCoverPath === builtinImagesPath;

              const wroteFullCover = await tryWriteFullCoverFromBook(
                appService,
                book,
                lastCoverFilename,
                useBuiltinDest ? null : savedCoverPath,
              );
              if (!wroteFullCover) {
                // Fallback: copy the on-disk thumbnail (still a valid PNG/JPEG
                // payload — webview / system image loaders sniff by header).
                const coverPath = await appService.resolveFilePath(getCoverFilename(book), 'Books');
                if (useBuiltinDest) {
                  await appService.copyFile(coverPath, 'None', lastCoverFilename, 'Images');
                } else {
                  await appService.copyFile(
                    coverPath,
                    'None',
                    `${savedCoverPath}/${lastCoverFilename}`,
                    'None',
                  );
                }
              }

              settings.savedBookCoverForLockScreen = book.hash;
              useSettingsStore.getState().setSettings(settings);
              useSettingsStore.getState().saveSettings(envConfig, settings);
            } catch (error) {
              eventDispatcher.dispatch('toast', {
                type: 'error',
                message: _('Failed to auto-save book cover for lock screen: {{error}}', {
                  error: error instanceof Error ? error.message : String(error),
                }),
              });
            }
          }
        }, 5000);
      },
      5000,
      { emitLast: false },
    ),
    [],
  );

  useEffect(() => {
    saveBookCover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

interface RustRawCoverImage {
  bytes: number[] | Uint8Array;
  mime: string;
}

/**
 * Try to extract the full-resolution cover from the original book file via
 * the Rust native parsers and write it to the lock-screen target. Dispatches
 * by `book.format`:
 *
 *   - EPUB  → `extract_epub_cover_full` (zip-extract the manifest cover-image
 *             entry, raw bytes, no resize),
 *   - MOBI / AZW / AZW3 → `extract_mobi_cover_full` (re-run the EXTH 201/202
 *             cover lookup, raw image-record bytes, no resize).
 *
 * Other formats (PDF, FB2, CBZ, …) don't have a Rust full-cover extractor
 * yet — we return `false` so the caller falls back to the on-disk thumbnail
 * (which, for those formats, is the only artwork we have).
 *
 * Returns true on success, false when the native path is unavailable, the
 * format isn't supported, or the command failed (caller falls back to the
 * on-disk thumbnail).
 */
async function tryWriteFullCoverFromBook(
  appService: ReturnType<typeof useEnv>['appService'],
  book: {
    format: string;
    hash: string;
    title: string;
    sourceTitle?: string;
    /**
     * For in-place imports the book bytes live outside `Books/<hash>/` —
     * we keep the user-supplied path on the Book record and must resolve
     * against it (with base `None`) rather than the synthetic
     * `Books/<hash>/<title>.<ext>` path `getLocalBookFilename` builds.
     * Mirrors the same in-place handling in `useWebDAVSync.pushBookFileNow`
     * and `cloudService.uploadBook`.
     */
    filePath?: string;
  },
  destFilename: string,
  externalDestDir: string | null,
): Promise<boolean> {
  if (!appService) return false;
  if (!isTauriAppPlatform()) return false;
  const command = pickFullCoverCommand(book.format);
  if (!command) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // In-place books point at a file the user owns elsewhere (Downloads,
    // an external SD card, …) — resolve against (filePath, 'None'). Hash-
    // copy books live under Books/<hash>/ with a name derived from their
    // metadata title; fall back to `getLocalBookFilename` for those. Same
    // base-dir dispatch as the sync push paths so behaviour stays uniform
    // across in-place / hash-copy imports.
    const localPath = book.filePath
      ? await appService.resolveFilePath(book.filePath, 'None')
      : await appService.resolveFilePath(
          getLocalBookFilename(book as Parameters<typeof getLocalBookFilename>[0]),
          'Books',
        );
    const raw = await invoke<RustRawCoverImage>(command, {
      filePath: localPath,
    });
    const bytes = raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes);
    // BaseAppService.writeFile accepts ArrayBuffer; slice into a fresh
    // ArrayBuffer (not ArrayBufferLike) to satisfy the lib.dom typings.
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    if (externalDestDir) {
      await appService.writeFile(`${externalDestDir}/${destFilename}`, 'None', ab);
    } else {
      await appService.writeFile(destFilename, 'Images', ab);
    }
    return true;
  } catch (err) {
    console.warn('[useAutoSaveBookCover] full-cover extract failed, falling back:', err);
    return false;
  }
}

/**
 * Map a `Book.format` to the matching Rust full-cover Tauri command, or
 * `null` if no native extractor exists for the format. Kept as a small
 * pure helper so the dispatch table stays in one place — adding a new
 * format (e.g. PDF) only needs a one-line addition here.
 */
function pickFullCoverCommand(format: string): string | null {
  switch (format) {
    case 'EPUB':
      return 'extract_epub_cover_full';
    case 'MOBI':
    case 'AZW3':
    case 'AZW':
      return 'extract_mobi_cover_full';
    default:
      return null;
  }
}
