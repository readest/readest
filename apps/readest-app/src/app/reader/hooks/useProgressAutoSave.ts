import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { throttle } from '@/utils/throttle';

export const useProgressAutoSave = (bookKey: string) => {
  const { envConfig } = useEnv();
  const { getConfig, saveConfig } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const progress = getProgress(bookKey);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookConfig = useCallback(
    throttle(async () => {
      const config = getConfig(bookKey)!;
      const settings = useSettingsStore.getState().settings;
      await saveConfig(envConfig, bookKey, config, settings);
    }, 10000),
    [],
  );

  useEffect(() => {
    saveBookConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, bookKey]);
};
