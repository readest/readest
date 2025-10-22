import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  skipGlobal = false,
  applyStyles = true,
) => {
  const { settings, isSettingsGlobal, setSettings, saveSettings } = useSettingsStore.getState();
  const { getView, getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const viewSettings = getViewSettings(bookKey);
  const config = getConfig(bookKey);
  if (bookKey && viewSettings && viewSettings[key] !== value) {
    viewSettings[key] = value;
    if (applyStyles) {
      const view = getView(bookKey);
      view?.renderer.setStyles?.(getStyles(viewSettings));
    }
  }

  if (isSettingsGlobal && !skipGlobal) {
    settings.globalViewSettings[key] = value;
    setSettings(settings);
    await saveSettings(envConfig, settings);
  }

  if (bookKey && config && viewSettings) {
    setViewSettings(bookKey, viewSettings);
    await saveConfig(envConfig, bookKey, config, settings);
  }
};

export const saveSysSettings = async <K extends keyof SystemSettings>(
  envConfig: EnvConfigType,
  key: K,
  value: SystemSettings[K],
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (settings[key] !== value) {
    settings[key] = value;
    setSettings(settings);
    await saveSettings(envConfig, settings);
  }
};
