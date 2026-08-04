import type { KosyncProgressProvider } from './useKOSync';

/**
 * Drives the kosync progress machinery against a BookOrbit server: same
 * KOSync-compatible protocol, mounted at {server}/api/v1/koreader, with the
 * partial-MD5 digest BookOrbit matches books by.
 */
export const bookOrbitProgressProvider: KosyncProgressProvider = {
  name: 'bookorbit',
  selectConfig: (settings) => {
    const bookorbit = settings.bookorbit;
    if (
      !bookorbit.enabled ||
      !bookorbit.syncProgress ||
      !bookorbit.serverUrl ||
      !bookorbit.username ||
      !bookorbit.userkey
    ) {
      return null;
    }
    return {
      enabled: true,
      serverUrl: `${bookorbit.serverUrl.replace(/\/+$/, '')}/api/v1/koreader`,
      username: bookorbit.username,
      userkey: bookorbit.userkey,
      password: bookorbit.password,
      deviceId: bookorbit.deviceId,
      deviceName: bookorbit.deviceName,
      checksumMethod: 'binary',
      strategy: bookorbit.strategy,
    };
  },
};
