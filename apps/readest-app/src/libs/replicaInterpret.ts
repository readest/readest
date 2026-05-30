import { hlcCompare } from './crdt';
import type { ReplicaRow } from '@/types/replica';

/**
 * Interpret remove-wins + reincarnation semantics for a pulled row.
 *
 * Per the plan: tombstones never disappear at the merge level. A row is
 * "alive" if it was never deleted, OR if a reincarnation token was minted
 * AFTER the tombstone. The specific check uses HLC ordering — `>=` rather
 * than `>` so that a same-HLC reincarnation (mid-tick edge) reads as alive.
 *
 * Used by the pull-side orchestrator to decide whether to surface a row
 * to the local store as a live entry or as a tombstone to soft-delete.
 */
export const isReplicaRowAlive = (row: ReplicaRow): boolean => {
  if (!row.deleted_at_ts) return true;
  if (!row.reincarnation) return false;
  return hlcCompare(row.updated_at_ts, row.deleted_at_ts) >= 0;
};
