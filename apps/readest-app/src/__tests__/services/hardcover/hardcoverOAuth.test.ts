import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HardcoverOAuthError,
  pollDeviceToken,
  refreshHardcoverTokens,
  type DeviceAuth,
} from '@/services/hardcover/hardcoverOAuth';

const device: DeviceAuth = {
  deviceCode: 'dc',
  userCode: 'ABCD1234',
  verificationUri: 'https://hardcover.app/link',
  verificationUriComplete: 'https://hardcover.app/link?code=ABCD1234',
  expiresIn: 900,
  interval: 5,
};
const json = (status: number, body: object) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;
const stubFetch = (...responses: Response[]) => {
  const fetchFn = vi.fn();
  responses.forEach((r) => fetchFn.mockResolvedValueOnce(r));
  fetchFn.mockResolvedValue(responses[responses.length - 1]);
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
};

afterEach(() => vi.unstubAllGlobals());

describe('pollDeviceToken', () => {
  it('keeps polling through pending/slow_down (+5s) until approved', async () => {
    stubFetch(
      json(400, { error: 'authorization_pending' }),
      json(400, { error: 'slow_down' }),
      json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const tokens = await pollDeviceToken(device, { sleep });
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 5000, 10000]);
  });

  it('rides out transient network errors but gives up after three in a row', async () => {
    const ok = json(200, { access_token: 'at', expires_in: 3600 });
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', fetchFn);
    await expect(pollDeviceToken(device, { sleep: async () => {} })).resolves.toMatchObject({
      accessToken: 'at',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(pollDeviceToken(device, { sleep: async () => {} })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it.each(['access_denied', 'expired_token'])('stops on %s', async (error) => {
    stubFetch(json(400, { error }));
    await expect(pollDeviceToken(device, { sleep: async () => {} })).rejects.toMatchObject({
      code: error,
    });
  });

  it('times out and aborts', async () => {
    stubFetch(json(400, { error: 'authorization_pending' }));
    let t = 0;
    await expect(
      pollDeviceToken(device, {
        sleep: async () => {
          t += 600_000;
        },
        now: () => t,
      }),
    ).rejects.toMatchObject({ code: 'expired_token' });

    const abort = new AbortController();
    abort.abort();
    await expect(
      pollDeviceToken(device, { signal: abort.signal, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(HardcoverOAuthError);
  });
});

describe('refreshHardcoverTokens', () => {
  const old = { accessToken: 'a', refreshToken: 'r1', expiresAt: 0 };

  it('keeps the old refresh token when not rotated, adopts a new one when rotated', async () => {
    stubFetch(json(200, { access_token: 'a2', expires_in: 3600 }));
    expect(await refreshHardcoverTokens(old)).toMatchObject({
      accessToken: 'a2',
      refreshToken: 'r1',
    });
    stubFetch(json(200, { access_token: 'a3', refresh_token: 'r2', expires_in: 3600 }));
    expect(await refreshHardcoverTokens(old)).toMatchObject({ refreshToken: 'r2' });
  });

  it('shares one request between concurrent refreshes of the same token', async () => {
    const fetchFn = stubFetch(json(200, { access_token: 'a2', expires_in: 3600 }));
    await Promise.all([refreshHardcoverTokens(old), refreshHardcoverTokens(old)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
