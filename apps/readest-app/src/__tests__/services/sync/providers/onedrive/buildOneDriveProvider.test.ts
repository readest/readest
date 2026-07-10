import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(),
  isWebAppPlatform: vi.fn(),
}));
vi.mock('@/utils/bridge', () => ({
  isSyncKeychainAvailable: vi.fn(),
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { isSyncKeychainAvailable } from '@/utils/bridge';
import {
  buildOneDriveProvider,
  getMicrosoftClientId,
} from '@/services/sync/providers/onedrive/buildOneDriveProvider';

const CLIENT_ID = 'ms-client-id';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('buildOneDriveProvider', () => {
  test('falls back to the baked official client id when the env override is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', '');
    // The baked default is a GUID (the Azure Application (client) ID).
    expect(getMicrosoftClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // With a baked default + keychain, OneDrive builds even without an env override.
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: true });
    expect(await buildOneDriveProvider()).not.toBeNull();
  });

  test('the env override wins over the baked default', () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', CLIENT_ID);
    expect(getMicrosoftClientId()).toBe(CLIENT_ID);
  });

  test('web: builds a provider when a client id is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', CLIENT_ID);
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    const provider = await buildOneDriveProvider();
    expect(provider).not.toBeNull();
    expect(provider?.rootPath).toBe('/');
    // The web path never touches the keychain.
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('web: builds with the baked client id when the env override is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', '');
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    const provider = await buildOneDriveProvider();
    expect(provider).not.toBeNull();
    expect(provider?.rootPath).toBe('/');
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('returns null off-Tauri (no secure token storage for the refresh token)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', CLIENT_ID);
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(await buildOneDriveProvider()).toBeNull();
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('returns null when the keychain is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', CLIENT_ID);
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: false });
    expect(await buildOneDriveProvider()).toBeNull();
  });

  test('builds a provider when client id + keychain are available', async () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', CLIENT_ID);
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: true });
    const provider = await buildOneDriveProvider();
    expect(provider).not.toBeNull();
    expect(provider?.rootPath).toBe('/');
  });
});
