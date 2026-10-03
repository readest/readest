import type { EnvConfigType } from '@/services/environment';
import type { HardcoverSettings } from '@/types/settings';
import type { TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { HardcoverTokenStore } from './HardcoverClient';
import { useSettingsStore } from '@/store/settingsStore';

export const isHardcoverConnected = (h?: HardcoverSettings): h is HardcoverSettings =>
  !!(h?.accessToken || h?.oauth?.accessToken);

/**
 * Persists refreshed OAuth tokens; re-reads settings so concurrent edits aren't clobbered.
 * Skipped when the session was disconnected meanwhile, so revoked tokens don't come back.
 */
export const saveHardcoverTokens = async (envConfig: EnvConfigType, oauth: TokenSet) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (!settings.hardcover?.oauth) return;
  const newSettings = { ...settings, hardcover: { ...settings.hardcover, oauth } };
  setSettings(newSettings);
  await saveSettings(envConfig, newSettings);
};

export const createHardcoverTokenStore = (envConfig: EnvConfigType): HardcoverTokenStore => ({
  load: () => useSettingsStore.getState().settings.hardcover?.oauth,
  save: (tokens) => saveHardcoverTokens(envConfig, tokens),
});

/** Reopens Settings → Integrations → Hardcover once the user is back on the page they came from. */
export const stashHardcoverReturnTarget = () => {
  const { setRequestedPanel, setRequestedSubPage, setSettingsDialogOpen } =
    useSettingsStore.getState();
  setRequestedPanel('Integrations');
  setRequestedSubPage('hardcover');
  setSettingsDialogOpen(true);
};
