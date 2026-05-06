import { HlcGenerator, hlcCompare } from '@/libs/crdt';
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
    this.dirty.set(dirtyKeyOf(row), row);
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

  async pull(kind: string): Promise<ReplicaRow[]> {
    const since = this.opts.cursorStore.get(kind);
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
