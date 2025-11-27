import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { throttle } from '@/utils/throttle';
import { getCoverFilename } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';

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
            const coverPath = await appService.resolveFilePath(getCoverFilename(book), 'Books');
            try {
              const lastCoverFilename = 'last-book-cover.png';
              const builtinImagesPath = await appService.resolveFilePath('', 'Images');
              if (!savedCoverPath || savedCoverPath === builtinImagesPath) {
                await appService.copyFile(coverPath, lastCoverFilename, 'Images');
              } else {
                await appService.copyFile(
                  coverPath,
                  `${savedCoverPath}/${lastCoverFilename}`,
                  'None',
                );
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
