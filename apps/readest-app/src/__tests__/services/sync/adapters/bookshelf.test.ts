import { describe, expect, test } from 'vitest';
import { bookshelfAdapter } from '@/services/sync/adapters/bookshelf';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { hlcPack } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';

const NOW = 1_700_000_000_000;
const DEV = 'dev-a';
const HLC = hlcPack(NOW, 0, DEV) as Hlc;
const SHELF_ID = '00000000-0000-4000-8000-000000000001';

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'bookshelf',
  replica_id: SHELF_ID,
  fields_jsonb: {
    definition: { v: createBookshelf('Sci-Fi', SHELF_ID), t: HLC, s: DEV },
    position: { v: 1536, t: HLC, s: DEV },
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
  ...overrides,
});

describe('bookshelfAdapter contract', () => {
  test('kind is "bookshelf" with schemaVersion 1 and metadata only', () => {
    expect(bookshelfAdapter.kind).toBe('bookshelf');
    expect(bookshelfAdapter.schemaVersion).toBe(1);
    expect(bookshelfAdapter.binary).toBeUndefined();
  });

  test('computeId is the shelf id itself', async () => {
    expect(await bookshelfAdapter.computeId(baseRow())).toBe(SHELF_ID);
  });

  test('unpack throws: shelves need the stamped row, not flattened fields', () => {
    expect(() => bookshelfAdapter.unpack({ position: 1536 })).toThrow();
  });
});

describe('pack', () => {
  test('flattens the field envelopes to their values', () => {
    const row = baseRow();
    expect(bookshelfAdapter.pack(row)).toEqual({
      definition: row.fields_jsonb['definition']!.v,
      position: 1536,
    });
  });

  test('a tombstone with no fields packs to an empty object', () => {
    expect(bookshelfAdapter.pack(baseRow({ fields_jsonb: {}, deleted_at_ts: HLC }))).toEqual({});
  });
});

describe('unpackRow', () => {
  test('keeps a row with a valid definition', () => {
    const row = baseRow();
    expect(bookshelfAdapter.unpackRow(row, '')).toBe(row);
  });

  test('returns null for a malformed definition', () => {
    const row = baseRow({
      fields_jsonb: { definition: { v: { id: SHELF_ID, name: 'Broken' }, t: HLC, s: DEV } },
    });
    expect(bookshelfAdapter.unpackRow(row, '')).toBe(null);
  });

  test('keeps a position-only row, so a move syncs without a definition', () => {
    const row = baseRow({ fields_jsonb: { position: { v: 1536, t: HLC, s: DEV } } });
    expect(bookshelfAdapter.unpackRow(row, '')).toBe(row);
  });
});
