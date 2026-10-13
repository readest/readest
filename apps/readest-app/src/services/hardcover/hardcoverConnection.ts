import type { EnvConfigType } from '@/services/environment';
import type { HardcoverSettings } from '@/types/settings';
import type { TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { HardcoverTokenStore } from './HardcoverClient';
import { useSettingsStore } from '@/store/settingsStore';

export const isHardcoverConnected = (h?: HardcoverSettings): h is HardcoverSettings =>
  !!(h?.accessToken || h?.oauth?.accessToken);

/**
 * Persists refreshed OAuth tokens; re-reads settings so concurrent edits aren't clobbered.
 * `previous` is what the refresh started from: if the stored tokens differ, the session was
 * disconnected or replaced meanwhile, and this stale result must not overwrite it.
 */
export const saveHardcoverTokens = async (
  envConfig: EnvConfigType,
  oauth: TokenSet,
  previous: TokenSet,
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const stored = settings.hardcover?.oauth;
  if (
    stored?.accessToken !== previous.accessToken ||
    stored.refreshToken !== previous.refreshToken
  ) {
    return;
  }
  const newSettings = { ...settings, hardcover: { ...settings.hardcover, oauth } };
  setSettings(newSettings);
  await saveSettings(envConfig, newSettings);
};

export const createHardcoverTokenStore = (envConfig: EnvConfigType): HardcoverTokenStore => ({
  load: () => useSettingsStore.getState().settings.hardcover?.oauth,
  save: (tokens, previous) => saveHardcoverTokens(envConfig, tokens, previous),
});

/** Reopens Settings → Integrations → Hardcover once the user is back on the page they came from. */
export const stashHardcoverReturnTarget = () => {
  const { setRequestedPanel, setRequestedSubPage, setSettingsDialogOpen } =
    useSettingsStore.getState();
  setRequestedPanel('Integrations');
  setRequestedSubPage('hardcover');
  setSettingsDialogOpen(true);
};
