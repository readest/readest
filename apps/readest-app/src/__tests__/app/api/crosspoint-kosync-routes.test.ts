import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

const validateUserAndTokenMock = vi.fn();
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));

let calls: unknown[][];
let results: Record<string, { data: unknown; error: unknown }>;

// Records [table, method, ...args] for every query-builder call; awaiting a
// query on a table yields results[table].
const makeClient = () => ({
  from: (table: string) => {
    calls.push([table, 'from']);
    const builder: Record<string, unknown> = {};
    for (const m of [
      'select',
      'insert',
      'upsert',
      'update',
      'delete',
      'eq',
      'is',
      'lt',
      'limit',
      'single',
      'maybeSingle',
    ]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([table, m, ...args]);
        return builder;
      };
    }
    builder['then'] = (resolve: (v: unknown) => unknown) =>
      resolve(results[table] ?? { data: null, error: null });
    return builder;
  },
});

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => makeClient(),
}));

import { GET as authGET } from '@/app/api/crosspoint/users/auth/route';
import { GET as progressGET } from '@/app/api/crosspoint/syncs/progress/[document]/route';
import { PUT as progressPUT } from '@/app/api/crosspoint/syncs/progress/route';
import { POST as keysPOST } from '@/app/api/crosspoint/keys/route';
import { DELETE as keyDELETE } from '@/app/api/crosspoint/keys/[id]/route';

const BASE = 'https://web.readest.com/api/crosspoint';
const USER = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'reader@example.com';
const KEY = 'device-key';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY_HASH = sha256(md5(KEY));
const DOC = '32bb20d7452627491831bb64a8d0dd94';
const XPOINTER = '/body/DocFragment[3]/body/p[12]/text().40';

// KOSync clients send x-auth-user/x-auth-key; CrossPoint adds the same
// credentials as HTTP Basic. The username is the account email.
const kosyncHeaders = (auth: 'kosync' | 'basic', key = KEY): Record<string, string> =>
  auth === 'kosync'
    ? { 'x-auth-user': EMAIL, 'x-auth-key': md5(key) }
    : { authorization: `Basic ${btoa(`${EMAIL}:${key}`)}` };

