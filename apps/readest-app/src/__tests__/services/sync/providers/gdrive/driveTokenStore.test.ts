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
  createDriveTokenPersistence,
  DRIVE_TOKEN_KEY,
  KeychainTokenPersistence,
} from '@/services/sync/providers/gdrive/driveTokenStore';

const tokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 };

afterEach(() => vi.clearAllMocks());

describe('KeychainTokenPersistence', () => {
  test('save serialises through the keyed secure-KV and fails loud on rejection', async () => {
    vi.mocked(setSecureItem).mockResolvedValueOnce({ success: true });
    await new KeychainTokenPersistence().save(tokens);
    expect(setSecureItem).toHaveBeenCalledWith({
      key: DRIVE_TOKEN_KEY,
      value: JSON.stringify(tokens),
    });

    vi.mocked(setSecureItem).mockResolvedValueOnce({ success: false, error: 'denied' });
    await expect(new KeychainTokenPersistence().save(tokens)).rejects.toBeInstanceOf(FileSyncError);
  });

  test('load parses a stored token set; returns null when absent or on error', async () => {
    vi.mocked(getSecureItem).mockResolvedValueOnce({ value: JSON.stringify(tokens) });
    expect(await new KeychainTokenPersistence().load()).toEqual(tokens);

    vi.mocked(getSecureItem).mockResolvedValueOnce({ error: 'no item' });
    expect(await new KeychainTokenPersistence().load()).toBeNull();

    vi.mocked(getSecureItem).mockResolvedValueOnce({});
    expect(await new KeychainTokenPersistence().load()).toBeNull();
  });

  test('clear delegates to the keyed secure-KV', async () => {
    vi.mocked(clearSecureItem).mockResolvedValueOnce({ success: true });
    await new KeychainTokenPersistence().clear();
    expect(clearSecureItem).toHaveBeenCalledWith({ key: DRIVE_TOKEN_KEY });
  });
});

describe('createDriveTokenPersistence', () => {
  test('returns null off-Tauri (no ephemeral fallback for the refresh token)', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(await createDriveTokenPersistence()).toBeNull();
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();
  });

  test('returns a keychain store when the probe reports available', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValueOnce({ available: true });
    expect(await createDriveTokenPersistence()).toBeInstanceOf(KeychainTokenPersistence);
  });

  test('returns null when the keychain is unavailable', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValueOnce({ available: false });
    expect(await createDriveTokenPersistence()).toBeNull();
  });
});
