import { describe, expect, test } from 'vitest';
import { buildGoogleOAuthConfig } from '@/services/sync/providers/gdrive/googleOAuthConfig';

describe('buildGoogleOAuthConfig', () => {
  test('derives the reverse-DNS redirect and Google endpoints from the client id', () => {
    const cfg = buildGoogleOAuthConfig(
      '209390247301-abc.apps.googleusercontent.com',
      'https://www.googleapis.com/auth/drive.file',
    );
    expect(cfg.redirectUri).toBe('com.googleusercontent.apps.209390247301-abc:/oauthredirect');
    expect(cfg.redirectScheme).toBe('com.googleusercontent.apps.209390247301-abc');
    expect(cfg.authEndpoint).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(cfg.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
    expect(cfg.authParams).toEqual({ access_type: 'offline', prompt: 'consent' });
  });
});
