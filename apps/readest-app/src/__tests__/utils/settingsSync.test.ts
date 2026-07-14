import { describe, expect, test } from 'vitest';
import { mergeSyncedGlobalSettings } from '@/utils/settingsSync';
import type { SystemSettings } from '@/types/settings';

const local = {
  webdav: { enabled: false, password: 'secret' },
  googleDrive: { enabled: false },
  readestCloud: { enabled: true },
  globalViewSettings: {},
  globalReadSettings: {},
} as unknown as SystemSettings;

const globals = {
  globalViewSettings: {} as SystemSettings['globalViewSettings'],
  globalReadSettings: {} as SystemSettings['globalReadSettings'],
};

describe('mergeSyncedGlobalSettings: readestCloud', () => {
  test('adopts a broadcast Readest Cloud switch-off', () => {
    const merged = mergeSyncedGlobalSettings(local, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: true },
        googleDrive: { enabled: false },
        readestCloud: { enabled: false, disabledAt: 1234 },
      },
    });
    expect(merged.readestCloud?.enabled).toBe(false);
    expect(merged.readestCloud?.disabledAt).toBe(1234);
    // Credentials never ride the wire, and the local copy is preserved.
    expect(merged.webdav.password).toBe('secret');
  });

  test('a payload without readestCloud leaves the local value untouched', () => {
    const merged = mergeSyncedGlobalSettings(local, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: true },
        googleDrive: { enabled: false },
      },
    });
    expect(merged.readestCloud?.enabled).toBe(true);
  });
});
