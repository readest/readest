import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRefreshSession, mockGetSession } = vi.hoisted(() => ({
  mockRefreshSession: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      refreshSession: mockRefreshSession,
      getSession: mockGetSession,
      getUser: vi.fn(),
    },
  },
  createSupabaseClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => true,
  getAPIBaseUrl: () => 'http://localhost',
}));

vi.mock('@/services/translators/utils', () => ({
  getDailyUsage: () => 0,
}));

import { getAccessToken } from '@/utils/access';

const b64url = (s: string) =>
  Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const makeJwt = (expSeconds: number) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ exp: expSeconds }))}.${b64url('sig')}`;

describe('getAccessToken (web)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRefreshSession.mockReset();
    mockGetSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns null when no token is present', async () => {
    expect(await getAccessToken()).toBeNull();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  test('returns the cached token when it is not near expiry', async () => {
    const fresh = makeJwt(Math.floor(Date.now() / 1000) + 60 * 60);
    localStorage.setItem('token', fresh);

    expect(await getAccessToken()).toBe(fresh);
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  test('refreshes when the token is already expired and returns the new token', async () => {
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 60);
    const refreshed = makeJwt(Math.floor(Date.now() / 1000) + 60 * 60);
    localStorage.setItem('token', expired);

    mockRefreshSession.mockImplementation(async () => {
      localStorage.setItem('token', refreshed);
      return { data: { session: { access_token: refreshed } }, error: null };
    });

    const result = await getAccessToken();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(result).toBe(refreshed);
  });

  test('refreshes when the token expires within the leeway window', async () => {
    const nearExpiry = makeJwt(Math.floor(Date.now() / 1000) + 10);
    const refreshed = makeJwt(Math.floor(Date.now() / 1000) + 60 * 60);
    localStorage.setItem('token', nearExpiry);

    mockRefreshSession.mockImplementation(async () => {
      localStorage.setItem('token', refreshed);
      return { data: { session: { access_token: refreshed } }, error: null };
    });

    const result = await getAccessToken();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(result).toBe(refreshed);
  });

  test('falls back to the stale token if refresh fails (server will reject — at least we do not silently drop it)', async () => {
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 60);
    localStorage.setItem('token', expired);

    mockRefreshSession.mockRejectedValue(new Error('network'));

    const result = await getAccessToken();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(result).toBe(expired);
  });

  test('treats an unparseable token as needing refresh', async () => {
    localStorage.setItem('token', 'not-a-jwt');
    const refreshed = makeJwt(Math.floor(Date.now() / 1000) + 60 * 60);

    mockRefreshSession.mockImplementation(async () => {
      localStorage.setItem('token', refreshed);
      return { data: { session: { access_token: refreshed } }, error: null };
    });

    const result = await getAccessToken();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(result).toBe(refreshed);
  });
});
