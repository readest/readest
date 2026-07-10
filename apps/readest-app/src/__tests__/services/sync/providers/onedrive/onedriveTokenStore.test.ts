import { describe, expect, test } from 'vitest';
import {
  ONEDRIVE_TOKEN_KEY,
  createOneDriveTokenPersistence,
} from '@/services/sync/providers/onedrive/onedriveTokenStore';

describe('onedriveTokenStore', () => {
  test('ONEDRIVE_TOKEN_KEY is "onedrive_token_set"', () => {
    expect(ONEDRIVE_TOKEN_KEY).toBe('onedrive_token_set');
  });

  test('createOneDriveTokenPersistence returns null off-Tauri (jsdom)', async () => {
    const result = await createOneDriveTokenPersistence();
    expect(result).toBeNull();
  });
});
