import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

const validateUserAndTokenMock = vi.fn();
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
const getDownloadSignedUrlMock = vi.fn();
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...a: unknown[]) => getDownloadSignedUrlMock(...a),
}));

let calls: unknown[][];
let results: Record<string, { data: unknown; error: unknown }>;

// Records [table, method, ...args] for every query-builder call. Awaiting a
// query yields results['<table>.<op>'], where op is the write it performs
// (insert, upsert, update, delete) or select.
const WRITES = ['insert', 'upsert', 'update', 'delete'];
const makeClient = () => ({
  from: (table: string) => {
    let op = 'select';
    const builder: Record<string, unknown> = {};
    for (const m of [
      ...WRITES,
      'select',
      'eq',
      'is',
      'not',
      'lt',
      'gt',
      'or',
      'order',
      'range',
      'limit',
      'single',
      'maybeSingle',
    ]) {
      builder[m] = (...args: unknown[]) => {
        if (WRITES.includes(m)) op = m;
        calls.push([table, m, ...args]);
        return builder;
      };
    }
    builder['then'] = (resolve: (v: unknown) => unknown) =>
      resolve(results[`${table}.${op}`] ?? { data: null, error: null });
    return builder;
  },
});

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => makeClient(),
}));

import { POST as codePOST } from '@/app/api/crosspoint/device/code/route';
import { POST as tokenPOST } from '@/app/api/crosspoint/device/token/route';
import { POST as approvePOST } from '@/app/api/crosspoint/device/approve/route';
import { GET as booksGET } from '@/app/api/crosspoint/books/route';
import { GET as bookGET } from '@/app/api/crosspoint/books/[hash]/route';
import { POST as sessionsPOST } from '@/app/api/crosspoint/sessions/route';
import { GET as authGET } from '@/app/api/crosspoint/users/auth/route';
import { GET as progressGET } from '@/app/api/crosspoint/syncs/progress/[document]/route';
import { PUT as progressPUT } from '@/app/api/crosspoint/syncs/progress/route';
import { DELETE as keyDELETE } from '@/app/api/crosspoint/keys/[id]/route';

const BASE = 'https://web.readest.com/api/crosspoint';
const NOW = '2026-10-02T00:00:00.000Z';
const USER = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'reader@example.com';
const KEY = 'device-key';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY_HASH = sha256(md5(KEY));
const DOC = '32bb20d7452627491831bb64a8d0dd94';
const XPOINTER = '/body/DocFragment[3]/body/p[12]/text().40';
const boom = { message: 'boom' };

