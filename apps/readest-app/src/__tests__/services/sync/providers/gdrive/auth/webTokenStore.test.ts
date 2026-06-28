import { afterEach, describe, expect, test } from 'vitest';
import {
  clearWebDriveToken,
  hasValidWebDriveToken,
  loadWebDriveToken,
  saveWebDriveToken,
} from '@/services/sync/providers/gdrive/auth/webTokenStore';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('webTokenStore', () => {
  test('round-trips a token set through sessionStorage', () => {
    expect(loadWebDriveToken()).toBeNull();
    saveWebDriveToken({ accessToken: 'AT', expiresAt: 123 });
    expect(loadWebDriveToken()).toEqual({ accessToken: 'AT', expiresAt: 123 });
  });

  test('clear removes the stored token', () => {
    saveWebDriveToken({ accessToken: 'AT', expiresAt: 123 });
    clearWebDriveToken();
    expect(loadWebDriveToken()).toBeNull();
  });

  test('returns null for an unparseable stored value', () => {
    window.sessionStorage.setItem('gdrive_web_token', 'not json');
    expect(loadWebDriveToken()).toBeNull();
  });

  test('hasValidWebDriveToken reflects presence + expiry', () => {
    expect(hasValidWebDriveToken(1_000)).toBe(false); // none stored
    saveWebDriveToken({ accessToken: 'AT', expiresAt: 5_000 });
    expect(hasValidWebDriveToken(1_000)).toBe(true); // not yet expired
    expect(hasValidWebDriveToken(9_000)).toBe(false); // expired
  });
});
