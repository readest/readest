import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FetchFn } from '@/services/sync/providers/oauth/tokenEndpoint';
import {
  WEB_OAUTH_CALLBACK_PATH,
  beginWebOneDriveRedirect,
  clearWebOneDriveToken,
  consumeReturnPath,
  consumeWebOAuthState,
  consumeWebPkceVerifier,
  exchangeWebAuthCode,
  hasValidWebOneDriveToken,
  loadWebOneDriveToken,
  oneDriveWebRedirectUri,
  saveWebOneDriveToken,
  webOneDriveTokenPersistence,
} from '@/services/sync/providers/onedrive/webAuthCodeFlow';

beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000', assign: vi.fn() },
    writable: true,
  });
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('oneDriveWebRedirectUri', () => {
  test('builds the callback URI from the current origin', () => {
    expect(oneDriveWebRedirectUri()).toBe(`http://localhost:3000${WEB_OAUTH_CALLBACK_PATH}`);
    expect(WEB_OAUTH_CALLBACK_PATH).toBe('/onedrive-callback');
  });
});

describe('beginWebOneDriveRedirect', () => {
  test('mints + stores a PKCE verifier, state, and return path, then redirects with an auth-code URL', async () => {
    void beginWebOneDriveRedirect({ clientId: 'web-client-id', returnPath: '/library?x=1' });

    await vi.waitFor(() => {
      expect(window.location.assign).toHaveBeenCalled();
    });

    const verifier = window.sessionStorage.getItem('onedrive_web_oauth_verifier');
    const state = window.sessionStorage.getItem('onedrive_web_oauth_state');
    const returnPath = window.sessionStorage.getItem('onedrive_web_oauth_return');
    expect(verifier).toBeTruthy();
    expect(state).toBeTruthy();
    expect(returnPath).toBe('/library?x=1');

    const assignMock = window.location.assign as unknown as ReturnType<typeof vi.fn>;
    const url = new URL(assignMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('web-client-id');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('redirect_uri')).toBe(oneDriveWebRedirectUri());
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  test('the returned promise never resolves (navigation unloads the page)', async () => {
    const promise = beginWebOneDriveRedirect({ clientId: 'cid', returnPath: '/' });
    const raced = await Promise.race([
      promise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 20)),
    ]);
    expect(raced).toBe('timeout');
  });
});

describe('consumeWebOAuthState / consumeWebPkceVerifier / consumeReturnPath', () => {
  test('state is read once then cleared', () => {
    window.sessionStorage.setItem('onedrive_web_oauth_state', 'STATE1');
    expect(consumeWebOAuthState()).toBe('STATE1');
    expect(consumeWebOAuthState()).toBeNull();
  });

  test('verifier is read once then cleared', () => {
    window.sessionStorage.setItem('onedrive_web_oauth_verifier', 'VERIFIER1');
    expect(consumeWebPkceVerifier()).toBe('VERIFIER1');
    expect(consumeWebPkceVerifier()).toBeNull();
  });

  test('return path falls back to "/" and rejects non-same-origin paths', () => {
    expect(consumeReturnPath()).toBe('/');
    window.sessionStorage.setItem('onedrive_web_oauth_return', '/library?q=1');
    expect(consumeReturnPath()).toBe('/library?q=1');
    window.sessionStorage.setItem('onedrive_web_oauth_return', '//evil.com');
    expect(consumeReturnPath()).toBe('/');
    window.sessionStorage.setItem('onedrive_web_oauth_return', 'https://evil.com');
    expect(consumeReturnPath()).toBe('/');
  });
});

describe('exchangeWebAuthCode', () => {
  test('POSTs to the MS token endpoint with grant_type=authorization_code + code_verifier', async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
      }),
    } as Response);

    const tokens = await exchangeWebAuthCode({
      clientId: 'web-client-id',
      code: 'AUTH_CODE',
      verifier: 'VERIFIER',
      redirectUri: 'http://localhost:3000/onedrive-callback',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [endpoint, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(endpoint).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('AUTH_CODE');
    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.get('client_id')).toBe('web-client-id');
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/onedrive-callback');

    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('web token store', () => {
  test('round-trips a token set through sessionStorage', () => {
    expect(loadWebOneDriveToken()).toBeNull();
    saveWebOneDriveToken({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 });
    expect(loadWebOneDriveToken()).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 123,
    });
  });

  test('clear removes the stored token', () => {
    saveWebOneDriveToken({ accessToken: 'AT', expiresAt: 123 });
    clearWebOneDriveToken();
    expect(loadWebOneDriveToken()).toBeNull();
  });

  test('returns null for an unparseable stored value', () => {
    window.sessionStorage.setItem('onedrive_web_token', 'not json');
    expect(loadWebOneDriveToken()).toBeNull();
  });

  test('hasValidWebOneDriveToken reflects presence + expiry', () => {
    expect(hasValidWebOneDriveToken(1_000)).toBe(false); // none stored
    saveWebOneDriveToken({ accessToken: 'AT', expiresAt: 5_000 });
    expect(hasValidWebOneDriveToken(1_000)).toBe(true); // not yet expired
    expect(hasValidWebOneDriveToken(9_000)).toBe(false); // expired
  });
});

describe('webOneDriveTokenPersistence', () => {
  test('load/save/clear round-trip through sessionStorage', async () => {
    expect(await webOneDriveTokenPersistence.load()).toBeNull();

    await webOneDriveTokenPersistence.save({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 999,
    });
    expect(await webOneDriveTokenPersistence.load()).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 999,
    });
    expect(window.sessionStorage.getItem('onedrive_web_token')).toBeTruthy();

    await webOneDriveTokenPersistence.clear();
    expect(await webOneDriveTokenPersistence.load()).toBeNull();
  });
});
