import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  CodeSignInError,
  pollSignInSession,
  requestSignInCode,
  type SignInCode,
} from '@/app/auth/utils/codeSignIn';
import { getAPIBaseUrl } from '@/services/environment';

/**
 * Sign-in with a code, as KOReader's Readest > Sign in with a code does it: the
 * app asks /auth/device/code for a code, shows it, and asks
 * /auth/device/token for a session until a device signed in to Readest
 * approves the code on /link.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const code: SignInCode = {
  deviceCode: 'device-secret',
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://web.readest.com/link',
  verificationUriComplete: 'https://web.readest.com/link?code=BCDF-GHJK',
  expiresIn: 600,
  interval: 5,
};

const session = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  expires_at: 1,
  token_type: 'bearer',
  user: { id: 'u1', email: 'reader@example.com', user_metadata: {} },
};

const noSleep = vi.fn(async () => {});

afterEach(() => {
  vi.unstubAllGlobals();
  noSleep.mockClear();
});

describe('requestSignInCode', () => {
  test('starts a sign-in and returns the code to show', async () => {
    const fetch = vi.fn(async () =>
      json(200, {
        device_code: 'device-secret',
        user_code: 'BCDF-GHJK',
        verification_uri: 'https://web.readest.com/link',
        verification_uri_complete: 'https://web.readest.com/link?code=BCDF-GHJK',
        expires_in: 600,
        interval: 5,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    expect(await requestSignInCode()).toEqual(code);
    expect(fetch).toHaveBeenCalledWith(`${getAPIBaseUrl()}/auth/device/code`, {
      method: 'POST',
    });
  });

  test('fails when the server gives no code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { error: 'server_error' })),
    );
    await expect(requestSignInCode()).rejects.toThrow(new CodeSignInError('request_failed'));
  });
});

describe('pollSignInSession', () => {
  test('asks for a session every interval until the code is approved', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(json(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(json(200, session));
    vi.stubGlobal('fetch', fetch);

    expect(await pollSignInSession(code, { sleep: noSleep })).toEqual({
      access_token: 'access',
      refresh_token: 'refresh',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(noSleep).toHaveBeenCalledTimes(3);
    expect(noSleep).toHaveBeenCalledWith(5000);
    expect(fetch).toHaveBeenCalledWith(`${getAPIBaseUrl()}/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'device-secret', grant: 'session' }),
    });
  });

  test('keeps asking through network and server errors', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(500, { error: 'server_error' }))
      .mockResolvedValueOnce(json(200, session));
    vi.stubGlobal('fetch', fetch);

    await expect(pollSignInSession(code, { sleep: noSleep })).resolves.toEqual({
      access_token: 'access',
      refresh_token: 'refresh',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('stops when the server says the code expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(400, { error: 'expired_token' })),
    );
    await expect(pollSignInSession(code, { sleep: noSleep })).rejects.toThrow(
      new CodeSignInError('expired_token'),
    );
  });

  test('stops once the code has outlived its expiry, without asking again', async () => {
    let t = 0;
    const fetch = vi.fn(async () => json(400, { error: 'authorization_pending' }));
    vi.stubGlobal('fetch', fetch);
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });

    await expect(pollSignInSession(code, { sleep, now: () => t })).rejects.toThrow(
      new CodeSignInError('expired_token'),
    );
    // 600 s at one ask per 5 s: the ask at 600 s is past the expiry.
    expect(fetch).toHaveBeenCalledTimes(119);
  });

  test('gives up on an ask that never answers once the code expires', async () => {
    // A stalled connection: no answer, no error.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await expect(
      pollSignInSession({ ...code, expiresIn: 0.05, interval: 0.001 }, { sleep: noSleep }),
    ).rejects.toThrow(new CodeSignInError('expired_token'));
  });

  test('stops when the sign-in is cancelled', async () => {
    const abort = new AbortController();
    const fetch = vi.fn(async () => {
      abort.abort();
      return json(400, { error: 'authorization_pending' });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(pollSignInSession(code, { sleep: noSleep, signal: abort.signal })).rejects.toThrow(
      new CodeSignInError('aborted'),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
