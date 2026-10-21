import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaimsMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getClaims: getClaimsMock, getUser: getUserMock } },
}));

import { validateUserAndToken } from '@/utils/access';

const claimsResult = (claims: Record<string, unknown>) => ({
  data: { claims, header: {}, signature: new Uint8Array() },
  error: null,
});

describe('validateUserAndToken', () => {
  beforeEach(() => {
    getClaimsMock.mockReset();
    getUserMock.mockReset();
  });

  it('builds the user from verified claims without a GET /auth/v1/user call', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({ sub: 'user-123', email: 'reader@example.com', role: 'authenticated' }),
    );
    const result = await validateUserAndToken('Bearer token-abc');
    expect(getClaimsMock).toHaveBeenCalledWith('token-abc');
    expect(getUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      user: { id: 'user-123', email: 'reader@example.com' },
      token: 'token-abc',
    });
  });

  it('rejects tokens that fail verification', async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: new Error('Invalid JWT signature') });
    expect(await validateUserAndToken('Bearer bad')).toEqual({});
  });

  it('rejects expired tokens, which getClaims throws on instead of returning an error', async () => {
    getClaimsMock.mockRejectedValue(new Error('JWT has expired'));
    expect(await validateUserAndToken('Bearer expired')).toEqual({});
  });

  it('rejects anon and service-role tokens', async () => {
    getClaimsMock.mockResolvedValue(claimsResult({ role: 'anon', sub: 'anon-user' }));
    expect(await validateUserAndToken('Bearer anon')).toEqual({});
    getClaimsMock.mockResolvedValue(claimsResult({ role: 'service_role', sub: 'service-user' }));
    expect(await validateUserAndToken('Bearer service')).toEqual({});
  });

  it('rejects authenticated claims without a subject', async () => {
    getClaimsMock.mockResolvedValue(claimsResult({ role: 'authenticated' }));
    expect(await validateUserAndToken('Bearer missing-sub')).toEqual({});
  });

  it('returns nothing without an auth header', async () => {
    expect(await validateUserAndToken(null)).toEqual({});
    expect(getClaimsMock).not.toHaveBeenCalled();
  });
});
