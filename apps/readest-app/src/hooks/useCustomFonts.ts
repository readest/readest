import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';

/**
 * Hydrate the custom-font store from persisted `settings.customFonts`.
 *
 * The reader hydrates the store inside FoliateViewer when a book opens,
 * and `useReplicaPull` hydrates it during a sync — but that pull is
 * gated on a signed-in user. Without this hook, opening Settings
 * straight from the library (no book opened, no account) leaves the
 * store empty, so imported custom fonts vanish from the Font panel
 * after an app restart until a book is opened. Mount this on the
 * library page so the panel always sees the persisted fonts.
 */
export const useCustomFonts = () => {
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { loadCustomFonts } = useCustomFontStore();

  useEffect(() => {
    if (!appService) return;
    if (!settings?.customFonts) return;
    void loadCustomFonts(envConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, settings?.customFonts, envConfig]);
};
