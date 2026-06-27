import { describe, expect, test, vi } from 'vitest';

vi.mock('@/app/auth/utils/nativeAuth', () => ({
  authWithCustomTab: vi.fn(async ({ authUrl }: { authUrl: string }) => {
    // The native Custom Tab echoes the redirect, with the exact `state` the
    // flow put on the consent URL.
    const state = new URL(authUrl).searchParams.get('state');
    return {
      redirectUrl: `com.googleusercontent.apps.cid:/oauthredirect?code=CODE&state=${state}`,
    };
  }),
}));

import { runAndroidOAuth } from '@/services/sync/providers/gdrive/auth/oauthAndroid';
import { authWithCustomTab } from '@/app/auth/utils/nativeAuth';
import type { FetchFn } from '@/services/sync/providers/gdrive/auth/tokenStore';

const CLIENT_ID = 'cid.apps.googleusercontent.com';

const tokenJson = (): Response =>
  new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('runAndroidOAuth', () => {
  test('opens a Custom Tab, captures the redirect, and exchanges the code', async () => {
    const fetchFn = vi.fn(async () => tokenJson()) as unknown as FetchFn;
    const tokens = await runAndroidOAuth({ clientId: CLIENT_ID, scope: 'drive.file' }, fetchFn);

    expect(authWithCustomTab).toHaveBeenCalledTimes(1);
    // The Custom Tab is handed the consent URL (with the PKCE challenge + state).
    const authUrl = vi.mocked(authWithCustomTab).mock.calls[0]![0].authUrl;
    expect(authUrl).toContain('code_challenge=');
    expect(authUrl).toContain('accounts.google.com');
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('propagates a CSRF state mismatch from the redirect', async () => {
    vi.mocked(authWithCustomTab).mockResolvedValueOnce({
      redirectUrl: 'com.googleusercontent.apps.cid:/oauthredirect?code=CODE&state=ATTACKER',
    });
    const fetchFn = vi.fn(async () => tokenJson()) as unknown as FetchFn;
    await expect(
      runAndroidOAuth({ clientId: CLIENT_ID, scope: 'drive.file' }, fetchFn),
    ).rejects.toThrow(/state mismatch/i);
  });
});
