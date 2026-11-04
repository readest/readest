import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  return {
    rows,
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
});

// A client that leaves a column out knows nothing of it. Older apps and the
// KOReader plugin never send these, so their edits must not erase them.
describe('a note pushed without a column added since that client shipped', () => {
  it('keeps the CrossPoint anchor and hands it back', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));

    const response = await push([edit('n1')]);

    expect(response.status).toBe(200);
    expect(db.rows.get('n1')).toMatchObject({ color: 'blue', crosspoint: ANCHOR });
    expect((await response.json()).notes[0].crosspoint).toEqual(ANCHOR);
  });

  it('keeps a global note global', async () => {
    db.rows.set('n1', stored('n1', { global: true }));
    await push([edit('n1')]);
    expect(db.rows.get('n1')).toMatchObject({ color: 'blue', global: true });
  });

  it('keeps the strokes of a drawing', async () => {
    db.rows.set('n1', stored('n1', { type: 'ink', ink: STROKES }));
    await push([edit('n1', { type: 'ink' })]);
    expect(db.rows.get('n1')).toMatchObject({ color: 'blue', ink: STROKES });
  });

  it('keeps an anchor when another note in the same push carries one', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    db.rows.set('n2', stored('n2'));
    const other = { spine: 2, start_offset: 1, end_offset: 2 };

    await push([edit('n1'), edit('n2', { crosspoint: other })]);

    expect(db.rows.get('n1')).toMatchObject({ crosspoint: ANCHOR });
    expect(db.rows.get('n2')).toMatchObject({ crosspoint: other });
  });
});

describe('a note pushed with the column', () => {
  it('clears an anchor sent as null, as a moved highlight does', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await push([edit('n1', { crosspoint: null, xpointer0: null, xpointer1: null })]);
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null, xpointer0: null });
  });

  it('replaces the anchor', async () => {
    const moved = { spine: 3, start_offset: 4, end_offset: 5 };
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await push([edit('n1', { crosspoint: moved })]);
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: moved });
  });

  it('turns a global note local', async () => {
    db.rows.set('n1', stored('n1', { global: true }));
    await push([edit('n1', { global: false })]);
    expect(db.rows.get('n1')).toMatchObject({ global: false });
  });
});

describe('a note pushed without winning the row', () => {
  const pushAnchor = (fields: Row = {}) =>
    push([edit('n1', { color: 'yellow', updatedAt: STORED_AT, crosspoint: ANCHOR, ...fields })]);

  it('stores the anchor and leaves the row and its timestamp alone', async () => {
    db.rows.set('n1', stored('n1', { note: 'written on another device' }));

    const response = await pushAnchor();

    expect(db.rows.get('n1')).toMatchObject({
      crosspoint: ANCHOR,
      note: 'written on another device',
      updated_at: new Date(STORED_AT).toISOString(),
    });
    expect((await response.json()).notes[0].crosspoint).toEqual(ANCHOR);
  });

  it('stores it on a highlight KOReader made, which has no cfi', async () => {
    db.rows.set('n1', stored('n1', { cfi: null }));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: ANCHOR, cfi: null });
  });

  it('does not store it on a highlight deleted on another device', async () => {
    const deletedAt = new Date(STORED_AT + 5000).toISOString();
    db.rows.set('n1', stored('n1', { deleted_at: deletedAt }));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null, deleted_at: deletedAt });
  });

  it('does not store one worked out from a range moved since', async () => {
    db.rows.set('n1', stored('n1', { text: 'moved on another device' }));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null });
    db.rows.set('n1', stored('n1', { cfi: 'epubcfi(/6/4!/4/2,/1:7,/1:12)' }));
    await pushAnchor();
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: null });
  });

  it('does not replace the anchor already stored', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await pushAnchor({ crosspoint: { spine: 9, start_offset: 1, end_offset: 2 } });
    expect(db.rows.get('n1')).toMatchObject({ crosspoint: ANCHOR });
  });
});

// KOReader sends the highlight's new text and keeps its id when a range moves.
describe('a range moved by a client that leaves the anchor out', () => {
  it('forgets the anchor of the old range', async () => {
    db.rows.set('n1', stored('n1', { crosspoint: ANCHOR }));
    await push([edit('n1', { text: 'a different passage', cfi: undefined })]);
    expect(db.rows.get('n1')).toMatchObject({ text: 'a different passage', crosspoint: null });
  });
});

describe('a config pushed without the columns KOReader never sends', () => {
  const storedConfig = (columns: Row = {}): Row => ({
    user_id: 'test-user',
    book_hash: 'h1',
    meta_hash: 'm1',
    location: 'epubcfi(/6/4!/4/2/1:0)',
    xpointer: '/body/p[1]/text().0',
    progress: '[10,100]',
    rsvp_position: '{"cfi":"epubcfi(/6/4!/4/2/1:0)","wordText":"hello"}',
    search_config: '{"scope":"section"}',
    view_settings: '{"proofreadRules":[{"id":"r1"}],"referencePageCount":200}',
    updated_at: new Date(STORED_AT).toISOString(),
    ...columns,
  });
  // What readest_syncconfig.lua sends.
  const koreaderPush = {
    bookHash: 'h1',
    metaHash: 'm1',
    progress: [50, 100],
    xpointer: '/body/p[9]/text().0',
    updatedAt: STORED_AT + 1000,
  };

  it('keeps the settings and the RSVP position', async () => {
    db.rows.set('h1', storedConfig());
    await post({ configs: [koreaderPush] });
    expect(db.rows.get('h1')).toMatchObject({
      view_settings: '{"proofreadRules":[{"id":"r1"}],"referencePageCount":200}',
      search_config: '{"scope":"section"}',
      rsvp_position: '{"cfi":"epubcfi(/6/4!/4/2/1:0)","wordText":"hello"}',
    });
  });

  // A pull takes the further of location and xpointer, so a stale location
  // kept beside KOReader's position would pull the reader to it.
  it('still replaces the whole reading position', async () => {
    db.rows.set('h1', storedConfig());
    await post({ configs: [koreaderPush] });
    expect(db.rows.get('h1')).toMatchObject({
      location: null,
      xpointer: '/body/p[9]/text().0',
      progress: '[50,100]',
    });
  });

  it('lets a purge clear them with explicit nulls', async () => {
    db.rows.set('h1', storedConfig());
    await post({
      configs: [{ ...koreaderPush, rsvpPosition: null, searchConfig: null, viewSettings: null }],
    });
    expect(db.rows.get('h1')).toMatchObject({
      rsvp_position: null,
      search_config: null,
      view_settings: null,
    });
  });

  it('lets a push that has settings replace them', async () => {
    db.rows.set('h1', storedConfig());
    await post({ configs: [{ ...koreaderPush, viewSettings: {}, searchConfig: {} }] });
    expect(db.rows.get('h1')).toMatchObject({ view_settings: '{}', search_config: '{}' });
  });
});
