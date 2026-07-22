import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  exchangeCode,
  refreshAccessToken,
  type FetchFn,
} from '@/services/sync/providers/oauth/tokenEndpoint';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('tokenEndpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('exchangeCode posts the PKCE form (no client secret) and resolves a TokenSet', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    });
    const tokens = await exchangeCode(
      {
        code: 'C',
        verifier: 'V',
        clientId: 'cid',
        redirectUri: 'R',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
      },
      fetchFn,
    );
    expect(captured?.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(captured?.init.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('C');
    expect(form.get('code_verifier')).toBe('V');
    expect(form.get('client_id')).toBe('cid');
    expect(form.get('redirect_uri')).toBe('R');
    expect(form.has('client_secret')).toBe(false);
    // Date.now() pinned to 0, margin 60s, so expiry = (3600 - 60) * 1000.
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 3540 * 1000 });
  });

  test('refreshAccessToken posts a refresh grant with no redirect_uri or secret', async () => {
    let captured: { init: RequestInit } | undefined;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = { init };
      return jsonResponse({ access_token: 'AT2', expires_in: 3600 });
    });
    const tokens = await refreshAccessToken(
      { refreshToken: 'RT', clientId: 'cid', tokenEndpoint: 'https://oauth2.googleapis.com/token' },
      fetchFn,
    );
    const form = new URLSearchParams(captured?.init.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('RT');
    expect(form.get('client_id')).toBe('cid');
    expect(form.has('client_secret')).toBe(false);
    // Google omits the refresh token on refresh; the caller keeps the old one.
    expect(tokens.refreshToken).toBeUndefined();
  });

  test('clamps expiry so a token shorter than the margin is not already-expired', async () => {
    const fetchFn = async () => jsonResponse({ access_token: 'AT', expires_in: 30 });
    const tokens = await exchangeCode(
      {
        code: 'C',
        verifier: 'V',
        clientId: 'cid',
        redirectUri: 'R',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
      },
      fetchFn,
    );
    expect(tokens.expiresAt).toBe(0);
  });

  test('throws with the Google error detail on a non-2xx response', async () => {
    const fetchFn = async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'bad code' }, 400);
    await expect(
      exchangeCode(
        {
          code: 'C',
          verifier: 'V',
          clientId: 'cid',
          redirectUri: 'R',
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
        },
        fetchFn,
      ),
    ).rejects.toThrow(/HTTP 400: invalid_grant — bad code/);
  });

  test('exchangeCode posts to the given tokenEndpoint', async () => {
    let seenUrl = '';
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 }), { status: 200 });
    }) as unknown as FetchFn;
    await exchangeCode(
      {
        code: 'C',
        verifier: 'V',
        clientId: 'CID',
        redirectUri: 'r',
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      },
      fetchFn,
    );
    expect(seenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  });
});
