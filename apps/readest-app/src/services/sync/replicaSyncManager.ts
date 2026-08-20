import { HlcGenerator, hlcCompare, hlcMax, mergeFields } from '@/libs/crdt';
import { isSyncError } from '@/libs/errors';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { ReplicaSyncClient } from '@/libs/replicaSyncClient';

/** "This backend's kind allowlist predates the client" — never a row/data problem. */
const isUnknownKindError = (err: unknown): boolean =>
  isSyncError(err) && err.code === 'UNKNOWN_KIND';

export interface CursorStore {
  get(kind: string): Hlc | null;
  set(kind: string, hlc: Hlc): void;
}

export interface ReplicaSyncManagerOpts {
  hlc: HlcGenerator;
  client: Pick<ReplicaSyncClient, 'push' | 'pull' | 'pullBatch'>;
  cursorStore: CursorStore;
  debounceMs?: number;
}

interface DirtyKey {
  kind: string;
  replicaId: string;
}

const dirtyKeyOf = (row: ReplicaRow): string => `${row.kind}::${row.replica_id}`;
const splitKey = (k: string): DirtyKey => {
  const idx = k.indexOf('::');
  return { kind: k.slice(0, idx), replicaId: k.slice(idx + 2) };
};

const mergeDirtyRows = (a: ReplicaRow, b: ReplicaRow): ReplicaRow => {
  if (a.user_id !== b.user_id || a.kind !== b.kind || a.replica_id !== b.replica_id) {
    throw new Error('mergeDirtyRows: identity mismatch');
  }

  const fields_jsonb = mergeFields(a.fields_jsonb, b.fields_jsonb);
  const deleted_at_ts = hlcMax(a.deleted_at_ts, b.deleted_at_ts);

  const reincarnationCandidates = [
    a.reincarnation ? { token: a.reincarnation, t: a.updated_at_ts } : null,
    b.reincarnation ? { token: b.reincarnation, t: b.updated_at_ts } : null,
  ].filter((c): c is { token: string; t: Hlc } => c !== null);
  const winningReincarnation =
    reincarnationCandidates.length === 0
      ? null
      : reincarnationCandidates.reduce((x, y) => (hlcCompare(x.t, y.t) >= 0 ? x : y));
  const reincarnation =
    winningReincarnation &&
    (!deleted_at_ts || hlcCompare(winningReincarnation.t, deleted_at_ts) > 0)
      ? winningReincarnation.token
      : null;

  const manifest_jsonb =
    b.manifest_jsonb === null
      ? a.manifest_jsonb
      : a.manifest_jsonb === null
        ? b.manifest_jsonb
        : hlcCompare(b.updated_at_ts, a.updated_at_ts) > 0
          ? b.manifest_jsonb
          : a.manifest_jsonb;

  return {
    user_id: a.user_id,
    kind: a.kind,
    replica_id: a.replica_id,
    fields_jsonb,
    manifest_jsonb,
    deleted_at_ts,
    reincarnation,
    updated_at_ts: hlcMax(a.updated_at_ts, b.updated_at_ts) ?? a.updated_at_ts,
    schema_version: Math.max(a.schema_version, b.schema_version),
  };
};

