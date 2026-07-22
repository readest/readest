import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User, AuthError } from '@supabase/supabase-js';

// Mock supabase before importing the module under test
const mockSetSession = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
      getUser: () => mockGetUser(),
    },
  },
}));

import { handleAuthCallback, parseOAuthCallbackUrl } from '@/helpers/auth';

describe('parseOAuthCallbackUrl', () => {
  it('should extract error params from a failed deeplink callback', () => {
    // Real-world failing callback from issue #4881
    const url =
      'readest://auth-callback?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+c578' +
      '#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%253A+c578&sb=';

    const params = parseOAuthCallbackUrl(url);

    expect(params.error).toBe('server_error');
    expect(params.errorCode).toBe('unexpected_failure');
    expect(params.errorDescription).toContain('Unable to exchange external code');
    expect(params.accessToken).toBeNull();
    expect(params.refreshToken).toBeNull();
  });

  it('should extract tokens from a successful implicit-flow callback', () => {
    const url =
      'readest://auth-callback#access_token=abc123&refresh_token=def456&type=magiclink&next=/user';

    const params = parseOAuthCallbackUrl(url);

    expect(params.accessToken).toBe('abc123');
    expect(params.refreshToken).toBe('def456');
    expect(params.type).toBe('magiclink');
    expect(params.next).toBe('/user');
    expect(params.error).toBeNull();
  });

  it('should extract error params when present only in the query string', () => {
    const url =
      'readest://auth-callback?error=access_denied&error_code=denied&error_description=nope';

    const params = parseOAuthCallbackUrl(url);

    expect(params.error).toBe('access_denied');
    expect(params.errorCode).toBe('denied');
    expect(params.accessToken).toBeNull();
  });

  it('should return all-null params for a callback with no data', () => {
    const params = parseOAuthCallbackUrl('readest://auth-callback');

    expect(params.accessToken).toBeNull();
    expect(params.error).toBeNull();
  });
});

describe('handleAuthCallback', () => {
  let mockLogin: ReturnType<typeof vi.fn<(accessToken: string, user: User) => void>>;
  let mockNavigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  const fakeUser: User = {
    id: 'user-123',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
  } as User;

  beforeEach(() => {
    mockLogin = vi.fn<(accessToken: string, user: User) => void>();
    mockNavigate = vi.fn<(path: string) => void>();
    mockSetSession.mockReset();
    mockGetUser.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should navigate to /auth/error when error is present', async () => {
    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
      error: 'some_error',
    });

    // Wait for the async finalizeSession to complete
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('should navigate to /library when accessToken is missing', async () => {
    handleAuthCallback({
      accessToken: null,
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should navigate to /library when refreshToken is missing', async () => {
    handleAuthCallback({
      accessToken: 'token',
      refreshToken: null,
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should navigate to /library when both tokens are missing', async () => {
    handleAuthCallback({
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/library');
    });
  });

  it('should navigate to /auth/error when setSession fails', async () => {
    const sessionError: AuthError = {
      message: 'Invalid token',
      name: 'AuthError',
      status: 401,
    } as AuthError;

    mockSetSession.mockResolvedValue({ error: sessionError });

    handleAuthCallback({
      accessToken: 'bad-token',
      refreshToken: 'bad-refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'bad-token',
      refresh_token: 'bad-refresh',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should login and navigate to next URL on successful auth', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: fakeUser } });

    handleAuthCallback({
      accessToken: 'good-token',
      refreshToken: 'good-refresh',
      login: mockLogin,
      navigate: mockNavigate,
      next: '/reader',
    });

    await vi.waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('good-token', fakeUser);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/reader');
  });

  it('should default next to "/" when not specified', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: fakeUser } });

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should navigate to /auth/recovery when type is "recovery"', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: fakeUser } });

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
      type: 'recovery',
      next: '/some-page',
    });

    await vi.waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('token', fakeUser);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/auth/recovery');
    // Should NOT navigate to next when type is recovery
    expect(mockNavigate).not.toHaveBeenCalledWith('/some-page');
  });

  it('should navigate to /auth/error when getUser returns null user', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null } });

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should not call login when user is undefined from getUser', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: undefined } });

    handleAuthCallback({
      accessToken: 'token',
      refreshToken: 'refresh',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/error');
    });

    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should pass the correct session parameters to setSession', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: fakeUser } });

    handleAuthCallback({
      accessToken: 'my-access-token',
      refreshToken: 'my-refresh-token',
      login: mockLogin,
      navigate: mockNavigate,
    });

    await vi.waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'my-access-token',
        refresh_token: 'my-refresh-token',
      });
    });
  });
});
