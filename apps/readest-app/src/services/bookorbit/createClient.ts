// One client for the BookOrbit server the user has already configured.
//
// Deliberately the `settings.bookorbit` row the KOReader sync integration
// fills in, not a second server type: the audiobook API and the sync API live
// on the same host behind the same credentials, and asking for them twice
// would be the bug this whole connector exists to avoid.
import { useSettingsStore } from '@/store/settingsStore';
import { BookOrbitClient } from './client';

export const createBookOrbitClient = (): BookOrbitClient | null => {
  const { bookorbit } = useSettingsStore.getState().settings;
  if (!bookorbit?.serverUrl || !bookorbit.password) return null;
  return new BookOrbitClient(
    {
      serverUrl: bookorbit.serverUrl,
      username: bookorbit.username,
      password: bookorbit.password,
      customHeaders: bookorbit.customHeaders,
    },
    // Cached for the life of this client only; the settings row holds the
    // credentials, and a 15-minute token is not worth persisting.
    { onTokensUpdated: () => {} },
  );
};
