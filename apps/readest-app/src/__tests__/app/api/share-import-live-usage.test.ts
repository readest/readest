import { describe, it, expect, vi, beforeEach } from 'vitest';

// Share-import quota used the usage figure frozen in the JWT claim, so repeated
// imports in one token window all measured against the same stale baseline and
// could exceed the quota. The fix reads the live `plans.storage_usage_bytes`.
// This test proves the LIVE value drives the decision: the claim says near-zero
// usage (would pass) while the live row is over quota (must reject with 402).

const validateUserAndTokenMock = vi.fn();
const resolveActiveShareMock = vi.fn();
const copyObjectMock = vi.fn();
const objectExistsMock = vi.fn();

vi.mock('@/utils/access', () => ({
  STORAGE_QUOTA_GRACE_BYTES: 0,
  getStoragePlanData: () => ({ usage: 0, quota: 1000 }), // stale claim: would PASS
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/libs/shareServer', () => ({
  resolveActiveShare: (...a: unknown[]) => resolveActiveShareMock(...a),
  rejectionToHttp: () => ({ status: 410, body: { error: 'gone' } }),
}));
vi.mock('@/utils/object', () => ({
  copyObject: (...a: unknown[]) => copyObjectMock(...a),
  objectExists: (...a: unknown[]) => objectExistsMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'plans') {
        return {
          select: () => ({
            eq: () => ({
              // Live usage is well over quota.
              single: () =>
                Promise.resolve({ data: { storage_usage_bytes: 10_000_000 }, error: null }),
            }),
          }),
        };
      }
      // `files` existing-row lookup: no rows, so flow reaches the quota check.
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'not', 'limit']) chain[m] = () => chain;
      chain['maybeSingle'] = () => Promise.resolve({ data: null, error: null });
      chain['then'] = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return chain;
    },
  }),
}));

import { POST } from '@/app/api/share/[token]/import/route';

const makeReq = () =>
  new Request('http://localhost/api/share/tok/import', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt' },
  });

beforeEach(() => {
  validateUserAndTokenMock
    .mockReset()
    .mockResolvedValue({ user: { id: 'recipient' }, token: 'jwt' });
  resolveActiveShareMock.mockReset().mockResolvedValue({
    ok: true,
    share: {
      userId: 'sharer',
      bookHash: 'hash1',
      bookSize: 100,
      bookFileKey: 'sharer/Readest/Book/hash1/book.epub',
      cfi: null,
    },
  });
  copyObjectMock.mockReset().mockResolvedValue(undefined);
  objectExistsMock.mockReset().mockResolvedValue(true);
});

describe('POST /api/share/[token]/import — live usage quota', () => {
  it('rejects with 402 based on the live usage row even though the JWT claim would pass', async () => {
    const res = await POST(makeReq(), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(402);
    // The byte-copy must never start once the quota is exceeded.
    expect(copyObjectMock).not.toHaveBeenCalled();
  });
});
