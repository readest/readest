import { describe, expect, it } from 'vitest';
import { bookOrbitProgressProvider } from '@/app/reader/hooks/bookOrbitProgressProvider';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { BookOrbitSettings, SystemSettings } from '@/types/settings';

const makeSettings = (overrides: Partial<BookOrbitSettings>): SystemSettings =>
  ({
    ...DEFAULT_SYSTEM_SETTINGS,
    bookorbit: {
      ...DEFAULT_SYSTEM_SETTINGS.bookorbit,
      enabled: true,
      syncProgress: true,
      serverUrl: 'https://books.example.com/',
      username: 'alice',
      userkey: 'k'.repeat(32),
      deviceId: 'device-1',
      deviceName: 'My Device',
      strategy: 'silent',
      ...overrides,
    },
  }) as SystemSettings;

describe('bookOrbitProgressProvider.selectConfig', () => {
  it('derives a kosync config pointed at the KOSync-compatible API path', () => {
    const config = bookOrbitProgressProvider.selectConfig(makeSettings({}));
    expect(config).toEqual({
      enabled: true,
      serverUrl: 'https://books.example.com/api/v1/koreader',
      username: 'alice',
      userkey: 'k'.repeat(32),
      password: undefined,
      deviceId: 'device-1',
      deviceName: 'My Device',
      checksumMethod: 'binary',
      strategy: 'silent',
    });
  });

  it('returns null when disabled, progress sync is off, or credentials are missing', () => {
    expect(bookOrbitProgressProvider.selectConfig(makeSettings({ enabled: false }))).toBeNull();
    expect(
      bookOrbitProgressProvider.selectConfig(makeSettings({ syncProgress: false })),
    ).toBeNull();
    expect(bookOrbitProgressProvider.selectConfig(makeSettings({ username: '' }))).toBeNull();
    expect(bookOrbitProgressProvider.selectConfig(makeSettings({ userkey: '' }))).toBeNull();
    expect(bookOrbitProgressProvider.selectConfig(makeSettings({ serverUrl: '' }))).toBeNull();
  });
});
