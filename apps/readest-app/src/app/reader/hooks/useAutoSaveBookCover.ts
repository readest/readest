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

              const wroteFullCover = await tryWriteFullCoverFromEpub(
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
 * Try to extract the full-resolution cover from an EPUB via the Rust
 * `extract_epub_cover_full` command and write it to the lock-screen target.
 * Returns true on success, false when the native path is unavailable or
 * the command failed (caller should fall back to the on-disk thumbnail).
 */
async function tryWriteFullCoverFromEpub(
  appService: ReturnType<typeof useEnv>['appService'],
  book: { format: string; hash: string; title: string; sourceTitle?: string },
  destFilename: string,
  externalDestDir: string | null,
): Promise<boolean> {
  if (!appService) return false;
  if (!isTauriAppPlatform()) return false;
  if (book.format !== 'EPUB') return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const localPath = await appService.resolveFilePath(
      getLocalBookFilename(book as Parameters<typeof getLocalBookFilename>[0]),
      'Books',
    );
    const raw = await invoke<RustRawCoverImage>('extract_epub_cover_full', {
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
