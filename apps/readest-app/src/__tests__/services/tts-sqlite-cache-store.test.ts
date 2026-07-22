import { beforeEach, describe, expect, test } from 'vitest';

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { SqliteTTSCacheStore } from '@/services/tts/providers/sqliteCacheStore';

const BOUNDARIES = [{ offset: 0, duration: 1_000_000, text: 'word' }];

const entry = (size: number, fill = 1) => ({
  audio: new Uint8Array(size).fill(fill).buffer as ArrayBuffer,
  boundaries: BOUNDARIES,
  durationMs: 1234,
});

describe('SqliteTTSCacheStore', () => {
  let db: NodeDatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
  });

  const makeStore = (budgetBytes: number, startAt = 1_000) => {
    let now = startAt;
    return new SqliteTTSCacheStore(db, { budgetBytes, now: () => now++ });
  };

  test('round-trips audio, boundaries, and duration', async () => {
    const store = makeStore(1024 * 1024);
    await store.put('key1', entry(64, 7), { provider: 'edge-tts', voice: 'v1' });
    const got = await store.get('key1');
    expect(got).not.toBeNull();
    expect(got!.audio.byteLength).toBe(64);
    expect(new Uint8Array(got!.audio)[0]).toBe(7);
    expect(got!.boundaries).toEqual(BOUNDARIES);
    expect(got!.durationMs).toBe(1234);
  });

  test('misses return null', async () => {
    const store = makeStore(1024);
    await expect(store.get('nope')).resolves.toBeNull();
  });

  test('hits hand back an independent buffer per call', async () => {
    const store = makeStore(1024 * 1024);
    await store.put('key1', entry(16));
    const a = await store.get('key1');
    const b = await store.get('key1');
    expect(a!.audio).not.toBe(b!.audio);
  });

  test('evicts the least recently used entries once over budget', async () => {
    const store = makeStore(300);
    await store.put('a', entry(120));
    await store.put('b', entry(120));
    // Touch `a` so `b` becomes the oldest.
    await store.get('a');
    // 120*3 > 300: someone must go, and it must be `b`.
    await store.put('c', entry(120));
    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('c')).not.toBeNull();
  });

  test('an entry larger than the whole budget is not cached', async () => {
    const store = makeStore(100);
    await store.put('huge', entry(500));
    expect(await store.get('huge')).toBeNull();
  });

  test('replacing an entry under the same key does not double-count its size', async () => {
    const store = makeStore(300);
    await store.put('a', entry(200));
    await store.put('a', entry(200));
    await store.put('b', entry(90));
    // 200 + 90 fits: replacing `a` must not have evicted anything.
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('b')).not.toBeNull();
  });

  test('a second store over the same database sees persisted entries', async () => {
    const store = makeStore(1024 * 1024);
    await store.put('key1', entry(32));
    await store.flush();
    const reopened = makeStore(1024 * 1024, 9_000);
    const got = await reopened.get('key1');
    expect(got).not.toBeNull();
    expect(got!.boundaries).toEqual(BOUNDARIES);
  });
});
