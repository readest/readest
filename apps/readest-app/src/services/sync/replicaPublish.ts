import { setField, removeReplica, hlcMax } from '@/libs/crdt';
import { getUserID } from '@/utils/access';
import { getReplicaAdapter } from './replicaRegistry';
import { getReplicaSync } from './replicaSync';
import type { FieldsObject, Hlc, ReplicaRow } from '@/types/replica';

/**
 * Build + push a CRDT row for an upsert of a single replica record.
 * Each field gets a fresh HLC stamp; updated_at_ts is the max of all
 * field stamps. The row is queued via replicaSyncManager.markDirty
 * (5s debounced push, immediate flush on visibilitychange / online).
 *
 * No-op when:
 *   - replica sync is not initialized (e.g., user signed out)
 *   - the kind has no registered adapter
 *   - the user is not authenticated
 */
export const publishReplicaUpsert = async <T>(
  kind: string,
  record: T,
  contentId: string,
  reincarnation?: string,
): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  const adapter = getReplicaAdapter<T>(kind);
  if (!adapter) return;
  const userId = await getUserID();
  if (!userId) return;

  const packed = adapter.pack(record);
  let fields: FieldsObject = {};
  let maxFieldHlc: Hlc | null = null;
  for (const [key, value] of Object.entries(packed)) {
    const t = ctx.hlc.next();
    fields = setField(fields, key, value, t, ctx.deviceId);
    maxFieldHlc = hlcMax(maxFieldHlc, t);
  }

  const updatedAt = maxFieldHlc ?? ctx.hlc.next();

  const row: ReplicaRow = {
    user_id: userId,
    kind,
    replica_id: contentId,
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: reincarnation ?? null,
    updated_at_ts: updatedAt,
    schema_version: adapter.schemaVersion,
  };
  ctx.manager.markDirty(row);
};

/**
 * Tombstone a replica row by contentId. The row carries no fields —
 * just the deleted_at_ts HLC. Per remove-wins semantics, a later
 * field write does NOT revive this row; only an explicit
 * reincarnation token does.
 *
 * No-op when replica sync isn't initialized or the user isn't
 * authenticated.
 */
export const publishReplicaDelete = async (kind: string, contentId: string): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  const adapter = getReplicaAdapter(kind);
  if (!adapter) return;
  const userId = await getUserID();
  if (!userId) return;

  const tombstoneHlc = ctx.hlc.next();
  const baseRow: ReplicaRow = {
    user_id: userId,
    kind,
    replica_id: contentId,
    fields_jsonb: {},
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: tombstoneHlc,
    schema_version: adapter.schemaVersion,
  };
  ctx.manager.markDirty(removeReplica(baseRow, tombstoneHlc));
};

/**
 * Publish a manifest for an existing replica row. Called once binary
 * uploads complete (transferManager fires `replica-transfer-complete`).
 * The fields_jsonb is empty — server-side per-field LWW preserves the
 * existing fields; only manifest_jsonb is updated. updated_at_ts =
 * fresh HLC so the manifest wins over any prior null value on the
 * row.
 *
 * No-ops when sync isn't initialized or the user isn't authenticated.
 */
export const publishReplicaManifest = async (
  kind: string,
  contentId: string,
  files: { filename: string; byteSize: number; partialMd5: string }[],
  reincarnation?: string,
): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  const adapter = getReplicaAdapter(kind);
  if (!adapter) return;
  const userId = await getUserID();
  if (!userId) return;

  const updatedAt = ctx.hlc.next();
  const row: ReplicaRow = {
    user_id: userId,
    kind,
    replica_id: contentId,
    fields_jsonb: {},
    manifest_jsonb: { files, schemaVersion: 1 },
    deleted_at_ts: null,
    reincarnation: reincarnation ?? null,
    updated_at_ts: updatedAt,
    schema_version: adapter.schemaVersion,
  };
  ctx.manager.markDirty(row);
};
