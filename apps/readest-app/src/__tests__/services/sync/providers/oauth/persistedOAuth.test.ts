import { describe, expect, test, vi } from 'vitest';
import { PersistedOAuth } from '@/services/sync/providers/oauth/persistedOAuth';
import type { FetchFn, TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { TokenPersistence } from '@/services/sync/providers/oauth/keychainTokenStore';

const TOKEN_ENDPOINT = 'https://example.com/token';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makePersistence = (initial: TokenSet | null = null) => {
  let stored = initial;
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (t: TokenSet) => {
      stored = t;
    }),
    clear: vi.fn(async () => {
      stored = null;
    }),
  } satisfies TokenPersistence & { save: ReturnType<typeof vi.fn> };
};

/** Stub account-label resolver: the shared class only needs to delegate to it. */
const stubResolveAccountLabel = vi.fn(async () => 'stub-label');

describe('PersistedOAuth', () => {
  test('returns the seeded access token without any network or load', async () => {
    const fetchFn = vi.fn();
    const persistence = makePersistence();
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: fetchFn as unknown as FetchFn,
      persistence,
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
      initialTokens: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 },
      now: () => 500,
    });
    expect(await auth.getAccessToken()).toBe('AT');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(persistence.load).not.toHaveBeenCalled();
  });

  test('lazily loads tokens from persistence when not seeded', async () => {
    const persistence = makePersistence({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 });
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: vi.fn() as unknown as FetchFn,
      persistence,
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
      now: () => 500,
    });
    expect(await auth.getAccessToken()).toBe('AT');
    expect(persistence.load).toHaveBeenCalledTimes(1);
  });

  test('refreshes an expired token, carries the old refresh token forward, saves once', async () => {
    const persistence = makePersistence();
    // Some providers (e.g. Google) omit refresh_token on a refresh response.
    const fetchFn = vi.fn(async () => json({ access_token: 'AT2', expires_in: 3600 }));
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: fetchFn as unknown as FetchFn,
      persistence,
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
      initialTokens: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 0 },
      now: () => 1000,
    });
    expect(await auth.getAccessToken()).toBe('AT2');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledTimes(1);
    const saved = persistence.save.mock.calls[0]![0] as TokenSet;
    expect(saved).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT' });
  });

  test('collapses concurrent refreshes into a single network call + single save', async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const persistence = makePersistence();
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: fetchFn as unknown as FetchFn,
      persistence,
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
      initialTokens: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 0 },
      now: () => 1000,
    });

    const p1 = auth.getAccessToken();
    const p2 = auth.getAccessToken();
    const p3 = auth.getAccessToken();
    resolveFetch(json({ access_token: 'AT2', expires_in: 3600 }));
    expect(await Promise.all([p1, p2, p3])).toEqual(['AT2', 'AT2', 'AT2']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledTimes(1);
  });

  test('throws AUTH_FAILED naming the provider when there are no tokens at all', async () => {
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: vi.fn() as unknown as FetchFn,
      persistence: makePersistence(null),
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
    });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(auth.getAccessToken()).rejects.toThrow(/Test is not connected/);
  });

  test('throws AUTH_FAILED when expired with no refresh token', async () => {
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: vi.fn() as unknown as FetchFn,
      persistence: makePersistence(),
      providerLabel: 'Test',
      resolveAccountLabel: stubResolveAccountLabel,
      initialTokens: { accessToken: 'AT', expiresAt: 0 },
      now: () => 1000,
    });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('accountLabel delegates to the injected resolver with the current access token', async () => {
    const resolveAccountLabel = vi.fn(async (accessToken: string) => `label-for-${accessToken}`);
    const auth = new PersistedOAuth({
      clientId: 'cid',
      tokenEndpoint: TOKEN_ENDPOINT,
      fetchFn: vi.fn() as unknown as FetchFn,
      persistence: makePersistence(),
      providerLabel: 'Test',
      resolveAccountLabel,
      initialTokens: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9999 },
      now: () => 0,
    });
    expect(await auth.accountLabel()).toBe('label-for-AT');
    expect(resolveAccountLabel).toHaveBeenCalledWith('AT', expect.any(Function));
  });
});
