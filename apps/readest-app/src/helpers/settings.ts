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
  const { viewStates, getView, getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const viewSettings = getViewSettings(bookKey);
  if (bookKey && viewSettings && viewSettings[key] !== value) {
    viewSettings[key] = value;
    if (applyStyles) {
      const view = getView(bookKey);
      view?.renderer.setStyles?.(getStyles(viewSettings));
    }
  }

  if (isSettingsGlobal && !skipGlobal) {
    settings.globalViewSettings[key] = value;
    setSettings(settings); // Keep this to update the store's state
    await saveSettings(envConfig, settings);

    // Propagate to all open views
    for (const k of Object.keys(viewStates)) {
      const vs = viewStates[k];
      if (vs && vs.viewSettings && vs.viewSettings[key] !== value) {
        const updatedVS = { ...vs.viewSettings, [key]: value };
        setViewSettings(k, updatedVS);
        if (applyStyles && vs.view) {
          vs.view.renderer.setStyles?.(getStyles(updatedVS));
        }
      }
    }
  } else if (bookKey) {
    const viewSettings = getViewSettings(bookKey);
    if (viewSettings && viewSettings[key] !== value) {
      const updatedVS = { ...viewSettings, [key]: value };
      setViewSettings(bookKey, updatedVS);
      if (applyStyles) {
        const view = getView(bookKey);
        view?.renderer.setStyles?.(getStyles(updatedVS));
      }

      // Automatically save to book config if primary
      const viewState = viewStates[bookKey];
      if (viewState?.isPrimary) {
        const config = getConfig(bookKey);
        if (config) {
          config.viewSettings = updatedVS;
          await saveConfig(envConfig, bookKey, config, settings);
        }
      }
    }
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
