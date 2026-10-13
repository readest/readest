import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Hydrate the settings store on routes that can be entered cold.
 *
 * Most surfaces reach the store already populated, because the library page
 * loads settings on the way in. A route opened directly — a refreshed /user,
 * a deep link, the OAuth return to /auth — never does, and the store's initial
 * value is an empty object. Anything reading it then reads defaults instead of
 * the user's real settings: a sync toggle shows ON over a stored OFF, and
 * writing that object back persists an almost-empty settings file over the
 * real one.
 *
 * Returns whether the store is hydrated, so callers can hold off rendering
 * settings-derived state rather than flashing a wrong value.
 */
export const useEnsureSettingsLoaded = (): boolean => {
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const hydrated = !!settings?.version;

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const appService = await envConfig.getAppService();
        const loaded = await appService.loadSettings();
        if (!cancelled) setSettings(loaded);
      } catch (error) {
        // Leave the store unhydrated: callers keep their settings-derived UI
        // hidden, which is the safe outcome. Rendering defaults over real
        // values is what this hook exists to prevent.
        console.error('Failed to load settings:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envConfig, hydrated, setSettings]);

  return hydrated;
};
