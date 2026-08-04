import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKORBIT_SETTINGS, DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { SETTINGS_ENCRYPTED_FIELDS, SETTINGS_WHITELIST } from '@/services/sync/adapters/settings';

describe('BookOrbit settings', () => {
  it('has safe defaults and is mounted on SystemSettings', () => {
    expect(DEFAULT_BOOKORBIT_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_BOOKORBIT_SETTINGS.serverUrl).toBe('');
    expect(DEFAULT_BOOKORBIT_SETTINGS.strategy).toBe('prompt');
    expect(DEFAULT_BOOKORBIT_SETTINGS.syncProgress).toBe(true);
    expect(DEFAULT_BOOKORBIT_SETTINGS.syncNotes).toBe(true);
    expect(DEFAULT_BOOKORBIT_SETTINGS.syncStats).toBe(true);
    expect(DEFAULT_BOOKORBIT_SETTINGS.syncBookStates).toBe(true);
    expect(DEFAULT_SYSTEM_SETTINGS.bookorbit).toEqual(DEFAULT_BOOKORBIT_SETTINGS);
  });

  it('replicates credentials encrypted, keeps device identity per-device', () => {
    for (const field of [
      'bookorbit.serverUrl',
      'bookorbit.username',
      'bookorbit.userkey',
      'bookorbit.password',
    ]) {
      expect(SETTINGS_WHITELIST).toContain(field);
    }
    for (const field of ['bookorbit.username', 'bookorbit.userkey', 'bookorbit.password']) {
      expect(SETTINGS_ENCRYPTED_FIELDS).toContain(field);
    }
    for (const field of ['bookorbit.enabled', 'bookorbit.deviceId', 'bookorbit.deviceName']) {
      expect(SETTINGS_WHITELIST).not.toContain(field);
    }
  });
});