// The catalog and events send the key as a Bearer token. KOSync clients send
// x-auth-user/x-auth-key (md5 of the key); CrossPoint adds the same
// credentials as HTTP Basic. The username is the account email.
const deviceHeaders = (auth: 'bearer' | 'kosync' | 'basic' = 'bearer'): Record<string, string> =>
  auth === 'bearer'
    ? { authorization: `Bearer ${KEY}` }
    : auth === 'kosync'
      ? { 'x-auth-user': EMAIL, 'x-auth-key': md5(KEY) }
      : { authorization: `Basic ${btoa(`${EMAIL}:${KEY}`)}` };

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const wrote = (table: string) =>
  calls.some(([t, m]) => t === table && WRITES.includes(m as string));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  calls = [];
  results = { 'crosspoint_devices.select': { data: [{ user_id: USER }], error: null } };
  validateUserAndTokenMock.mockReset().mockResolvedValue({});
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://storage.example/signed');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('device sign-in', () => {
  const start = () => codePOST(new Request(`${BASE}/device/code`, { method: 'POST' }));

  it('starts a sign-in with a code to approve and a secret device code to poll with', async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.device_code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(body).toMatchObject({
      verification_uri: 'https://web.readest.com/link',
      // The reader renders this one as its QR code.
      verification_uri_complete: `https://web.readest.com/link?code=${body.user_code}`,
      expires_in: 600,
      interval: 5,
    });
    // Only the device code's hash is stored; expired sign-ins are cleared first.
    expect(calls).toEqual(
      expect.arrayContaining([
        ['crosspoint_device_codes', 'delete'],
        ['crosspoint_device_codes', 'lt', 'expires_at', NOW],
        [
          'crosspoint_device_codes',
          'insert',
          {
            device_code_hash: sha256(body.device_code),
            user_code: body.user_code,
            expires_at: '2026-10-02T00:10:00.000Z',
          },
        ],
      ]),
    );

    results['crosspoint_device_codes.insert'] = { data: null, error: boom };
    expect((await start()).status).toBe(500);
  });

  it('lets the signed-in owner approve a code', async () => {
    const approve = (user_code: unknown) => approvePOST(post('/device/approve', { user_code }));
    expect((await approve('BCDF-GHJK')).status).toBe(401);

    validateUserAndTokenMock.mockResolvedValue({ user: { id: USER, email: EMAIL }, token: 'jwt' });
    results['crosspoint_device_codes.update'] = { data: [{ user_code: 'BCDF-GHJK' }], error: null };
    // Typed by hand: any case, spacing or dash.
    calls = [];
    expect((await approve(' bcdf ghjk ')).status).toBe(200);
    expect(calls).toEqual([
      ['crosspoint_device_codes', 'update', { user_id: USER, username: EMAIL }],
      ['crosspoint_device_codes', 'eq', 'user_code', 'BCDF-GHJK'],
      // A code is approved once, and only while it is live.
      ['crosspoint_device_codes', 'is', 'user_id', null],
      ['crosspoint_device_codes', 'gt', 'expires_at', NOW],
      ['crosspoint_device_codes', 'select', 'user_code'],
    ]);

    results['crosspoint_device_codes.update'] = { data: [], error: null };
    expect((await approve('BCDF-GHJK')).status).toBe(404);
    results['crosspoint_device_codes.update'] = { data: null, error: boom };
    expect((await approve('BCDF-GHJK')).status).toBe(500);

    calls = [];
    for (const code of ['hello', 'BCDF-GHJ', 'AAAA-AAAA', 42]) {
      expect((await approve(code)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('answers polls with authorization_pending until the code is approved', async () => {
    results['crosspoint_device_codes.select'] = {
      data: { expires_at: '2026-10-02T00:05:00.000Z' },
      error: null,
    };
    const res = await tokenPOST(post('/device/token', { device_code: 'abc' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'authorization_pending' });
    expect(wrote('crosspoint_devices')).toBe(false);

    // Unknown, expired, or already claimed.
    results['crosspoint_device_codes.select'] = { data: null, error: null };
    const expired = await tokenPOST(post('/device/token', { device_code: 'abc' }));
    expect(await expired.json()).toEqual({ error: 'expired_token' });

    expect((await tokenPOST(post('/device/token', {}))).status).toBe(400);
    expect((await tokenPOST(post('/device/token', 'not json'))).status).toBe(400);
  });

  it('hands an approved reader its own key once, storing only the key hash', async () => {
    results['crosspoint_device_codes.delete'] = {
      data: [{ user_id: USER, username: EMAIL }],
      error: null,
    };
    results['crosspoint_devices.insert'] = { data: { id: 'device-id' }, error: null };
    const res = await tokenPOST(post('/device/token', { device_code: 'abc' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      access_token: expect.stringMatching(/^[0-9a-f]{64}$/),
      token_type: 'bearer',
      id: 'device-id',
      username: EMAIL,
    });
    // Deleting the approved row claims it, so a second poll can't mint another key.
    expect(calls).toEqual(
      expect.arrayContaining([
        ['crosspoint_device_codes', 'delete'],
        ['crosspoint_device_codes', 'eq', 'device_code_hash', sha256('abc')],
        ['crosspoint_device_codes', 'not', 'user_id', 'is', null],
        ['crosspoint_device_codes', 'gt', 'expires_at', NOW],
        [
          'crosspoint_devices',
          'insert',
          { user_id: USER, key_hash: sha256(md5(body.access_token)) },
        ],
      ]),
    );
  });

  it('reports database failures while polling', async () => {
    const poll = () => tokenPOST(post('/device/token', { device_code: 'abc' }));
    results['crosspoint_device_codes.delete'] = { data: null, error: boom };
    expect((await poll()).status).toBe(500);

    results['crosspoint_device_codes.delete'] = { data: [], error: null };
    results['crosspoint_device_codes.select'] = { data: null, error: boom };
    expect((await poll()).status).toBe(500);

    const approved = {
      user_code: 'BCDF-GHJK',
      user_id: USER,
      username: EMAIL,
      expires_at: '2026-10-02T00:05:00.000Z',
    };
    results['crosspoint_device_codes.delete'] = { data: [approved], error: null };
    results['crosspoint_devices.insert'] = { data: null, error: boom };
    calls = [];
    const res = await poll();
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty('access_token');
    // The approval goes back, so the reader's next poll can still get a key.
    expect(calls).toContainEqual([
      'crosspoint_device_codes',
      'insert',
      { device_code_hash: sha256('abc'), ...approved },
    ]);
  });

  it('revokes a device key by its id', async () => {
    const id = '99999999-8888-4777-8666-555555555555';
    const del = (keyId = id) =>
      keyDELETE(new Request(`${BASE}/keys/${keyId}`, { method: 'DELETE' }), {
        params: Promise.resolve({ id: keyId }),
      });
    // A body, not 204 No Content: CrossPoint's HTTP client reads a reply with
    // neither Content-Length nor chunking until the connection closes, so a
    // relayed 204 timed out and the plugin reported the revoke as failed.
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(calls).toContainEqual(['crosspoint_devices', 'eq', 'id', id]);
    expect((await del('x')).status).toBe(400);

    results['crosspoint_devices.delete'] = { data: null, error: boom };
    expect((await del()).status).toBe(500);
  });
});

describe('device key authentication', () => {
  const check = (headers: Record<string, string>) =>
    authGET(new Request(`${BASE}/users/auth`, { headers }));

  it('accepts the key as a Bearer token, a KOSync key, or the HTTP Basic password', async () => {
    for (const auth of ['bearer', 'kosync', 'basic'] as const) {
      calls = [];
      const res = await check(deviceHeaders(auth));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ authorized: 'OK' });
      // The key alone authenticates: the username is a label that survives an email change.
      expect(calls).toEqual([
        ['crosspoint_devices', 'select', 'user_id'],
        ['crosspoint_devices', 'eq', 'key_hash', KEY_HASH],
        ['crosspoint_devices', 'limit', 1],
      ]);
    }
    expect((await check({ 'x-auth-key': md5(KEY).toUpperCase() })).status).toBe(200);
  });

  it('rejects unknown keys and malformed credentials', async () => {
    results['crosspoint_devices.select'] = { data: [], error: null };
    expect((await check(deviceHeaders())).status).toBe(401);

    const malformed: Record<string, string>[] = [
      {},
      { authorization: 'Token abc' },
      { authorization: 'Basic !!!' },
      { authorization: `Basic ${btoa('no-separator')}` },
    ];
    for (const headers of malformed) {
      calls = [];
      expect((await check(headers)).status).toBe(401);
      expect(calls).toEqual([]);
    }
  });

  it('reports a failed key lookup as a server error, not a wrong key', async () => {
    results['crosspoint_devices.select'] = { data: null, error: boom };
    expect((await check(deviceHeaders())).status).toBe(500);
  });
});

describe('library catalog', () => {
  const list = (query = '') =>
    booksGET(new Request(`${BASE}/books${query}`, { headers: deviceHeaders() }));

  it("pages the owner's uploaded EPUBs, most recently read first", async () => {
    results['books.select'] = {
      data: [{ book_hash: DOC, title: 'Moby-Dick', author: 'Herman Melville' }],
      error: null,
    };
    const res = await list('?page=2&per_page=8');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        { id: DOC, title: 'Moby-Dick', author: 'Herman Melville', url: `${BASE}/books/${DOC}` },
      ],
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['books', 'eq', 'user_id', USER],
        ['books', 'eq', 'format', 'EPUB'],
        ['books', 'is', 'deleted_at', null],
        ['books', 'not', 'uploaded_at', 'is', null],
        // Opening a book in Readest (or syncing progress from the reader)
        // bumps updated_at, so the book the user wants next leads the list.
        ['books', 'order', 'updated_at', { ascending: false }],
        ['books', 'order', 'book_hash'],
        // Page 2 starts right after the 8 books of page 1 and carries one
        // extra row that tells the reader another page exists.
        ['books', 'range', 8, 16],
      ]),
    );
    expect(calls.some(([, m]) => m === 'or')).toBe(false);
  });

  it('rejects readers without a valid key', async () => {
    results['crosspoint_devices.select'] = { data: [], error: null };
    expect((await list()).status).toBe(401);
    expect(calls.some(([table]) => table === 'books')).toBe(false);
  });

  it('clamps paging input', async () => {
    for (const [query, from, to] of [
      ['', 0, 20],
      ['?page=0&per_page=500', 0, 50],
      ['?page=abc&per_page=-3', 0, 1],
      ['?page=2.7&per_page=8.9', 8, 16],
      ['?page=Infinity&per_page=8', 79992, 80000],
    ] as const) {
      calls = [];
      await list(query);
      expect(calls).toContainEqual(['books', 'range', from, to]);
    }
  });

  it('matches search text literally against title and author', async () => {
    // Commas and parentheses are PostgREST or() syntax; %, _ and * are wildcards.
    await list(`?q=${encodeURIComponent(' Moby, (Dick) 100%_* ')}`);
    expect(calls).toContainEqual([
      'books',
      'or',
      'title.ilike.%Moby Dick 100%,author.ilike.%Moby Dick 100%',
    ]);

    calls = [];
    await list(`?q=${encodeURIComponent('(,)')}`);
    expect(calls.some(([, m]) => m === 'or')).toBe(false);
  });

  it('spells runs of dots in titles as an ellipsis the reader can save', async () => {
    // The reader refuses to save a file whose name contains "..".
    results['books.select'] = {
      data: [{ book_hash: DOC, title: 'Wait... What?', author: '' }],
      error: null,
    };
    const { items } = await (await list()).json();
    expect(items[0].title).toBe('Wait… What?');
  });

  it('lists a book without a title under its hash', async () => {
    // The reader drops catalog rows without a title.
    results['books.select'] = {
      data: [{ book_hash: DOC, title: null, author: null }],
      error: null,
    };
    const res = await list();
    expect(res.status).toBe(200);
    expect((await res.json()).items[0].title).toBe(DOC);
  });

  it('reports database failures', async () => {
    results['books.select'] = { data: null, error: boom };
    expect((await list()).status).toBe(500);
  });

  it('links a book download to its stored EPUB', async () => {
    const get = (hash = DOC) =>
      bookGET(new Request(`${BASE}/books/${hash}`, { headers: deviceHeaders() }), {
        params: Promise.resolve({ hash }),
      });
    results['files.select'] = {
      data: [
        { file_key: `${USER}/Readest/Books/${DOC}/cover.png` },
        { file_key: `${USER}/Readest/Books/${DOC}/Moby-Dick.epub` },
      ],
      error: null,
    };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ downloadUrl: 'https://storage.example/signed' });
    expect(getDownloadSignedUrlMock).toHaveBeenCalledWith(
      `${USER}/Readest/Books/${DOC}/Moby-Dick.epub`,
      1800,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        ['files', 'eq', 'user_id', USER],
        ['files', 'eq', 'book_hash', DOC],
        ['files', 'is', 'deleted_at', null],
      ]),
    );

    results['files.select'] = { data: [{ file_key: `${USER}/x/cover.png` }], error: null };
    expect((await get()).status).toBe(404);
    expect((await get('not-a-hash')).status).toBe(400);
    results['files.select'] = { data: null, error: boom };
    expect((await get()).status).toBe(500);
    results['crosspoint_devices.select'] = { data: [], error: null };
    expect((await get()).status).toBe(401);
  });
});

