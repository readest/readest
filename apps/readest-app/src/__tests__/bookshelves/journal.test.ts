import { beforeEach, describe, expect, it } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import {
  acknowledgeBookshelfOperation,
  journalBookshelfOperation,
  readPendingBookshelves,
  bindBookshelfOperation,
} from '@/services/bookshelves/journal';
import type { ReplicaRow } from '@/types/replica';
const clock = new HlcGenerator('device');
const row = (userId = 'account'): ReplicaRow => {
  const t = clock.next();
  return {
    user_id: userId,
    kind: 'bookshelf',
    replica_id: '00000000-0000-4000-8000-000000000001',
    fields_jsonb: {
      definition: {
        v: createBookshelf('Custom', '00000000-0000-4000-8000-000000000001'),
        t,
        s: 'device',
      },
    },
    updated_at_ts: t,
    deleted_at_ts: null,
    reincarnation: null,
    schema_version: 1,
    manifest_jsonb: null,
  };
};
beforeEach(() => localStorage.clear());
describe('durable bookshelf operations', () => {
  it('replays exact timestamps after restart and separates accounts', () => {
    const first = row();
    const other = row('other');
    journalBookshelfOperation(first);
    journalBookshelfOperation(other);
    expect(readPendingBookshelves()).toEqual(expect.arrayContaining([first, other]));
    acknowledgeBookshelfOperation(first);
    expect(readPendingBookshelves()).toEqual([other]);
  });
  it('retains edits made while an older version is being pushed', () => {
    const first = row();
    const latest = row();
    journalBookshelfOperation(first);
    journalBookshelfOperation(latest);
    acknowledgeBookshelfOperation(first);
    expect(readPendingBookshelves()).toEqual([latest]);
    acknowledgeBookshelfOperation(latest);
    expect(readPendingBookshelves()).toEqual([]);
  });
  it('retains a deletion when an earlier definition is acknowledged', () => {
    const first = row();
    const t = clock.next();
    const deletion = { ...first, fields_jsonb: {}, deleted_at_ts: t, updated_at_ts: t };
    journalBookshelfOperation(first);
    journalBookshelfOperation(deletion);
    acknowledgeBookshelfOperation(first);
    expect(readPendingBookshelves()).toEqual([deletion]);
  });
  it('binds anonymous edits once without restamping', () => {
    const first = row('');
    journalBookshelfOperation(first);
    const bound = bindBookshelfOperation(first, 'account');
    expect(bound.updated_at_ts).toBe(first.updated_at_ts);
    expect(readPendingBookshelves()).toEqual([bound]);
    expect(bindBookshelfOperation(bound, 'other')).toEqual(bound);
  });
});
