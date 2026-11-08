import { describe, expect, it } from 'vitest';
import { HlcGenerator, hlcParse } from '@/libs/crdt';
import {
  createBookshelfOrderRows,
  readBookshelfItemOrders,
} from '@/services/bookshelves/orderRecords';
import { bookshelfReplicaSchema } from '@/services/bookshelves/replica';
import { mergeBookshelfStates } from '@/services/bookshelves/state';

describe('bounded bookshelf item order records', () => {
  const hlc = new HlcGenerator('test');
  const clock = { userId: 'account', deviceId: 'test', next: () => hlc.next() };
  const ids = Array.from({ length: 2000 }, (_, i) => `b:${i.toString(16).padStart(32, '0')}`);
  it('roundtrips a large order in bounded, valid replica records without exposing partial revisions', () => {
    const rows = createBookshelfOrderRows('default', 'group:', ids, clock);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => bookshelfReplicaSchema.safeParse(row).success)).toBe(true);
    expect(readBookshelfItemOrders(rows.slice(1))).toEqual({ orders: {}, updatedAt: {} });
    expect(readBookshelfItemOrders([...rows].reverse())).toEqual({
      orders: { default: { 'group:': ids } },
      updatedAt: { default: { 'group:': hlcParse(rows[0]!.updated_at_ts).physicalMs } },
    });
  });
  it('converges on the latest complete order and clears a renamed scope without reviving old chunks', () => {
    const old = createBookshelfOrderRows('default', 'group:', ids, clock);
    const next = createBookshelfOrderRows('default', 'group:', ['b:new'], clock);
    const state = mergeBookshelfStates(
      { rows: Object.fromEntries(old.map((row) => [row.replica_id, row])) },
      { rows: Object.fromEntries(next.map((row) => [row.replica_id, row])) },
    );
    expect(readBookshelfItemOrders(Object.values(state.rows)).orders).toEqual({
      default: { 'group:': ['b:new'] },
    });
    const cleared = createBookshelfOrderRows('default', 'group:', [], clock);
    const merged = mergeBookshelfStates(state, {
      rows: Object.fromEntries(cleared.map((row) => [row.replica_id, row])),
    });
    expect(readBookshelfItemOrders(Object.values(merged.rows)).orders).toEqual({
      default: { 'group:': [] },
    });
  });
  it('keeps independent shelves and parent groups separate', () => {
    const rows = [
      ...createBookshelfOrderRows('default', 'group:', ['b:root'], clock),
      ...createBookshelfOrderRows('default', 'group:Fiction', ['b:child'], clock),
      ...createBookshelfOrderRows('recent', 'group:', ['b:recent'], clock),
    ];
    expect(readBookshelfItemOrders(rows).orders).toEqual({
      default: { 'group:': ['b:root'], 'group:Fiction': ['b:child'] },
      recent: { 'group:': ['b:recent'] },
    });
  });

  it('retains the reorder time across a rename or rollback and reads older records', () => {
    const rows = createBookshelfOrderRows('default', 'group:Fiction', ids, clock, 100);
    expect(readBookshelfItemOrders(rows).updatedAt).toEqual({ default: { 'group:Fiction': 100 } });
    const old = createBookshelfOrderRows('default', 'group:', ['b:old'], clock);
    const field = old[0]!.fields_jsonb['itemOrder']!;
    const { orderedAt: _time, ...value } = field.v as { orderedAt: number } & Record<
      string,
      unknown
    >;
    field.v = value;
    expect(readBookshelfItemOrders(old).updatedAt).toEqual({
      default: { 'group:': hlcParse(field.t).physicalMs },
    });
    const changed = {
      ...rows[0]!,
      fields_jsonb: {
        ...rows[0]!.fields_jsonb,
        itemOrder: {
          ...rows[0]!.fields_jsonb['itemOrder']!,
          v: { ...(rows[0]!.fields_jsonb['itemOrder']!.v as object), orderedAt: 200 },
        },
      },
    };
    expect(readBookshelfItemOrders([changed, ...rows.slice(1)])).toEqual({
      orders: {},
      updatedAt: {},
    });
  });
});
