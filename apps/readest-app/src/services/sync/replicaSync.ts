import { HlcGenerator } from '@/libs/crdt';
import { LocalStorageHlcStore, type HlcSnapshotStore } from '@/libs/hlcStore';
import { ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { markSettled, onSettled } from '@/utils/event';
import { ReplicaSyncManager, type CursorStore } from './replicaSyncManager';

const REPLICA_SYNC_READY_EVENT = 'replica-sync-ready';

export interface ReplicaSyncInitOpts {
  deviceId: string;
  cursorStore: CursorStore;
  hlcStore?: HlcSnapshotStore;
  client?: Pick<ReplicaSyncClient, 'push' | 'pull'>;
}

export interface ReplicaSyncContext {
  manager: ReplicaSyncManager;
  hlc: HlcGenerator;
  deviceId: string;
}

let instance: ReplicaSyncContext | null = null;

/**
 * Subscribe to be notified when `initReplicaSync` completes. Used by
 * useReplicaPull to recover from the boot race where appService
 * resolves first and triggers the hook's effect, but
 * `await service.loadSettings()` hasn't yet returned, so
 * `initReplicaSync` is still pending. The hook reads the singleton
 * synchronously and would early-return with no recovery path; the
 * subscription gives it a way to retry once the singleton lands.
 *
 * Listener fires once the singleton is created. If the singleton
 * already exists when subscribe is called, the listener is invoked
 * synchronously (replay) so callers don't need to deal with the race.
 *
 * Returns an unsubscribe function. Idempotent; safe to call from
 * effect cleanups. Backed by `onSettled('replica-sync-ready')`.
 */
export const subscribeReplicaSyncReady = (listener: () => void): (() => void) =>
  onSettled(REPLICA_SYNC_READY_EVENT, () => listener());

const wrapHlcWithPersistence = (hlc: HlcGenerator, hlcStore: HlcSnapshotStore): HlcGenerator => {
  const originalNext = hlc.next.bind(hlc);
  const originalObserve = hlc.observe.bind(hlc);
  hlc.next = () => {
    const v = originalNext();
    hlcStore.save(hlc.serialize());
    return v;
  };
  hlc.observe = (remote) => {
    originalObserve(remote);
    hlcStore.save(hlc.serialize());
  };
  return hlc;
};

export const initReplicaSync = (opts: ReplicaSyncInitOpts): ReplicaSyncContext => {
  if (instance) return instance;

  const hlcStore = opts.hlcStore ?? new LocalStorageHlcStore();
  const snapshot = hlcStore.load();
  const baseHlc = snapshot
    ? HlcGenerator.restore(snapshot, opts.deviceId)
    : new HlcGenerator(opts.deviceId);
  const hlc = wrapHlcWithPersistence(baseHlc, hlcStore);

  const client = opts.client ?? new ReplicaSyncClient();

  const manager = new ReplicaSyncManager({
    hlc,
    client,
    cursorStore: opts.cursorStore,
  });

  instance = { manager, hlc, deviceId: opts.deviceId };
  void markSettled(REPLICA_SYNC_READY_EVENT);
  return instance;
};

export const getReplicaSync = (): ReplicaSyncContext | null => instance;

export const isReplicaSyncReady = (): boolean => instance !== null;

export const __resetReplicaSyncForTests = (): void => {
  if (instance) {
    instance.manager.stopAutoSync();
  }
  instance = null;
};
