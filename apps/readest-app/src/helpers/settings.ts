import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

/**
 * Resolve the effective background texture for the library page (issue #4743).
 * The library texture is stored separately from the reader's, but each field
 * falls back to the reader/global value when unset — so the bookshelf inherits
 * the current look until the user explicitly picks a library texture, then
 * decouples per-field. Returns a `ViewSettings` so it can be handed straight to
 * `useBackgroundTexture().applyBackgroundTexture`.
 */
export const getLibraryViewSettings = (settings: SystemSettings): ViewSettings => {
  // globalViewSettings can be absent on the very first renders — the store
  // starts as `{} as SystemSettings` until appService.loadSettings() runs — so
  // every read is optional and falls back to a no-texture default.
  const globalViewSettings = settings.globalViewSettings;
  return {
    ...globalViewSettings,
    backgroundTextureId:
      settings.libraryBackgroundTextureId ?? globalViewSettings?.backgroundTextureId ?? 'none',
    backgroundOpacity:
      settings.libraryBackgroundOpacity ?? globalViewSettings?.backgroundOpacity ?? 0.6,
    backgroundSize: settings.libraryBackgroundSize ?? globalViewSettings?.backgroundSize ?? 'cover',
  };
};

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  skipGlobal = false,
  applyStyles = true,
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const { bookKeys, getView, getViewState, getViewSettings, setViewSettings } =
    useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();

  const applyViewSettings = async (bookKey: string) => {
    const viewSettings = getViewSettings(bookKey);
    const viewState = getViewState(bookKey);
    if (bookKey && viewSettings && viewSettings[key] !== value) {
      viewSettings[key] = value;
      setViewSettings(bookKey, viewSettings);
      if (applyStyles) {
        const view = getView(bookKey);
        view?.renderer.setStyles?.(getStyles(viewSettings));
      }
      const config = getConfig(bookKey);
      if (viewState?.isPrimary && config) {
        await saveConfig(envConfig, bookKey, config, settings);
      }
    }
  };

  const isSettingsGlobal = getViewSettings(bookKey)?.isGlobal ?? true;
  if (isSettingsGlobal && !skipGlobal) {
    // Build a NEW settings object (and a NEW globalViewSettings) so the
    // settingsStore subscriber that gates replica push fires — it compares
    // `state.settings !== prev.settings`, so an in-place mutation followed
    // by setSettings(same_ref) silently bypasses the publish path and
    // whitelisted writes (userStylesheet, userUIStylesheet) only ship
    // on the next unrelated setSettings call.
    const nextSettings: SystemSettings = {
      ...settings,
      globalViewSettings: { ...settings.globalViewSettings, [key]: value },
    };
    setSettings(nextSettings);

    for (const bookKey of bookKeys) {
      await applyViewSettings(bookKey);
    }
    await saveSettings(envConfig, nextSettings);
  } else if (bookKey) {
    await applyViewSettings(bookKey);
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
