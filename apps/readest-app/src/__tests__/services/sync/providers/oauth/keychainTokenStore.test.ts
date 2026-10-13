import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
  isSyncKeychainAvailable: vi.fn(),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn() }));

import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';
import { FileSyncError } from '@/services/sync/file/provider';
import {
  createKeychainTokenPersistence,
  KeychainTokenPersistence,
} from '@/services/sync/providers/oauth/keychainTokenStore';

const KEY = 'gdrive_token_set';
const LABEL = 'Google Drive';

const tokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 };

afterEach(() => vi.clearAllMocks());

describe('KeychainTokenPersistence', () => {
  test('save persists only the refresh token when the full set exceeds the Windows limit', async () => {
    const windowsOversizedTokens = {
      accessToken: 'A'.repeat(1_800),
      refreshToken: 'R'.repeat(600),
      expiresAt: 123,
    };
    expect(JSON.stringify(windowsOversizedTokens).length * 2).toBeGreaterThan(2_560);

    vi.mocked(setSecureItem).mockResolvedValueOnce({ success: true });
    await new KeychainTokenPersistence(KEY, LABEL).save(windowsOversizedTokens);
    expect(setSecureItem).toHaveBeenCalledWith({
      key: KEY,
      value: JSON.stringify({ refreshToken: windowsOversizedTokens.refreshToken }),
    });
  });

  test('save fails loud when the keychain rejects the refresh token', async () => {
    vi.mocked(setSecureItem).mockResolvedValueOnce({ success: false, error: 'denied' });
    await expect(new KeychainTokenPersistence(KEY, LABEL).save(tokens)).rejects.toBeInstanceOf(
      FileSyncError,
    );
  });

  test('save rejects a token set that cannot survive an app restart', async () => {
    await expect(
      new KeychainTokenPersistence(KEY, LABEL).save({ accessToken: 'AT', expiresAt: 123 }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(setSecureItem).not.toHaveBeenCalled();
  });

  test('save error message includes the provider label', async () => {
    vi.mocked(setSecureItem).mockResolvedValueOnce({ success: false, error: 'denied' });
    await expect(new KeychainTokenPersistence(KEY, LABEL).save(tokens)).rejects.toThrow(LABEL);
  });

  test('load expires a stored refresh token so the access token is reacquired', async () => {
    vi.mocked(getSecureItem).mockResolvedValueOnce({
      value: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toEqual({
      accessToken: '',
      refreshToken: 'RT',
      expiresAt: 0,
    });
  });

  test('load migrates a legacy full token set; returns null when absent or on error', async () => {
    vi.mocked(getSecureItem).mockResolvedValueOnce({ value: JSON.stringify(tokens) });
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toEqual({
      accessToken: '',
      refreshToken: 'RT',
      expiresAt: 0,
    });

    vi.mocked(getSecureItem).mockResolvedValueOnce({ error: 'no item' });
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toBeNull();

    vi.mocked(getSecureItem).mockResolvedValueOnce({});
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toBeNull();
  });

  test('load returns null for incomplete or malformed stored values', async () => {
    vi.mocked(getSecureItem).mockResolvedValueOnce({
      value: JSON.stringify({ accessToken: 'AT', expiresAt: 123 }),
    });
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toBeNull();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getSecureItem).mockResolvedValueOnce({ value: 'not json' });
    expect(await new KeychainTokenPersistence(KEY, LABEL).load()).toBeNull();
    expect(warn).toHaveBeenCalledWith(`[${LABEL}] token load failed`, expect.any(SyntaxError));
  });

  test('clear delegates to the keyed secure-KV', async () => {
    vi.mocked(clearSecureItem).mockResolvedValueOnce({ success: true });
    await new KeychainTokenPersistence(KEY, LABEL).clear();
    expect(clearSecureItem).toHaveBeenCalledWith({ key: KEY });
  });
});

describe('createKeychainTokenPersistence', () => {
  test('returns null off-Tauri (no ephemeral fallback for the refresh token)', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(await createKeychainTokenPersistence(KEY, LABEL)).toBeNull();
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('returns a keychain store when the probe reports available', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValueOnce({ available: true });
    expect(await createKeychainTokenPersistence(KEY, LABEL)).toBeInstanceOf(
      KeychainTokenPersistence,
    );
  });

  test('returns null when the keychain is unavailable', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValueOnce({ available: false });
    expect(await createKeychainTokenPersistence(KEY, LABEL)).toBeNull();
  });
});
