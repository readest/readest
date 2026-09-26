import { beforeEach, describe, expect, it } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import {
  acknowledgeBookshelfOperation,
  journalBookshelfOperation,
  readPendingBookshelves,
  bindBookshelfOperation,
  resolveLocalBookshelf,
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
  it('keeps cached local data when its journal is unreadable rather than known absent', () => {
    const cached = { ...row(''), localOnly: true as const };
    const key = `readest.bookshelf.pending.v1::${cached.replica_id}`;
    localStorage.setItem(key, '{');
    expect(resolveLocalBookshelf(cached)).toEqual(cached);
    localStorage.removeItem(key);
    expect(resolveLocalBookshelf(cached)).toBeNull();
  });

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
  it('clears a tombstone acknowledged with a fresh push stamp', () => {
    const first = row();
    const t = clock.next();
    const deletion = { ...first, fields_jsonb: {}, deleted_at_ts: t, updated_at_ts: t };
    journalBookshelfOperation(first);
    journalBookshelfOperation(deletion);
    // The manager restamps the row envelope at push time, so the acknowledged
    // tombstone no longer carries the journaled timestamp.
    const pushed = clock.next();
    acknowledgeBookshelfOperation({
      ...deletion,
      fields_jsonb: first.fields_jsonb,
      deleted_at_ts: pushed,
      updated_at_ts: pushed,
    });
    expect(readPendingBookshelves()).toEqual([]);
  });
  it('treats a corrupt entry as absent when journaling and acknowledging', () => {
    const first = row();
    const key = `readest.bookshelf.pending.v1:account:${first.replica_id}`;
    localStorage.setItem(key, '{');
    journalBookshelfOperation(first);
    expect(readPendingBookshelves()).toEqual([first]);
    localStorage.setItem(key, '{');
    acknowledgeBookshelfOperation(first);
    expect(localStorage.getItem(key)).toBe(null);
  });
  it('never merges a schema-invalid entry into a new operation', () => {
    const first = row();
    const key = `readest.bookshelf.pending.v1:account:${first.replica_id}`;
    localStorage.setItem(key, JSON.stringify({ ...first, fields_jsonb: { bogus: 1 } }));
    journalBookshelfOperation(first);
    expect(readPendingBookshelves()).toEqual([first]);
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