describe('reading sessions', () => {
  const SESSION = { document: DOC, start_time: 1790000000, duration: 600, start_bp: 2500 };
  const session = (body: Record<string, unknown>) =>
    sessionsPOST(post('/sessions', { ...SESSION, end_bp: 3000, ...body }, deviceHeaders()));
  type Row = Record<string, number | string>;
  const upserted = () =>
    calls.find(([table, m]) => table === 'stat_pages' && m === 'upsert') as
      | [string, string, Row[], unknown]
      | undefined;

  it("spreads a session over the pages it covered, in the book's Readest page count", async () => {
    results['book_configs.select'] = { data: { progress: '[30,120]' }, error: null };
    const res = await session({});
    expect(res.status).toBe(200);

    const [, , rows, options] = upserted()!;
    // 25%..30% of 120 pages: pages 31 to 37.
    expect(rows.map((r) => r['page'])).toEqual([31, 32, 33, 34, 35, 36, 37]);
    expect(rows.every((r) => r['total_pages'] === 120 && r['book_hash'] === DOC)).toBe(true);
    expect(rows.every((r) => r['user_id'] === USER)).toBe(true);
    // Back to back, adding up to the session.
    expect(rows[0]!['start_time']).toBe(1790000000);
    rows.slice(1).forEach((r, i) => {
      expect(Number(rows[i]!['start_time']) + Number(rows[i]!['duration'])).toBe(r['start_time']);
    });
    expect(rows.reduce((sum, r) => sum + Number(r['duration']), 0)).toBe(600);
    // The same event delivered twice adds nothing.
    expect(options).toEqual({
      onConflict: 'user_id,book_hash,page,start_time',
      ignoreDuplicates: true,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['book_configs', 'eq', 'user_id', USER],
        ['book_configs', 'eq', 'book_hash', DOC],
      ]),
    );
  });

  it('counts a rewritten copy toward the library book it is linked to', async () => {
    // The copy's first progress sync linked it (see KOSync progress).
    const BOOK = '0123456789abcdef0123456789abcdef';
    results['crosspoint_documents.select'] = { data: { book_hash: BOOK }, error: null };
    results['book_configs.select'] = { data: { progress: '[30,120]' }, error: null };
    await session({});
    const [, , rows] = upserted()!;
    expect(rows.every((r) => r['book_hash'] === BOOK && r['total_pages'] === 120)).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['crosspoint_documents', 'eq', 'document', DOC],
        ['book_configs', 'eq', 'book_hash', BOOK],
      ]),
    );
  });

  it('counts whole percents for a book Readest has not paginated', async () => {
    await session({});
    const [, , rows] = upserted()!;
    expect(rows.map((r) => [r['page'], r['duration'], r['total_pages']])).toEqual([
      [26, 100, 100],
      [27, 100, 100],
      [28, 100, 100],
      [29, 100, 100],
      [30, 100, 100],
      [31, 100, 100],
    ]);
  });

  it('keeps the pages a session ended on when it crossed more than it had time for', async () => {
    // Twelve seconds from the start to the middle: a chapter skip, not reading.
    results['book_configs.select'] = { data: { progress: '[30,120]' }, error: null };
    await session({ duration: 12, start_bp: 0, end_bp: 5000 });
    expect(upserted()![2].map((r) => [r['page'], r['duration']])).toEqual([
      [58, 3],
      [59, 3],
      [60, 3],
      [61, 3],
    ]);

    calls = [];
    await session({ start_bp: 10000, end_bp: 10000 });
    expect(upserted()![2].map((r) => r['page'])).toEqual([120]);
  });

  it("drops sessions it can never record, so they don't stall the reader's queue", async () => {
    // The reader retries a failed delivery before sending any later event.
    for (const body of [
      { document: 'not-a-hash' },
      { duration: 0 },
      { duration: 1.5 },
      { start_time: -1 },
      { end_bp: undefined },
    ]) {
      calls = [];
      const res = await session(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ pages: 0 });
      expect(wrote('stat_pages')).toBe(false);
    }
    const garbled = await sessionsPOST(post('/sessions', 'not json', deviceHeaders()));
    expect(garbled.status).toBe(200);

    // Out-of-range progress is clamped rather than dropped.
    calls = [];
    await session({ start_bp: 9950, end_bp: 10001 });
    expect(upserted()![2].map((r) => r['page'])).toEqual([100]);
  });

  it('leaves sessions for retry when the key is unknown', async () => {
    results['crosspoint_devices.select'] = { data: [], error: null };
    expect((await session({})).status).toBe(401);
    expect(wrote('stat_pages')).toBe(false);
  });

  it('reports database failures', async () => {
    // Retried later rather than recorded under a linked copy's own hash.
    results['crosspoint_documents.select'] = { data: null, error: boom };
    expect((await session({})).status).toBe(500);
    expect(wrote('stat_pages')).toBe(false);

    results['crosspoint_documents.select'] = { data: null, error: null };
    results['book_configs.select'] = { data: null, error: boom };
    expect((await session({})).status).toBe(500);
    expect(wrote('stat_pages')).toBe(false);

    results['book_configs.select'] = { data: null, error: null };
    results['stat_pages.upsert'] = { data: null, error: boom };
    expect((await session({})).status).toBe(500);
  });
});

