import { bookshelfReplicaSchema, mergeBookshelfRows } from './replica';
import type { ReplicaRow } from '@/types/replica';
import type { BookshelfReplicaRow } from '@/types/bookshelf';

const PREFIX = 'readest.bookshelf.pending.v1:';
const BATCH_PREFIX = 'readest.bookshelf.batch.v1:';
// Retained with published shelf history, including after acknowledgment. This
// distinguishes publication from local deletion for stale windows/settings.
const publicationKey = (id: string) => `readest.bookshelf.published.v1:${id}`;
const keyOf = (row: ReplicaRow) => `${PREFIX}${row.user_id}:${row.replica_id}`;
/** A corrupt or schema-invalid entry is indistinguishable from no entry. */
const readEntry = (key: string): BookshelfReplicaRow | null => {
  try {
    const row = JSON.parse(localStorage.getItem(key) || 'null') as BookshelfReplicaRow | null;
    return row && bookshelfReplicaSchema.safeParse(row).success ? row : null;
  } catch {
    return null;
  }
};
const readBatches = (): { key: string; rows: BookshelfReplicaRow[] }[] => {
  const batches: { key: string; rows: BookshelfReplicaRow[] }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(BATCH_PREFIX)) continue;
    try {
      const rows = JSON.parse(localStorage.getItem(key) || 'null') as unknown;
      if (Array.isArray(rows) && rows.every((row) => bookshelfReplicaSchema.safeParse(row).success))
        batches.push({ key, rows: rows as BookshelfReplicaRow[] });
    } catch {
      /* Leave unreadable recovery records alone. */
    }
  }
  return batches;
};
export const readPendingBookshelves = (): BookshelfReplicaRow[] => {
  if (typeof localStorage === 'undefined') return [];
  const rows: BookshelfReplicaRow[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const row = readEntry(key);
    if (row) rows.push(row);
  }
  const merged = new Map(rows.map((row) => [keyOf(row), row]));
  for (const batch of readBatches())
    for (const row of batch.rows) {
      const previous = merged.get(keyOf(row));
      merged.set(keyOf(row), previous ? mergeBookshelfRows(previous, row) : row);
    }
  return [...merged.values()];
};
/** Stale settings snapshots cannot revive a discarded anonymous creation. */
export const resolveLocalBookshelf = (row: BookshelfReplicaRow): BookshelfReplicaRow | null => {
  if (!row.localOnly || typeof localStorage === 'undefined') return row;
  try {
    const userId = localStorage.getItem(publicationKey(row.replica_id));
    if (userId) {
      const { localOnly: _localOnly, ...replica } = row;
      const published = { ...replica, user_id: userId };
      const pending = readEntry(keyOf(published));
      return pending ? mergeBookshelfRows(published, pending) : published;
    }
    return localStorage.getItem(keyOf(row)) === null &&
      !readBatches().some((batch) => batch.rows.some((pending) => keyOf(pending) === keyOf(row)))
      ? null
      : row;
  } catch {
    // An inaccessible journal is not proof that the shelf was discarded.
    return row;
  }
};

export const journalBookshelfOperation = (row: BookshelfReplicaRow): BookshelfReplicaRow | null => {
  const key = keyOf(row);
  const previous = readEntry(key);
  // Only explicit local provenance permits collection. Legacy and published
  // tombstones must survive: no server/device acknowledgment horizon exists
  // yet, so age alone cannot prove that an offline device won't revive them.
  if (
    !row.user_id &&
    previous?.localOnly &&
    row.deleted_at_ts &&
    !localStorage.getItem(publicationKey(row.replica_id))
  ) {
    localStorage.removeItem(key);
    return null;
  }
  const merged = previous ? mergeBookshelfRows(previous, row) : row;
  localStorage.setItem(key, JSON.stringify(merged));
  return merged;
};

/** Stage the entire revision atomically before replacing any of its old chunks. */
export const journalBookshelfBatch = (rows: BookshelfReplicaRow[]) => {
  const key = `${BATCH_PREFIX}${crypto.randomUUID()}`;
  localStorage.setItem(key, JSON.stringify(rows));
  const journaled = rows.map(journalBookshelfOperation);
  localStorage.removeItem(key);
  return journaled;
};

export const recoverBookshelfBatches = () => {
  for (const { key, rows } of readBatches()) {
    rows.forEach(journalBookshelfOperation);
    localStorage.removeItem(key);
  }
};
/** An acknowledgment may only clear the exact field versions it sent. */
export const acknowledgeBookshelfOperation = (ack: ReplicaRow) => {
  const key = keyOf(ack);
  if (!localStorage.getItem(key)) return;
  const current = readEntry(key);
  if (!current) {
    localStorage.removeItem(key);
    return;
  }
  const fields = { ...current.fields_jsonb };
  for (const [name, field] of Object.entries(ack.fields_jsonb)) {
    if (fields[name]?.t === field.t && fields[name]?.s === field.s) delete fields[name];
  }
  // Deletion is remove-wins, and the row envelope is restamped at push time, so
  // any acknowledged tombstone settles the journaled one whatever its stamp.
  const deleted = ack.deleted_at_ts ? null : current.deleted_at_ts;
  if (!Object.keys(fields).length && !deleted) localStorage.removeItem(key);
  else
    localStorage.setItem(
      key,
      JSON.stringify({ ...current, fields_jsonb: fields, deleted_at_ts: deleted }),
    );
};
/** Anonymous edits bind once, keeping their original logical timestamps. */
export const bindBookshelfOperation = (row: BookshelfReplicaRow, userId: string): ReplicaRow => {
  if (row.user_id || !userId) return row;
  const { localOnly: _localOnly, ...replica } = row;
  const publishedUser = localStorage.getItem(publicationKey(row.replica_id));
  const bound = { ...replica, user_id: publishedUser || userId };
  // Write the receipt BEFORE a publishable journal row. A crash or quota error
  // must never leave a publishable row that another window can still discard.
  if (row.localOnly) localStorage.setItem(publicationKey(row.replica_id), bound.user_id);
  journalBookshelfOperation(bound);
  localStorage.removeItem(keyOf(row));
  return bound;
};
