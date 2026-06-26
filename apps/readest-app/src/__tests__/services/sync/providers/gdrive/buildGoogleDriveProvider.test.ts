import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  isSyncKeychainAvailable: vi.fn(),
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

import { isTauriAppPlatform } from '@/services/environment';
import { isSyncKeychainAvailable } from '@/utils/bridge';
import {
  buildGoogleDriveProvider,
  getGoogleClientId,
} from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';

const CLIENT_ID = 'cid.apps.googleusercontent.com';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('buildGoogleDriveProvider', () => {
  test('falls back to the baked official client id when the env override is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    expect(getGoogleClientId()).toMatch(/\.apps\.googleusercontent\.com$/);
    // With a baked default + keychain, Drive builds even without an env override.
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: true });
    expect(await buildGoogleDriveProvider()).not.toBeNull();
  });

  test('the env override wins over the baked default', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'forked.apps.googleusercontent.com');
    expect(getGoogleClientId()).toBe('forked.apps.googleusercontent.com');
  });

  test('returns null off-Tauri (no secure token storage for the refresh token)', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(await buildGoogleDriveProvider()).toBeNull();
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('returns null when the keychain is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: false });
    expect(await buildGoogleDriveProvider()).toBeNull();
  });

  test('builds a provider when client id + keychain are available', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: true });
    const provider = await buildGoogleDriveProvider();
    expect(provider).not.toBeNull();
    expect(provider?.rootPath).toBe('/');
  });
});
