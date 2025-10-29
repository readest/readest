import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { throttle } from '@/utils/throttle';
import { getCoverFilename } from '@/utils/book';

export const useBookCoverAutoSave = (bookKey: string) => {
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
          if (appService && book && savedBookHash && savedBookHash !== book?.hash) {
            const coverPath = await appService.resolveFilePath(getCoverFilename(book), 'Books');
            try {
              await appService.copyFile(coverPath, 'last-book-cover.png', 'Images');
              settings.savedBookCoverForLockScreen = book.hash;
              useSettingsStore.getState().setSettings(settings);
              useSettingsStore.getState().saveSettings(envConfig, settings);
            } catch (error) {
              console.error('Failed to auto-save book cover for lock screen:', error);
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
