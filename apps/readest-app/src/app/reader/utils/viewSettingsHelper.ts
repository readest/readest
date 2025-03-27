import { ViewSettings } from '@/types/book';
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
  const { settings, isFontLayoutSettingsGlobal, setSettings, saveSettings } =
    useSettingsStore.getState();
  const { getView, getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const viewSettings = getViewSettings(bookKey)!;
  const config = getConfig(bookKey)!;
  if (viewSettings[key] !== value) {
    viewSettings[key] = value;
    if (applyStyles) {
      const view = getView(bookKey);
      view?.renderer.setStyles?.(getStyles(viewSettings));
    }
  }
  setViewSettings(bookKey, viewSettings);

  if (isFontLayoutSettingsGlobal && !skipGlobal) {
    settings.globalViewSettings[key] = value;
    setSettings(settings);
  }
  await saveConfig(envConfig, bookKey, config, settings);
  await saveSettings(envConfig, settings);
};
