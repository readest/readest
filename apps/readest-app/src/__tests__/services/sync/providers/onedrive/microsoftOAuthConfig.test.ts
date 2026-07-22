import { describe, expect, test } from 'vitest';
import {
  buildMicrosoftOAuthConfig,
  isOneDriveOAuthRedirectUrl,
} from '@/services/sync/providers/onedrive/microsoftOAuthConfig';

describe('microsoftOAuthConfig', () => {
  test('builds the Microsoft OAuth config with the custom-scheme redirect', () => {
    const cfg = buildMicrosoftOAuthConfig('CID');
    expect(cfg.clientId).toBe('CID');
    expect(cfg.scope).toBe('Files.ReadWrite.AppFolder offline_access User.Read');
    expect(cfg.authEndpoint).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(cfg.tokenEndpoint).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(cfg.redirectUri).toBe('readest-onedrive://auth');
    expect(cfg.redirectScheme).toBe('readest-onedrive');
    expect(cfg.authParams).toEqual({ prompt: 'select_account' });
  });

  test('isOneDriveOAuthRedirectUrl flags the OneDrive redirect scheme', () => {
    expect(isOneDriveOAuthRedirectUrl('readest-onedrive://auth?code=x&state=y')).toBe(true);
    expect(isOneDriveOAuthRedirectUrl('readest://auth-callback')).toBe(false);
    expect(isOneDriveOAuthRedirectUrl('file:///Users/me/book.epub')).toBe(false);
  });
});
