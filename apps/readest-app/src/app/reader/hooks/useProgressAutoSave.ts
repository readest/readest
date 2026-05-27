import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { debounce } from '@/utils/debounce';

export const useProgressAutoSave = (bookKey: string) => {
  const { envConfig } = useEnv();
  const { getConfig, saveConfig } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const progress = getProgress(bookKey);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookConfig = useCallback(
    debounce(() => {
      setTimeout(async () => {
        // Skip while previewing a deep-link target — the user's actual
        // last-read position should not be overwritten by a transient view.
        if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
        const config = getConfig(bookKey);
        if (!config) return;
        const settings = useSettingsStore.getState().settings;
        await saveConfig(envConfig, bookKey, config, settings);
      }, 500);
    }, 1000),
    [],
  );

  useEffect(() => {
    saveBookConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, bookKey]);
};
