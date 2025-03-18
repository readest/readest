import { ViewSettings } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  skipGlobal?: boolean,
) => {
  const { settings, isFontLayoutSettingsGlobal, setSettings, saveSettings } =
    useSettingsStore.getState();
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const viewSettings = getViewSettings(bookKey)!;
  const config = getConfig(bookKey)!;
  viewSettings[key] = value;
  setViewSettings(bookKey, viewSettings);

  if (isFontLayoutSettingsGlobal && !skipGlobal) {
    settings.globalViewSettings[key] = value;
    setSettings(settings);
  }
  await saveConfig(envConfig, bookKey, config, settings);
  await saveSettings(envConfig, settings);
};
