import { afterEach, describe, expect, test } from 'vitest';
import {
  buildImplicitAuthUrl,
  consumeOAuthState,
  consumeReturnPath,
  parseImplicitRedirect,
  tokenSetFromRedirect,
} from '@/services/sync/providers/gdrive/auth/webRedirectFlow';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('buildImplicitAuthUrl', () => {
  test('builds the implicit (token) authorization URL with the expected params', () => {
    const url = new URL(
      buildImplicitAuthUrl({
        clientId: 'web.cid',
        scope: 'https://www.googleapis.com/auth/drive.file',
        redirectUri: 'http://localhost:3000/gdrive-callback',
        state: 'STATE123',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('web.cid');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/gdrive-callback');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('state')).toBe('STATE123');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });
});

describe('parseImplicitRedirect', () => {
  test('parses a successful token fragment and computes a future expiry', () => {
    const before = Date.now();
    const r = parseImplicitRedirect('#access_token=AT&token_type=Bearer&expires_in=3600&state=S1');
    expect(r.accessToken).toBe('AT');
    expect(r.state).toBe('S1');
    expect(r.error).toBeUndefined();
    expect(r.expiresAt).toBeGreaterThan(before + 3000 * 1000);
    expect(tokenSetFromRedirect(r)).toEqual({ accessToken: 'AT', expiresAt: r.expiresAt });
  });

  test('parses an error fragment and yields no token', () => {
    const r = parseImplicitRedirect('#error=access_denied&state=S1');
    expect(r.error).toBe('access_denied');
    expect(r.accessToken).toBeUndefined();
    expect(tokenSetFromRedirect(r)).toBeNull();
  });
});

describe('consumeOAuthState / consumeReturnPath', () => {
  test('state is read once then cleared', () => {
    window.sessionStorage.setItem('gdrive_web_oauth_state', 'XYZ');
    expect(consumeOAuthState()).toBe('XYZ');
    expect(consumeOAuthState()).toBeNull();
  });

  test('return path falls back to "/" and rejects non-same-origin paths', () => {
    expect(consumeReturnPath()).toBe('/');
    window.sessionStorage.setItem('gdrive_web_oauth_return', '/library?q=1');
    expect(consumeReturnPath()).toBe('/library?q=1');
    window.sessionStorage.setItem('gdrive_web_oauth_return', '//evil.com');
    expect(consumeReturnPath()).toBe('/');
    window.sessionStorage.setItem('gdrive_web_oauth_return', 'https://evil.com');
    expect(consumeReturnPath()).toBe('/');
  });
});
