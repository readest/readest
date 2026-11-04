import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const writes: Record<string, unknown>[] = [];
  return {
    rows,
    writes,
    // Stands in for PostgREST. A bulk upsert names its columns in `columns`, and
    // the merge is `SET col = EXCLUDED.col` for each of them, read with
    // json_to_recordset: a key missing from the body is written as NULL.
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return json([...rows.values()]);
      const columns = new URL(input.toString()).searchParams
        .get('columns')!
        .replaceAll('"', '')
        .split(',');
      const written = (JSON.parse(String(init.body)) as Record<string, unknown>[]).map((row) => {
        const key = (row['id'] ?? row['book_hash']) as string;
        const merged = { ...rows.get(key) };
        for (const column of columns) merged[column] = row[column] ?? null;
        rows.set(key, merged);
        writes.push(merged);
        return merged;
      });
      return json(written);
    },
  };
});

vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'test-user' }, token: 'test-token' }),
}));
// The real client: what it sends for a key set to undefined is the bug here.
vi.mock('@/utils/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createSupabaseClient: () =>
      createClient('http://postgrest.test', 'anon', {
        global: { fetch: db.fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  };
});

import { POST } from '@/pages/api/sync';

const ANCHOR = { spine: 1, start_offset: 10, end_offset: 15 };
const STROKES = [{ points: [[1, 2]] }];
const STORED_AT = Date.UTC(2026, 10, 4, 10);

const stored = (id: string, columns: Row = {}): Row => ({
  user_id: 'test-user',
  book_hash: 'h1',
  meta_hash: 'm1',
  id,
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  xpointer0: '/body/p[1]/text().0',
  xpointer1: '/body/p[1]/text().5',
  page: 1,
  text: 'hello',
  style: 'highlight',
  color: 'yellow',
  note: '',
  global: null,
  ink: null,
  crosspoint: null,
  created_at: new Date(STORED_AT).toISOString(),
  updated_at: new Date(STORED_AT).toISOString(),
  deleted_at: null,
  ...columns,
});

// A push from a client that has never heard of global, ink or crosspoint.
const edit = (id: string, fields: Row = {}): Row => ({
  bookHash: 'h1',
  metaHash: 'm1',
  id,
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  xpointer0: '/body/p[1]/text().0',
  xpointer1: '/body/p[1]/text().5',
  page: 1,
  text: 'hello',
  style: 'highlight',
  color: 'blue',
  note: '',
  createdAt: STORED_AT,
  updatedAt: STORED_AT + 1000,
  ...fields,
});

const post = (payload: { notes?: Row[]; configs?: Row[] }) =>
  POST(
    new Request('https://example.com/api/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }) as unknown as NextRequest,
  );
const push = (notes: Row[]) => post({ notes });

beforeEach(() => {
  db.rows.clear();
  db.writes.length = 0;
});

// Older apps and the KOReader plugin never send these columns.
describe('a note pushed without a column', () => {
  it('keeps what is stored', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR, global: true, ink: STROKES }));
    await push([edit('n1')]);
    expect(db.rows.get('n1')).toMatchObject({
      color: 'blue',
      crosspoint: ANCHOR,
      global: true,
      ink: STROKES,
    });
  });

  it('forgets the anchor when new text means the range moved', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await push([edit('n1', { text: 'a different passage' })]);
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null });
  });

  it('still lets an explicit null clear it', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await push([edit('n1', { crosspoint: null })]);
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null });
  });
});

describe('an anchor on a note that loses the row', () => {
  const pushAnchor = () => push([edit('n1', { updatedAt: STORED_AT, crosspoint: ANCHOR })]);

  it('is stored, leaving the row and its timestamp alone', async () => {
    db.rows.set('n1', stored('n1', { note: 'written on another device' }));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({
      crosspoint: ANCHOR,
      note: 'written on another device',
      updated_at: new Date(STORED_AT).toISOString(),
    });
  });

  it.each([
    ['deleted', { deleted_at: new Date(STORED_AT + 5000).toISOString() }],
    ['moved', { text: 'moved on another device' }],
  ])('is not stored on a note %s since', async (_name, columns) => {
    db.rows.set('n1', stored('n1', columns));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null });
  });
});

// A book under a second hash, an OPDS re-download say, shares its meta_hash.
describe('a note with no row under this copy but one under another', () => {
  const secondCopy = (fields: Row) => edit('n1', { bookHash: 'h2', ...fields });

  it('stays out when it is stale', async () => {
    db.rows.set('n1', stored('n1', { note: 'written on the tablet' }));
    const response = await push([secondCopy({ updatedAt: STORED_AT - 1000 })]);
    expect(db.writes).toEqual([]);
    expect((await response.json()).notes[0]).toMatchObject({ note: 'written on the tablet' });
  });

  it('stays out when it is older than the stored deletion', async () => {
    db.rows.set('n1', stored('n1', { deleted_at: new Date(STORED_AT + 5000).toISOString() }));
    await push([secondCopy({ updatedAt: STORED_AT + 1000 })]);
    expect(db.writes).toEqual([]);
  });

  it('goes in when it was edited on this copy', async () => {
    db.rows.set('n1', stored('n1'));
    await push([secondCopy({ note: 'written here' })]);
    expect(db.writes).toEqual([expect.objectContaining({ book_hash: 'h2', note: 'written here' })]);
  });
});

describe('a progress push from KOReader', () => {
  it('keeps the settings and replaces the whole reading position', async () => {
    db.rows.set('h1', {
      user_id: 'test-user',
      book_hash: 'h1',
      meta_hash: 'm1',
      location: 'epubcfi(/6/4!/4/2/1:0)',
      xpointer: '/old',
      rsvp_position: '{"wordText":"hello"}',
      search_config: '{"scope":"section"}',
      view_settings: '{"referencePageCount":200}',
      updated_at: new Date(STORED_AT).toISOString(),
    });
    await post({
      configs: [{ bookHash: 'h1', metaHash: 'm1', xpointer: '/new', updatedAt: STORED_AT + 1000 }],
    });
    expect(db.rows.get('h1')).toMatchObject({
      location: null,
      xpointer: '/new',
      rsvp_position: '{"wordText":"hello"}',
      search_config: '{"scope":"section"}',
      view_settings: '{"referencePageCount":200}',
    });
  });
});
