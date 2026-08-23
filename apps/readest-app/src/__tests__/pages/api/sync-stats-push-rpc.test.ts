import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The stats push used to SELECT the batch's existing rows
// (user_id = ?, book_hash IN (...), start_time IN (...)), decide "longer
// duration wins" in JS, then upsert in a second round trip. That lookup ran
// ~9 req/s in production and, on PG 15, re-walks the whole (user_id, book_hash)
// PK range once per start_time array element because start_time sits after the
// unconstrained `page` column of the primary key. The merge now lives in one
// INSERT ... ON CONFLICT RPC (migration 019) that probes the PK exactly.

type RpcResult = { data: unknown; error: { message: string } | null };
const fromMock = vi.fn();
const rpcMock = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock, rpc: rpcMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'u1' }, token: 'tok' }),
}));

import { POST } from '@/pages/api/sync';

const post = (body: unknown) =>
  POST(
    new Request('https://web.readest.com/api/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

const page = (start_time: number, duration = 5) => ({
  book_hash: 'h1',
  page: 3,
  start_time,
  duration,
  total_pages: 100,
});

const rowsOf = (call: unknown[]) => (call[1] as { p_rows: Record<string, unknown>[] }).p_rows;

beforeEach(() => {
  fromMock.mockClear();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 0, error: null });
});

describe('POST /api/sync stat_pages push', () => {
  it('merges page events through the upsert_stat_pages RPC instead of select + upsert', async () => {
    const res = await post({ statPages: [page(100), page(200, 9)] });
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![0]).toBe('upsert_stat_pages');
    const rows = rowsOf(rpcMock.mock.calls[0]!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      book_hash: 'h1',
      page: 3,
      start_time: 100,
      duration: 5,
      total_pages: 100,
      ext: null,
      deleted_at: null,
    });
    // user_id and updated_at are stamped inside the RPC (auth.uid(), now()).
    expect(rows[0]).not.toHaveProperty('user_id');
    expect(rows[0]).not.toHaveProperty('updated_at');
    expect(fromMock.mock.calls.map((c) => c[0])).not.toContain('stat_pages');
  });

  it('splits a large push into 500-row RPC calls', async () => {
    await post({ statPages: Array.from({ length: 1200 }, (_, i) => page(i)) });
    expect(rpcMock.mock.calls.map((c) => rowsOf(c).length)).toEqual([500, 500, 200]);
  });

  it('returns 500 with the RPC error message', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const res = await post({ statPages: [page(100)] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });
});