describe('KOSync progress', () => {
  const get = () =>
    progressGET(
      new Request(`${BASE}/syncs/progress/${DOC}`, { headers: deviceHeaders('kosync') }),
      {
        params: Promise.resolve({ document: DOC }),
      },
    );
  const put = (body: Record<string, unknown> | string, auth: 'kosync' | 'basic' = 'kosync') =>
    progressPUT(
      new Request(`${BASE}/syncs/progress`, {
        method: 'PUT',
        headers: deviceHeaders(auth),
        body:
          typeof body === 'string'
            ? body
            : JSON.stringify({ document: DOC, progress: XPOINTER, percentage: 0.5, ...body }),
      }),
    );

  it("returns the book's synced XPointer with its progress and time", async () => {
    results['book_configs.select'] = {
      data: { xpointer: XPOINTER, progress: '[30,120]', updated_at: '2026-10-01T00:00:00.000Z' },
      error: null,
    };
    const res = await get();
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

  it('answers 404 without an XPointer, and 0% for an unusable page count', async () => {
    results['book_configs.select'] = {
      data: { xpointer: null, progress: '[30,120]' },
      error: null,
    };
    expect((await get()).status).toBe(404);
    results['book_configs.select'] = { data: null, error: null };
    expect((await get()).status).toBe(404);

    for (const progress of [null, 'not json', '[5,0]']) {
      results['book_configs.select'] = {
        data: { xpointer: XPOINTER, progress, updated_at: '2026-10-01T00:00:00.000Z' },
        error: null,
      };
      expect(await (await get()).json()).toMatchObject({ progress: XPOINTER, percentage: 0 });
    }
  });

  it("updates the book's config and library progress, never over a newer write", async () => {
    results['book_configs.select'] = {
      data: { xpointer: '/body/DocFragment[1]', progress: '[30,120]' },
      error: null,
    };
    const res = await put({ device: 'CrossPoint' }, 'basic');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document: DOC, timestamp: 1790899200 });

    // The percentage is scaled onto the book's Readest page count.
    expect(calls).toEqual(
      expect.arrayContaining([
        ['book_configs', 'update', { xpointer: XPOINTER, progress: '[60,120]', updated_at: NOW }],
        ['book_configs', 'lt', 'updated_at', NOW],
        ['books', 'update', { progress: [60, 120], updated_at: NOW }],
        ['books', 'eq', 'user_id', USER],
        ['books', 'eq', 'book_hash', DOC],
        ['books', 'lt', 'updated_at', NOW],
      ]),
    );
  });

  it('keeps the percentage, in whole percents, for a book Readest has not paginated', async () => {
    await put({ percentage: 0.427 });
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          'book_configs',
          'upsert',
          {
            user_id: USER,
            book_hash: DOC,
            xpointer: XPOINTER,
            progress: '[43,100]',
            updated_at: NOW,
          },
          // A config written meanwhile is newer: keep it.
          { onConflict: 'user_id,book_hash', ignoreDuplicates: true },
        ],
        ['books', 'update', { progress: [43, 100], updated_at: NOW }],
      ]),
    );
  });

  it("doesn't pull Readest's position back for a reader that has not seen it", async () => {
    // Readest is halfway through but stored no XPointer, so the reader's sync
    // found nothing and uploads its own position from a fresh download.
    results['book_configs.select'] = {
      data: { xpointer: null, progress: '[60,120]' },
      error: null,
    };
    expect((await put({ percentage: 0.01 })).status).toBe(200);
    expect(wrote('book_configs')).toBe(false);
    expect(wrote('books')).toBe(false);

    // Once it has seen an XPointer, an upload is the user's choice.
    results['book_configs.select'] = {
      data: { xpointer: XPOINTER, progress: '[60,120]' },
      error: null,
    };
    await put({ percentage: 0.01 });
    expect(wrote('book_configs')).toBe(true);
  });

  it('rejects malformed pushes and unknown keys without writing', async () => {
    for (const body of [
      'not json',
      { document: 'not-a-hash' },
      { percentage: 1.5 },
      { percentage: undefined },
      { progress: '42' },
      { progress: `/body/${'p'.repeat(4096)}` },
    ]) {
      calls = [];
      expect((await put(body)).status).toBe(400);
      expect(calls.some(([table]) => table !== 'crosspoint_devices')).toBe(false);
    }

    calls = [];
    results['crosspoint_devices.select'] = { data: [], error: null };
    expect((await put({})).status).toBe(401);
    expect(calls.some(([table]) => table !== 'crosspoint_devices')).toBe(false);
  });

  // CrossPoint's "Optimize EPUB" upload rewrites a book, so the reader asks
  // about a document id (the file's partial MD5) that no Readest book has.
  describe('a rewritten copy of a Readest book', () => {
    const BOOK = '0123456789abcdef0123456789abcdef';
    const TITLE = 'Alice, Illustrated (1865)';
    // The reader joins every dc:creator with ", ".
    const metadata = {
      filename: 'Alice.epub',
      title: TITLE,
      authors: 'Lewis Carroll, John Tenniel',
    };
    // Renamed in Readest; source_title keeps the file's own title.
    const libraryBook = {
      book_hash: BOOK,
      title: 'Alice',
      source_title: TITLE,
      author: 'Lewis Carroll and John Tenniel',
    };
    const linkWrite = [
      'crosspoint_documents',
      'upsert',
      { user_id: USER, document: DOC, book_hash: BOOK },
      { onConflict: 'user_id,document', ignoreDuplicates: true },
    ];

    it('links it to the library book with its title on the first upload', async () => {
      results['books.select'] = { data: [libraryBook], error: null };
      results['book_configs.select'] = {
        data: { xpointer: XPOINTER, progress: '[30,120]' },
        error: null,
      };
      const res = await put({ metadata });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ document: DOC, timestamp: 1790899200 });
      expect(calls).toEqual(
        expect.arrayContaining([
          // Readest's own copy of the file, or EPUBs titled alike. Characters
          // that are or() syntax become single-character wildcards.
          [
            'books',
            'or',
            `book_hash.eq.${DOC},source_title.ilike.Alice_ Illustrated _1865_,title.ilike.Alice_ Illustrated _1865_`,
          ],
          ['books', 'eq', 'format', 'EPUB'],
          ['books', 'is', 'deleted_at', null],
          linkWrite,
          ['book_configs', 'eq', 'book_hash', BOOK],
          ['book_configs', 'update', { xpointer: XPOINTER, progress: '[60,120]', updated_at: NOW }],
          ['books', 'update', { progress: [60, 120], updated_at: NOW }],
          ['books', 'eq', 'book_hash', BOOK],
        ]),
      );
      // Every book with that title is compared: a cut-off list could drop
      // Readest's own file or a second book that fits.
      expect(calls.some(([table, method]) => table === 'books' && method === 'limit')).toBe(false);
    });

    it("doesn't pull Readest's position back when it links", async () => {
      // The reader asked under the new id and found nothing, so it uploads
      // its own position.
      results['books.select'] = { data: [libraryBook], error: null };
      results['book_configs.select'] = {
        data: { xpointer: XPOINTER, progress: '[60,120]' },
        error: null,
      };
      expect((await put({ metadata, percentage: 0.01 })).status).toBe(200);
      expect(calls).toContainEqual(linkWrite);
      expect(wrote('book_configs')).toBe(false);
      expect(wrote('books')).toBe(false);
    });

    it('syncs a linked copy as the library book', async () => {
      results['crosspoint_documents.select'] = { data: { book_hash: BOOK }, error: null };
      results['book_configs.select'] = {
        data: { xpointer: XPOINTER, progress: '[30,120]', updated_at: '2026-10-01T00:00:00.000Z' },
        error: null,
      };
      const res = await get();
      expect(await res.json()).toMatchObject({ document: DOC, progress: XPOINTER });
      expect(calls).toEqual(
        expect.arrayContaining([
          ['crosspoint_documents', 'eq', 'user_id', USER],
          ['crosspoint_documents', 'eq', 'document', DOC],
          ['book_configs', 'eq', 'book_hash', BOOK],
        ]),
      );

      calls = [];
      await put({ metadata });
      expect(calls).toContainEqual(['book_configs', 'eq', 'book_hash', BOOK]);
      expect(calls.some(([table, method]) => table === 'books' && method === 'or')).toBe(false);
    });

    it('picks the book by its first author when titles collide', async () => {
      results['books.select'] = {
        data: [{ ...libraryBook, book_hash: 'f'.repeat(32), author: 'Someone Else' }, libraryBook],
        error: null,
      };
      await put({ metadata });
      expect(calls).toContainEqual(linkWrite);
    });

    // Never acknowledged under the copy's own id: the reader retries.
    it('reports database failures while linking', async () => {
      results['crosspoint_documents.select'] = { data: null, error: boom };
      expect((await get()).status).toBe(500);
      expect((await put({ metadata })).status).toBe(500);

      results['crosspoint_documents.select'] = { data: null, error: null };
      results['books.select'] = { data: null, error: boom };
      expect((await put({ metadata })).status).toBe(500);

      results['books.select'] = { data: [libraryBook], error: null };
      results['crosspoint_documents.upsert'] = { data: null, error: boom };
      expect((await put({ metadata })).status).toBe(500);

      expect(wrote('book_configs')).toBe(false);
      expect(wrote('books')).toBe(false);
    });

    // Libraries often hold the same book twice (an older import, another
    // edition): the copy goes to the one being read.
    it('picks the most recently read book when title and author tie', async () => {
      results['books.select'] = {
        data: [
          { ...libraryBook, book_hash: 'f'.repeat(32), updated_at: '2026-02-10T00:00:00.000Z' },
          { ...libraryBook, updated_at: '2026-10-03T00:00:00.000Z' },
          { ...libraryBook, book_hash: 'e'.repeat(32), updated_at: '2026-05-01T00:00:00.000Z' },
        ],
        error: null,
      };
      await put({ metadata });
      expect(calls).toContainEqual(linkWrite);
    });

    it('matches the first author whole, not as part of a longer name', async () => {
      results['books.select'] = {
        data: [
          { ...libraryBook, updated_at: '2026-02-10T00:00:00.000Z' },
          {
            ...libraryBook,
            book_hash: 'f'.repeat(32),
            author: 'Lewis Carrollton',
            updated_at: '2026-10-03T00:00:00.000Z',
          },
        ],
        error: null,
      };
      await put({ metadata });
      expect(calls).toContainEqual(linkWrite);
    });

    it('keeps a copy it cannot place under its own id', async () => {
      const cases: [string, Record<string, unknown>, unknown[]][] = [
        ['without metadata', {}, [libraryBook]],
        ['with no book of that title', { metadata }, [{ ...libraryBook, source_title: 'Other' }]],
        [
          'when titles collide and no author was sent',
          { metadata: { title: TITLE } },
          [libraryBook, { ...libraryBook, book_hash: 'f'.repeat(32), author: 'Someone Else' }],
        ],
        // The file is Readest's own: nothing to link.
        ['for Readest’s own file', { metadata }, [libraryBook, { ...libraryBook, book_hash: DOC }]],
      ];
      for (const [, body, books] of cases) {
        calls = [];
        results['books.select'] = { data: books, error: null };
        expect((await put(body)).status).toBe(200);
        expect(wrote('crosspoint_documents')).toBe(false);
        expect(calls).toContainEqual(['book_configs', 'eq', 'book_hash', DOC]);
        expect(calls).not.toContainEqual(['book_configs', 'eq', 'book_hash', BOOK]);
      }
    });
  });

  it('reports database failures, but a failed library row update never fails a push', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    results['books.update'] = { data: null, error: boom };
    expect((await put({})).status).toBe(200);
    expect(warn).toHaveBeenCalled();

    calls = [];
    results['book_configs.upsert'] = { data: null, error: boom };
    expect((await put({})).status).toBe(500);
    expect(wrote('books')).toBe(false);

    results['book_configs.select'] = { data: null, error: boom };
    expect((await put({})).status).toBe(500);
    expect((await get()).status).toBe(500);
    warn.mockRestore();
  });
});
