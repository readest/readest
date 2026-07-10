import { describe, expect, test, vi } from 'vitest';

vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithSafari: vi.fn(async ({ authUrl }: { authUrl: string; callbackScheme?: string }) => {
    // The native web-auth session echoes the redirect, with the exact `state`
    // the flow put on the consent URL.
    const state = new URL(authUrl).searchParams.get('state');
    return {
      redirectUrl: `com.googleusercontent.apps.cid:/oauthredirect?code=CODE&state=${state}`,
    };
  }),
}));

import { runIosOAuth } from '@/services/sync/providers/oauth/oauthIos';
import { authWithSafari } from '@/app/auth/utils/nativeAuth';
import type { FetchFn } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';

const CLIENT_ID = 'cid.apps.googleusercontent.com';

const CONFIG: OAuthClientConfig = {
  clientId: CLIENT_ID,
  scope: 'drive.file',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  redirectUri: 'com.googleusercontent.apps.cid:/oauthredirect',
  redirectScheme: 'com.googleusercontent.apps.cid',
  authParams: { access_type: 'offline', prompt: 'consent' },
};

const tokenJson = (): Response =>
  new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('runIosOAuth', () => {
  test('opens a web-auth session keyed to the reverse-DNS scheme and exchanges the code', async () => {
    const fetchFn = vi.fn(async () => tokenJson()) as unknown as FetchFn;
    const tokens = await runIosOAuth(CONFIG, fetchFn);

    expect(authWithSafari).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(authWithSafari).mock.calls[0]![0];
    // The session is handed the consent URL (with the PKCE challenge + state)...
    expect(arg.authUrl).toContain('code_challenge=');
    expect(arg.authUrl).toContain('accounts.google.com');
    // ...and the bare reverse-DNS callback scheme (no path) it must intercept.
    expect(arg.callbackScheme).toBe('com.googleusercontent.apps.cid');
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('propagates a CSRF state mismatch from the redirect', async () => {
    vi.mocked(authWithSafari).mockResolvedValueOnce({
      redirectUrl: 'com.googleusercontent.apps.cid:/oauthredirect?code=CODE&state=ATTACKER',
    });
    const fetchFn = vi.fn(async () => tokenJson()) as unknown as FetchFn;
    await expect(runIosOAuth(CONFIG, fetchFn)).rejects.toThrow(/state mismatch/i);
  });
});
