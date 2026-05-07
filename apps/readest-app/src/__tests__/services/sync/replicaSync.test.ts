import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  __resetReplicaSyncForTests,
  getReplicaSync,
  initReplicaSync,
  isReplicaSyncReady,
} from '@/services/sync/replicaSync';
import { __resetSettledEventsForTests } from '@/utils/event';
import { InMemoryHlcStore } from '@/libs/hlcStore';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { CursorStore } from '@/services/sync/replicaSyncManager';

const makeMemoryCursorStore = (): CursorStore => {
  const map = new Map<string, Hlc>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
  };
};

const makeFakeClient = () => ({
  push: vi.fn(async (rows: ReplicaRow[]) => rows),
  pull: vi.fn(async (_kind: string, _since: Hlc | null) => [] as ReplicaRow[]),
});

afterEach(() => {
  __resetReplicaSyncForTests();
  __resetSettledEventsForTests();
});

describe('replicaSync singleton', () => {
  test('getReplicaSync returns null before init', () => {
    expect(getReplicaSync()).toBe(null);
    expect(isReplicaSyncReady()).toBe(false);
  });

  test('initReplicaSync produces a manager + hlc context', () => {
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(ctx.manager).toBeDefined();
    expect(ctx.hlc).toBeDefined();
    expect(ctx.deviceId).toBe('dev-a');
    expect(isReplicaSyncReady()).toBe(true);
  });

  test('subsequent initReplicaSync calls are idempotent (return same instance)', () => {
    const a = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    const b = initReplicaSync({
      deviceId: 'dev-different',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(b).toBe(a);
    expect(b.deviceId).toBe('dev-a');
  });

  test('hlc.next() persists snapshot to the injected store', () => {
    const hlcStore = new InMemoryHlcStore();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    expect(hlcStore.load()).toBe(null);
    ctx.hlc.next();
    const snap = hlcStore.load();
    expect(snap).not.toBe(null);
    expect(snap!.counter).toBeGreaterThanOrEqual(0);
  });

  test('hlc.observe() persists snapshot to the injected store', () => {
    const hlcStore = new InMemoryHlcStore();
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    ctx.hlc.observe('fffffffffffff-00000000-dev-other' as Hlc);
    expect(hlcStore.load()).not.toBe(null);
  });

  test('init restores from existing snapshot (counter survives reload)', () => {
    const hlcStore = new InMemoryHlcStore();
    // Choose a far-future ms so the wall clock won't advance past it during
    // the test — that way next() bumps the counter rather than the ms.
    const farFutureMs = Date.now() + 10 * 60 * 60 * 1000;
    hlcStore.save({ physicalMs: farFutureMs, counter: 42 });
    const ctx = initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore,
      client: makeFakeClient() as never,
    });
    const serialized = ctx.hlc.serialize();
    expect(serialized.physicalMs).toBe(farFutureMs);
    expect(serialized.counter).toBe(42);
    ctx.hlc.next();
    expect(ctx.hlc.serialize().counter).toBe(43);
  });

  test('__resetReplicaSyncForTests clears the singleton', () => {
    initReplicaSync({
      deviceId: 'dev-a',
      cursorStore: makeMemoryCursorStore(),
      hlcStore: new InMemoryHlcStore(),
      client: makeFakeClient() as never,
    });
    expect(isReplicaSyncReady()).toBe(true);
    __resetReplicaSyncForTests();
    expect(isReplicaSyncReady()).toBe(false);
    expect(getReplicaSync()).toBe(null);
  });
});
