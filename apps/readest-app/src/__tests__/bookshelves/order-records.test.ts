import { describe, expect, it } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
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
    expect(readBookshelfItemOrders(rows.slice(1))).toEqual({});
    expect(readBookshelfItemOrders([...rows].reverse())).toEqual({ default: { 'group:': ids } });
  });
  it('converges on the latest complete order and clears a renamed scope without reviving old chunks', () => {
    const old = createBookshelfOrderRows('default', 'group:', ids, clock);
    const next = createBookshelfOrderRows('default', 'group:', ['b:new'], clock);
    const state = mergeBookshelfStates(
      { rows: Object.fromEntries(old.map((row) => [row.replica_id, row])) },
      { rows: Object.fromEntries(next.map((row) => [row.replica_id, row])) },
    );
    expect(readBookshelfItemOrders(Object.values(state.rows))).toEqual({
      default: { 'group:': ['b:new'] },
    });
    const cleared = createBookshelfOrderRows('default', 'group:', [], clock);
    const merged = mergeBookshelfStates(state, {
      rows: Object.fromEntries(cleared.map((row) => [row.replica_id, row])),
    });
    expect(readBookshelfItemOrders(Object.values(merged.rows))).toEqual({
      default: { 'group:': [] },
    });
  });
  it('keeps independent shelves and parent groups separate', () => {
    const rows = [
      ...createBookshelfOrderRows('default', 'group:', ['b:root'], clock),
      ...createBookshelfOrderRows('default', 'group:Fiction', ['b:child'], clock),
      ...createBookshelfOrderRows('recent', 'group:', ['b:recent'], clock),
    ];
    expect(readBookshelfItemOrders(rows)).toEqual({
      default: { 'group:': ['b:root'], 'group:Fiction': ['b:child'] },
      recent: { 'group:': ['b:recent'] },
    });
  });
});
