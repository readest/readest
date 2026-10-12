import { beforeEach, describe, expect, test, vi } from 'vitest';

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

  test('registers a long section in a few statements, keeping recorded keys', async () => {
    const store = makeStore(1024 * 1024);
    const marks = Array.from({ length: 300 }, (_, i) => `0:s${i}`);
    await store.registerSectionMarks(4, marks);
    await store.put('key7', entry(8));
    await store.recordMarkKey(4, 7, 'key7');
    // Each statement is a round trip to the database worker: a chapter
    // must not cost one per sentence.
    const execute = vi.spyOn(db, 'execute');
    await store.registerSectionMarks(4, [...marks.slice(0, 250), 'changed']);
    expect(execute.mock.calls.length).toBeLessThanOrEqual(5);
    const status = (await store.getSectionStatuses()).get(4);
    expect(status).toMatchObject({ total: 251, recorded: 1 });
  });

  test('tells which keys are cached in one query, however many', async () => {
    const store = makeStore(1024 * 1024);
    await store.put('a', entry(8));
    await store.put('b', entry(8));
    const keys = ['a', 'b', 'c', ...Array.from({ length: 1500 }, (_, i) => `k${i}`)];
    const select = vi.spyOn(db, 'select');
    expect(await store.cachedKeys(keys)).toEqual(new Set(['a', 'b']));
    expect(select.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test('records many marks in a few statements', async () => {
    const store = makeStore(1024 * 1024);
    const marks = Array.from({ length: 400 }, (_, i) => `0:s${i}`);
    await store.registerSectionMarks(2, marks);
    for (let i = 0; i < 400; i++) await store.put(`k${i}`, entry(4));
    const execute = vi.spyOn(db, 'execute');
    await store.recordMarkKeys(
      2,
      marks.map((_, i) => ({ ordinal: i, key: `k${i}` })),
    );
    expect(execute.mock.calls.length).toBeLessThanOrEqual(3);
    expect((await store.getSectionStatuses()).get(2)).toMatchObject({ total: 400, recorded: 400 });
  });

  test('does not report an entry its deleted pack left without audio', async () => {
    const store = makeStore(1024 * 1024);
    await store.put('kept', entry(8));
    // What pack deletion leaves when no other pack holds the key.
    await db.execute(
      `INSERT INTO entries (key, audio, pack_id, boundaries, size, created_at, accessed_at)
       VALUES ('detached', NULL, NULL, '[]', 0, 1, 1)`,
    );
    expect(await store.get('detached')).toBeNull();
    expect(await store.cachedKeys(['kept', 'detached'])).toEqual(new Set(['kept']));
  });

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
