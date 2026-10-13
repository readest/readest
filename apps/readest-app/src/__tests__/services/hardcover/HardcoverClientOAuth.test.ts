import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HardcoverOAuthError } from '@/services/hardcover/hardcoverOAuth';
import { TokenEndpointError } from '@/services/sync/providers/oauth/tokenEndpoint';
import { HardcoverAuthError, HardcoverClient } from '@/services/hardcover/HardcoverClient';
import type { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/services/hardcover/hardcoverOAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/hardcover/hardcoverOAuth')>()),
  refreshHardcoverTokens: refresh,
}));

type Api = { minRequestIntervalMs: number; request: (q: string, v: object) => Promise<unknown> };

const res = (status: number) =>
  ({
    ok: status < 400,
    status,
    headers: new Headers(),
    json: async () => ({ data: { ok: true } }),
  }) as Response;

describe('HardcoverClient OAuth', () => {
  const fresh = { accessToken: 'new', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 };
  let fetchMock: ReturnType<typeof vi.fn>;
  const make = (
    expiresAt: number,
    onRefreshed = vi.fn(),
    load: () => typeof fresh | undefined = () => undefined,
  ) => {
    const c = new HardcoverClient(
      { accessToken: '', oauth: { accessToken: 'old', refreshToken: 'rt', expiresAt } },
      {} as HardcoverSyncMapStore,
      { load, save: onRefreshed },
    );
    (c as unknown as Api).minRequestIntervalMs = 0;
    return { api: c as unknown as Api, onRefreshed };
  };
  const authHeaders = () => fetchMock.mock.calls.map((c) => c[1].headers.authorization);

  beforeEach(() => {
    refresh.mockReset().mockResolvedValue(fresh);
    fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('refreshes an expired token once for concurrent requests and persists it', async () => {
    const { api, onRefreshed } = make(0);
    await Promise.all([api.request('q', {}), api.request('q', {})]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith(
      fresh,
      expect.objectContaining({ accessToken: 'old' }),
    );
    expect(authHeaders()).toEqual(['Bearer new', 'Bearer new']);
  });

  it('uses a valid token as is, and refreshes then retries once on 401', async () => {
    const { api } = make(Date.now() + 3_600_000);
    await api.request('q', {});
    expect(refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(res(401));
    await api.request('q', {});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(authHeaders().slice(1)).toEqual(['Bearer old', 'Bearer new']);
  });

  it('throws HardcoverAuthError when refresh is refused or the retry is still 401', async () => {
    for (const dead of [
      // What Hardcover's token endpoint returns for an unknown or revoked refresh token.
      new TokenEndpointError('refresh failed', 400, 'invalid_grant'),
      new TokenEndpointError('refresh failed', 400, 'invalid_token'),
      new TokenEndpointError('refresh failed', 401, 'invalid_token'),
      new HardcoverOAuthError('no_refresh_token'),
    ]) {
      refresh.mockRejectedValueOnce(dead);
      await expect(make(0).api.request('q', {})).rejects.toBeInstanceOf(HardcoverAuthError);
    }

    fetchMock.mockResolvedValue(res(401));
    await expect(make(Date.now() + 3_600_000).api.request('q', {})).rejects.toBeInstanceOf(
      HardcoverAuthError,
    );
  });

  it.each([
    new TokenEndpointError('server error', 503),
    new TokenEndpointError('malformed', 400, 'Malformed request body'),
    new TypeError('Failed to fetch'),
  ])('does not treat %s during refresh as a dead login', async (error) => {
    refresh.mockRejectedValueOnce(error);
    await expect(make(0).api.request('q', {})).rejects.toBe(error);
  });

  it('keeps using the refreshed token when persisting it fails', async () => {
    const { api } = make(0, vi.fn().mockRejectedValue(new Error('disk full')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await api.request('q', {});
    expect(authHeaders()).toEqual(['Bearer new']);
  });

  it('adopts newer stored tokens instead of spending a stale refresh token', async () => {
    const { api } = make(0, vi.fn(), () => fresh);
    await api.request('q', {});
    expect(refresh).not.toHaveBeenCalled();
    expect(authHeaders()).toEqual(['Bearer new']);
  });

  it('retries a failed save on the next request, still comparing against the stored tokens', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { api } = make(0, save);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await api.request('q', {});
    await api.request('q', {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([fresh, expect.objectContaining({ accessToken: 'old' })]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