const keyRows = (rows: unknown[]) => ({ data: rows, error: null });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
  calls = [];
  results = { kosync_keys: keyRows([{ user_id: USER }]) };
  validateUserAndTokenMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('KOSync-compatible routes for CrossPoint', () => {
  it('authenticates a device by its key alone, in KOSync headers or HTTP Basic', async () => {
    for (const auth of ['kosync', 'basic'] as const) {
      calls = [];
      const res = await authGET(
        new Request(`${BASE}/users/auth`, { headers: kosyncHeaders(auth) }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ authorized: 'OK' });
      expect(calls).toContainEqual(['kosync_keys', 'eq', 'key_hash', KEY_HASH]);
      // The username is only a label, so a changed account email keeps syncing.
      expect(calls.filter(([table, m]) => table === 'kosync_keys' && m === 'eq')).toHaveLength(1);
    }
  });

  it('rejects unknown keys and requests without credentials', async () => {
    results['kosync_keys'] = keyRows([]);
    const res = await authGET(
      new Request(`${BASE}/users/auth`, { headers: kosyncHeaders('kosync') }),
    );
    expect(res.status).toBe(401);

    calls = [];
    const anonymous = await authGET(new Request(`${BASE}/users/auth`));
    expect(anonymous.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("returns the book's synced XPointer with its progress and time", async () => {
    results['book_configs'] = {
      data: { xpointer: XPOINTER, progress: '[30,120]', updated_at: '2026-10-01T00:00:00.000Z' },
      error: null,
    };
    const res = await progressGET(
      new Request(`${BASE}/syncs/progress/${DOC}`, { headers: kosyncHeaders('kosync') }),
      { params: Promise.resolve({ document: DOC }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      document: DOC,
      progress: XPOINTER,
      percentage: 0.25,
      device: 'Readest',
      device_id: 'readest',
      timestamp: 1790812800,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['book_configs', 'eq', 'user_id', USER],
        ['book_configs', 'eq', 'book_hash', DOC],
        ['book_configs', 'is', 'deleted_at', null],
      ]),
    );
  });

  it('answers 404 when the book has no synced XPointer', async () => {
    results['book_configs'] = { data: { xpointer: null, progress: '[30,120]' }, error: null };
    const res = await progressGET(
      new Request(`${BASE}/syncs/progress/${DOC}`, { headers: kosyncHeaders('kosync') }),
      { params: Promise.resolve({ document: DOC }) },
    );
    expect(res.status).toBe(404);
  });

  it('stores pushed progress in the book config and the library progress', async () => {
    results['book_configs'] = { data: { progress: '[30,120]' }, error: null };
    const res = await progressPUT(
      new Request(`${BASE}/syncs/progress`, {
        method: 'PUT',
        headers: kosyncHeaders('basic'),
        body: JSON.stringify({
          document: DOC,
          progress: XPOINTER,
          percentage: 0.5,
          device: 'CrossPoint',
          device_id: 'crosspoint-reader',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document: DOC, timestamp: 1790899200 });

    const now = '2026-10-02T00:00:00.000Z';
    // The percentage is scaled onto the book's Readest page count.
    expect(calls).toContainEqual([
      'book_configs',
      'upsert',
      { user_id: USER, book_hash: DOC, xpointer: XPOINTER, progress: '[60,120]', updated_at: now },
      { onConflict: 'user_id,book_hash' },
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['books', 'update', { progress: [60, 120], updated_at: now }],
        ['books', 'eq', 'user_id', USER],
        ['books', 'eq', 'book_hash', DOC],
        ['books', 'lt', 'updated_at', now],
      ]),
    );
  });

  it('stores only the XPointer when the book has no Readest page count yet', async () => {
    results['book_configs'] = { data: null, error: null };
    await progressPUT(
      new Request(`${BASE}/syncs/progress`, {
        method: 'PUT',
        headers: kosyncHeaders('kosync'),
        body: JSON.stringify({ document: DOC, progress: XPOINTER, percentage: 0.5 }),
      }),
    );
    expect(calls).toContainEqual([
      'book_configs',
      'upsert',
      { user_id: USER, book_hash: DOC, xpointer: XPOINTER, updated_at: '2026-10-02T00:00:00.000Z' },
      { onConflict: 'user_id,book_hash' },
    ]);
    expect(calls.some(([table]) => table === 'books')).toBe(false);
  });

  it('rejects progress that is not a KOReader XPointer', async () => {
    const res = await progressPUT(
      new Request(`${BASE}/syncs/progress`, {
        method: 'PUT',
        headers: kosyncHeaders('kosync'),
        body: JSON.stringify({ document: DOC, progress: '42', percentage: 0.5 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(calls.some(([table, m]) => table === 'book_configs' && m === 'upsert')).toBe(false);
  });

  it('mints a device key for a signed-in user and stores only its hash', async () => {
    const unauthenticated = await keysPOST(new Request(`${BASE}/keys`, { method: 'POST' }));
    expect(unauthenticated.status).toBe(401);

    validateUserAndTokenMock.mockResolvedValue({ user: { id: USER, email: EMAIL }, token: 'jwt' });
    results['kosync_keys'] = { data: { id: 'key-id' }, error: null };
    const res = await keysPOST(
      new Request(`${BASE}/keys`, { method: 'POST', headers: { authorization: 'Bearer jwt' } }),
    );
    expect(res.status).toBe(200);
    const { id, username, key } = await res.json();
    expect({ id, username }).toEqual({ id: 'key-id', username: EMAIL });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toContainEqual([
      'kosync_keys',
      'insert',
      { user_id: USER, key_hash: sha256(md5(key)) },
    ]);
  });

  it('revokes a device key by its id', async () => {
    const id = '99999999-8888-4777-8666-555555555555';
    const res = await keyDELETE(new Request(`${BASE}/keys/${id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(204);
    expect(calls).toContainEqual(['kosync_keys', 'eq', 'id', id]);

    const bad = await keyDELETE(new Request(`${BASE}/keys/x`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(bad.status).toBe(400);
  });
});
