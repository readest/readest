import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn() }));

import { isTauriAppPlatform } from '@/services/environment';
import {
  createDriveTokenPersistence,
  DRIVE_TOKEN_KEY,
} from '@/services/sync/providers/gdrive/driveTokenStore';

afterEach(() => vi.clearAllMocks());

describe('driveTokenStore', () => {
  test('DRIVE_TOKEN_KEY is the stable Drive keychain slot', () => {
    expect(DRIVE_TOKEN_KEY).toBe('gdrive_token_set');
  });

  test('createDriveTokenPersistence returns null off-Tauri', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(await createDriveTokenPersistence()).toBeNull();
  });
});
