import { HlcGenerator } from '@/libs/crdt';
import { LocalStorageHlcStore, type HlcSnapshotStore } from '@/libs/hlcStore';
import { ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { ReplicaSyncManager, type CursorStore } from './replicaSyncManager';

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
