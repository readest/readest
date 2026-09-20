import { bookshelfReplicaSchema } from './replica';
import type { ReplicaRow } from '@/types/replica';
import { mergeBookshelfRows } from './state';

const PREFIX = 'readest.bookshelf.pending.v1:';
const keyOf = (row: ReplicaRow) => `${PREFIX}${row.user_id}:${row.replica_id}`;
export const readPendingBookshelves = (): ReplicaRow[] => {
  if (typeof localStorage === 'undefined') return [];
  const rows: ReplicaRow[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const row = JSON.parse(localStorage.getItem(key) || 'null') as ReplicaRow | null;
      if (row && bookshelfReplicaSchema.safeParse(row).success) rows.push(row);
    } catch {
      /* Ignore corrupt entries; never turn them into definitions. */
    }
  }
  return rows;
};
export const journalBookshelfOperation = (row: ReplicaRow) => {
  const key = keyOf(row);
  const previous = localStorage.getItem(key);
  localStorage.setItem(
    key,
    JSON.stringify(previous ? mergeBookshelfRows(JSON.parse(previous) as ReplicaRow, row) : row),
  );
};
/** An acknowledgment may only clear the exact field versions it sent. */
export const acknowledgeBookshelfOperation = (ack: ReplicaRow) => {
  const key = keyOf(ack);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const current = JSON.parse(raw) as ReplicaRow;
  const fields = { ...current.fields_jsonb };
  for (const [name, field] of Object.entries(ack.fields_jsonb)) {
    if (fields[name]?.t === field.t && fields[name]?.s === field.s) delete fields[name];
  }
  const deleted = current.deleted_at_ts === ack.deleted_at_ts ? null : current.deleted_at_ts;
  if (!Object.keys(fields).length && !deleted) localStorage.removeItem(key);
  else
    localStorage.setItem(
      key,
      JSON.stringify({ ...current, fields_jsonb: fields, deleted_at_ts: deleted }),
    );
};
/** Anonymous edits bind once, keeping their original logical timestamps. */
export const bindBookshelfOperation = (row: ReplicaRow, userId: string): ReplicaRow => {
  if (row.user_id || !userId) return row;
  const bound = { ...row, user_id: userId };
  journalBookshelfOperation(bound);
  localStorage.removeItem(keyOf(row));
  return bound;
};