export class ReplicaSyncManager {
  private readonly dirty = new Map<string, ReplicaRow>();
  /**
   * Kinds this backend rejected with UNKNOWN_KIND — its allowlist predates
   * this client (a new replica kind ships in the app before the deployed
   * server learns it). One such kind fails the WHOLE batch, push or pull, so
   * we route around it instead of letting it take every other kind's sync
   * down. Session-scoped on purpose: a backend deploy heals it on the next
   * app start, with no persisted state to invalidate.
   */
  private readonly unsupportedKinds = new Set<string>();
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInstalled = false;
  private readonly visibilityHandler = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void this.flush().catch((e) => console.warn('replica sync flush on hide failed', e));
    }
  };
  private readonly onlineHandler = () => {
    void this.flush().catch((e) => console.warn('replica sync flush on online failed', e));
  };

  constructor(private readonly opts: ReplicaSyncManagerOpts) {
    this.debounceMs = opts.debounceMs ?? 5000;
  }

  markDirty(row: ReplicaRow): void {
    const key = dirtyKeyOf(row);
    const existing = this.dirty.get(key);
    this.dirty.set(key, existing ? mergeDirtyRows(existing, row) : row);
    this.scheduleDebouncedFlush();
  }

  private scheduleDebouncedFlush(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush().catch((e) => console.warn('replica sync debounced flush failed', e));
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty.size === 0) return;
    const entries = Array.from(this.dirty.entries()).filter(
      ([, row]) => !this.unsupportedKinds.has(row.kind),
    );
    if (entries.length === 0) return;
    const snapshot = entries.map(([, row]) => row);
    const snapshotKeys = entries.map(([key]) => key);

    const pushedKeys: string[] = [];
    let deferred: unknown = null;
    try {
      await this.opts.client.push(snapshot);
      pushedKeys.push(...snapshotKeys);
    } catch (err) {
      if (!isUnknownKindError(err)) throw err;
      // A single row whose kind the backend's allowlist predates 422s the
      // ENTIRE push, and the queue is only cleared on success — so without
      // this fallback that one row wedges every other kind's writes for the
      // rest of the session. Retry per kind: the known ones land, the
      // rejected kind is remembered and skipped from here on. Its rows stay
      // queued (harmless, bounded) in case the caller inspects them.
      const indexesByKind = new Map<string, number[]>();
      snapshot.forEach((row, i) => {
        const list = indexesByKind.get(row.kind);
        if (list) list.push(i);
        else indexesByKind.set(row.kind, [i]);
      });
      for (const [kind, indexes] of indexesByKind) {
        try {
          await this.opts.client.push(indexes.map((i) => snapshot[i]!));
          for (const i of indexes) pushedKeys.push(snapshotKeys[i]!);
        } catch (kindErr) {
          if (isUnknownKindError(kindErr)) this.unsupportedKinds.add(kind);
          else deferred ??= kindErr;
        }
      }
    }
    for (const key of pushedKeys) {
      const stillSame = this.dirty.get(key);
      if (stillSame === snapshot[snapshotKeys.indexOf(key)]) {
        this.dirty.delete(key);
      }
    }
    if (deferred) throw deferred;
  }

  async pull(kind: string, opts?: { since?: Hlc | null }): Promise<ReplicaRow[]> {
    // The boot orchestrator passes `{ since: null }` to do a full pull
    // that ignores the persisted cursor — this lets us recover when a
    // previous boot advanced the cursor past rows that never made it
    // into the local store (e.g., apply-without-persist bug). Periodic
    // sync (visibility / online) keeps using the cursor.
    const since = opts && 'since' in opts ? (opts.since ?? null) : this.opts.cursorStore.get(kind);
    const rows = await this.opts.client.pull(kind, since);
    this.observeAndAdvanceCursor(kind, rows);
    return rows;
  }

  /**
   * Batched pull for the incremental auto-sync path AND the boot full
   * re-fetch. Default behaviour (no opts): each kind uses its
   * persisted cursor — the cheap delta path used by focus / online /
   * periodic. Boot path passes `{ since: null }` so the same single
   * round-trip refreshes every kind from scratch, mirroring the
   * recovery semantics of the per-kind `pull(kind, { since: null })`
   * boot call.
   *
   * Returns a `Map<kind, rows>` covering every kind the backend answered
   * for, including those with no rows past the cursor (empty array). A kind
   * the backend REFUSED to answer for (UNKNOWN_KIND) is absent from the map
   * instead: that is "no information", and callers must not read it as "the
   * server has no rows" — applying an empty result would look identical to
   * the server having dropped every row of that kind.
   */
  async pullMany(
    kinds: string[],
    opts?: { since?: Hlc | null },
  ): Promise<Map<string, ReplicaRow[]>> {
    const out = new Map<string, ReplicaRow[]>();
    const wanted = kinds.filter((kind) => !this.unsupportedKinds.has(kind));
    if (wanted.length === 0) return out;
    const overrideSince = opts && 'since' in opts;
    const cursors = wanted.map((kind) => ({
      kind,
      since: overrideSince ? (opts.since ?? null) : this.opts.cursorStore.get(kind),
    }));
    let results: { kind: string; rows: ReplicaRow[] }[];
    try {
      results = await this.opts.client.pullBatch(cursors);
      for (const kind of wanted) out.set(kind, []);
    } catch (err) {
      if (!isUnknownKindError(err)) throw err;
      // One unknown kind 422s the whole batch. Re-issue the cursors one at a
      // time so the kinds this backend DOES know still sync, and remember
      // the offender so it never poisons another batch this session.
      results = [];
      const settled = await Promise.allSettled(
        cursors.map(async (cursor) => ({
          kind: cursor.kind,
          rows: await this.opts.client.pull(cursor.kind, cursor.since),
        })),
      );
      settled.forEach((result, i) => {
        const kind = cursors[i]!.kind;
        if (result.status === 'fulfilled') {
          out.set(kind, []);
          results.push(result.value);
          return;
        }
        if (isUnknownKindError(result.reason)) this.unsupportedKinds.add(kind);
        // Any other per-kind failure stays absent from the map too — no
        // information, retried on the next trigger.
      });
    }
    for (const { kind, rows } of results) {
      this.observeAndAdvanceCursor(kind, rows);
      out.set(kind, rows);
    }
    return out;
  }

  private observeAndAdvanceCursor(kind: string, rows: ReplicaRow[]): void {
    if (rows.length === 0) return;
    let maxHlc: Hlc = rows[0]!.updated_at_ts;
    for (const row of rows) {
      if (hlcCompare(row.updated_at_ts, maxHlc) > 0) maxHlc = row.updated_at_ts;
      this.opts.hlc.observe(row.updated_at_ts);
    }
    this.opts.cursorStore.set(kind, maxHlc);
  }

  startAutoSync(): void {
    if (this.autoSyncInstalled) return;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
    }
    this.autoSyncInstalled = true;
  }

  stopAutoSync(): void {
    if (!this.autoSyncInstalled) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
    }
    this.autoSyncInstalled = false;
  }

  pendingCount(): number {
    return this.dirty.size;
  }

  pendingKeys(): DirtyKey[] {
    return Array.from(this.dirty.keys()).map(splitKey);
  }
}
