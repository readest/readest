import type { HlcSnapshot } from '@/libs/crdt';

export const HLC_LOCAL_STORAGE_KEY = 'readest_replica_hlc';

export interface HlcSnapshotStore {
  load(): HlcSnapshot | null;
  save(snapshot: HlcSnapshot): void;
}

export class InMemoryHlcStore implements HlcSnapshotStore {
  private snapshot: HlcSnapshot | null = null;

  load(): HlcSnapshot | null {
    return this.snapshot;
  }

  save(snapshot: HlcSnapshot): void {
    this.snapshot = snapshot;
  }
}

export class LocalStorageHlcStore implements HlcSnapshotStore {
  constructor(private readonly key: string = HLC_LOCAL_STORAGE_KEY) {}

  load(): HlcSnapshot | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as HlcSnapshot;
      if (typeof parsed?.physicalMs !== 'number' || typeof parsed?.counter !== 'number') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  save(snapshot: HlcSnapshot): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(snapshot));
    } catch {
      // localStorage unavailable (private mode, quota exceeded, SSR);
      // HLC reverts to in-memory only for this session. Documented as a
      // tolerable degradation; clients re-derive from server max(updated_at_ts)
      // on next pull per replicaSyncManager.
    }
  }
}
