import { HlcGenerator, hlcCompare, hlcMax, mergeFields } from '@/libs/crdt';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { ReplicaSyncClient } from '@/libs/replicaSyncClient';

export interface CursorStore {
  get(kind: string): Hlc | null;
  set(kind: string, hlc: Hlc): void;
}

export interface ReplicaSyncManagerOpts {
  hlc: HlcGenerator;
  client: Pick<ReplicaSyncClient, 'push' | 'pull'>;
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
    const snapshot = Array.from(this.dirty.values());
    const snapshotKeys = Array.from(this.dirty.keys());
    try {
      await this.opts.client.push(snapshot);
      for (const k of snapshotKeys) {
        const stillSame = this.dirty.get(k);
        if (stillSame === snapshot[snapshotKeys.indexOf(k)]) {
          this.dirty.delete(k);
        }
      }
    } catch (err) {
      throw err;
    }
  }

  async pull(kind: string, opts?: { since?: Hlc | null }): Promise<ReplicaRow[]> {
    // The boot orchestrator passes `{ since: null }` to do a full pull
    // that ignores the persisted cursor — this lets us recover when a
    // previous boot advanced the cursor past rows that never made it
    // into the local store (e.g., apply-without-persist bug). Periodic
    // sync (visibility / online) keeps using the cursor.
    const since = opts && 'since' in opts ? (opts.since ?? null) : this.opts.cursorStore.get(kind);
    const rows = await this.opts.client.pull(kind, since);
    if (rows.length === 0) return rows;
    let maxHlc: Hlc = rows[0]!.updated_at_ts;
    for (const row of rows) {
      if (hlcCompare(row.updated_at_ts, maxHlc) > 0) maxHlc = row.updated_at_ts;
      this.opts.hlc.observe(row.updated_at_ts);
    }
    this.opts.cursorStore.set(kind, maxHlc);
    return rows;
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
