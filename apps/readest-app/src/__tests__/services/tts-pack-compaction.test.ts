import { beforeEach, describe, expect, test } from 'vitest';

import { md5 } from 'js-md5';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  SqliteTTSCacheStore,
  TTSPackFs,
  TTSPackSidecar,
  packSidecarName,
} from '@/services/tts/providers/sqliteCacheStore';

const BOUNDARIES = [{ offset: 0, duration: 1_000_000, text: 'w' }];

// In-memory pack filesystem: name -> bytes.
class FakePackFs implements TTSPackFs {
  files = new Map<string, Uint8Array>();
  async write(name: string, data: Uint8Array): Promise<void> {
    this.files.set(name, data);
  }
  async rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (!data) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, data);
    this.files.delete(from);
  }
  async readRange(name: string, offset: number, length: number): Promise<ArrayBuffer> {
    const data = this.files.get(name);
    if (!data) throw new Error(`ENOENT: ${name}`);
    return data.slice(offset, offset + length).buffer as ArrayBuffer;
  }
  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }
  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
}

const sentence = (byte: number, size = 40) => ({
  audio: new Uint8Array(size).fill(byte).buffer as ArrayBuffer,
  boundaries: BOUNDARIES,
});

describe('SqliteTTSCacheStore pack compaction', () => {
  let db: NodeDatabaseService;
  let packFs: FakePackFs;
  let store: SqliteTTSCacheStore;
  let clock: { t: number };

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    packFs = new FakePackFs();
    clock = { t: 1_000 };
    store = new SqliteTTSCacheStore(db, {
      budgetBytes: 1024 * 1024,
      now: () => clock.t++,
      packFs,
    });
  });

  const cacheSection = async (section: number, marks: string[], keys: string[]) => {
    await store.registerSectionMarks(section, marks);
    for (let i = 0; i < keys.length; i++) {
      await store.put(keys[i]!, sentence(i + 1));
      await store.recordMarkKey(section, i, keys[i]!);
    }
  };

  test('compacts a fully cached section into one pack file, in mark order', async () => {
    await cacheSection(3, ['m1', 'm2', 'm3'], ['k1', 'k2', 'k3']);
    const compacted = await store.compact();
    expect(compacted).toBe(1);

    // One pack file (plus its sidecar) holding the three sentences back to
    // back in reading order, named by the hash of its ordered keys.
    const packNames = (await packFs.list()).filter((n) => n.endsWith('.mp3'));
    expect(packNames).toHaveLength(1);
    expect(packNames[0]).toBe(`3-${md5(JSON.stringify(['k1', 'k2', 'k3'])).slice(0, 8)}.mp3`);
    const bytes = packFs.files.get(packNames[0]!)!;
    expect(bytes.length).toBe(120);
    expect(bytes[0]).toBe(1);
    expect(bytes[40]).toBe(2);
    expect(bytes[80]).toBe(3);
  });

  test('packed entries read back through range reads, byte for byte', async () => {
    await cacheSection(3, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    const got = await store.get('k2');
    expect(got).not.toBeNull();
    expect(got!.audio.byteLength).toBe(40);
    expect(new Uint8Array(got!.audio)[0]).toBe(2);
    expect(got!.boundaries).toEqual(BOUNDARIES);
  });

  test('concurrent identical registrations do not collide on (section, ordinal)', async () => {
    // Two callers registering the same section at once (live enumeration + a
    // download) previously raced their DELETE-then-INSERT and hit the primary
    // key. UPSERT makes it idempotent.
    await Promise.all([
      store.registerSectionMarks(9, ['m1', 'm2', 'm3']),
      store.registerSectionMarks(9, ['m1', 'm2', 'm3']),
    ]);
    const statuses = await store.getSectionStatuses();
    expect(statuses.get(9)).toEqual({ total: 3, recorded: 0, packed: false });
  });

  test('re-registering identical marks preserves an already recorded key', async () => {
    await store.registerSectionMarks(9, ['m1', 'm2']);
    await store.put('k1', sentence(1));
    await store.recordMarkKey(9, 0, 'k1');
    // A later identical registration (fingerprint unchanged) is a no-op, but
    // even a forced re-run must not wipe the recorded key.
    await store.registerSectionMarks(9, ['m1', 'm2']);
    const statuses = await store.getSectionStatuses();
    expect(statuses.get(9)).toEqual({ total: 2, recorded: 1, packed: false });
  });

  test('a shorter re-registration trims trailing ordinals', async () => {
    await store.registerSectionMarks(9, ['m1', 'm2', 'm3', 'm4']);
    await store.registerSectionMarks(9, ['a', 'b']);
    const statuses = await store.getSectionStatuses();
    expect(statuses.get(9)?.total).toBe(2);
  });

  test('an incomplete section never packs', async () => {
    await store.registerSectionMarks(5, ['m1', 'm2']);
    await store.put('k1', sentence(1));
    await store.recordMarkKey(5, 0, 'k1');
    // m2 never recorded.
    expect(await store.compact()).toBe(0);
    expect(await packFs.list()).toHaveLength(0);
  });

  test('an already compacted section does not pack twice', async () => {
    await cacheSection(3, ['m1'], ['k1']);
    expect(await store.compact()).toBe(1);
    expect(await store.compact()).toBe(0);
    expect((await packFs.list()).filter((n) => n.endsWith('.mp3'))).toHaveLength(1);
  });

  test('re-registering identical marks keeps recorded keys', async () => {
    await cacheSection(4, ['m1', 'm2'], ['k1', 'k2']);
    await store.registerSectionMarks(4, ['m1', 'm2']);
    expect(await store.compact()).toBe(1);
  });

  test('re-registering different marks resets the manifest', async () => {
    await cacheSection(4, ['m1', 'm2'], ['k1', 'k2']);
    await store.registerSectionMarks(4, ['m1', 'm2', 'm3']);
    expect(await store.compact()).toBe(0);
  });

  test('a lost pack file self-heals to a miss instead of failing', async () => {
    await cacheSection(3, ['m1'], ['k1']);
    await store.compact();
    packFs.files.clear();
    expect(await store.get('k1')).toBeNull();
    // The dead row is gone: a later put can re-cache the sentence.
    await store.put('k1', sentence(9));
    expect(await store.get('k1')).not.toBeNull();
  });

  test('evicting under pressure removes the oldest pack with its entries and file', async () => {
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 150,
      now: () => clock.t++,
      packFs,
    });
    await tight.registerSectionMarks(1, ['m1', 'm2']);
    await tight.put('k1', sentence(1));
    await tight.recordMarkKey(1, 0, 'k1');
    await tight.put('k2', sentence(2));
    await tight.recordMarkKey(1, 1, 'k2');
    await tight.compact();
    expect((await packFs.list()).filter((n) => n.endsWith('.mp3'))).toHaveLength(1);

    // 80 packed + 2*40 incoming loose > 150: the pack must be evicted.
    await tight.put('k3', sentence(3));
    await tight.put('k4', sentence(4));
    expect(await packFs.list()).toHaveLength(0);
    expect(await tight.get('k1')).toBeNull();
    expect(await tight.get('k3')).not.toBeNull();
    expect(await tight.get('k4')).not.toBeNull();
  });

  test('gc removes pack files unknown to the database', async () => {
    await cacheSection(3, ['m1'], ['k1']);
    await store.compact();
    packFs.files.set('tmp-crashed', new Uint8Array(10));
    packFs.files.set('stray.mp3', new Uint8Array(10));
    await store.gcPackFiles();
    // The known pack and its sidecar survive; the strays are gone.
    const names = (await packFs.list()).sort();
    expect(names).toHaveLength(2);
    expect(names.some((n) => n === 'tmp-crashed' || n === 'stray.mp3')).toBe(false);
    // The legitimate pack still reads.
    expect(await store.get('k1')).not.toBeNull();
  });

  test('without a pack filesystem, compaction is a no-op and loose reads keep working', async () => {
    const webStore = new SqliteTTSCacheStore(db, { budgetBytes: 1024, now: () => clock.t++ });
    await webStore.registerSectionMarks(1, ['m1']);
    await webStore.put('k1', sentence(1));
    await webStore.recordMarkKey(1, 0, 'k1');
    expect(await webStore.compact()).toBe(0);
    expect(await webStore.get('k1')).not.toBeNull();
  });
});

describe('SqliteTTSCacheStore pack portability', () => {
  let db: NodeDatabaseService;
  let packFs: FakePackFs;
  let store: SqliteTTSCacheStore;
  let clock: { t: number };

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    packFs = new FakePackFs();
    clock = { t: 1_000 };
    store = new SqliteTTSCacheStore(db, {
      budgetBytes: 1024 * 1024,
      now: () => clock.t++,
      packFs,
    });
    await store.registerSectionMarks(3, ['m1', 'm2']);
    await store.put('k1', sentence(1));
    await store.recordMarkKey(3, 0, 'k1');
    await store.put('k2', sentence(2));
    await store.recordMarkKey(3, 1, 'k2');
    await store.compact();
  });

  const packName = async () => (await packFs.list()).find((n) => n.endsWith('.mp3'))!;
  const readSidecar = async (): Promise<TTSPackSidecar> =>
    JSON.parse(new TextDecoder().decode(packFs.files.get(packSidecarName(await packName()))!));

  test('compaction writes a sidecar that fully describes the pack', async () => {
    const sidecar = await readSidecar();
    expect(sidecar.version).toBe(1);
    expect(sidecar.section).toBe(3);
    expect(sidecar.totalSize).toBe(80);
    expect(sidecar.entries.map((e) => [e.key, e.offset, e.length])).toEqual([
      ['k1', 0, 40],
      ['k2', 40, 40],
    ]);
    expect(sidecar.entries[0]!.boundaries).toEqual(BOUNDARIES);
  });

  test('importPack makes the section readable on a fresh device', async () => {
    const sidecar = await readSidecar();
    const bytes = packFs.files.get(await packName())!;

    const otherDb = await NodeDatabaseService.open(':memory:');
    const otherFs = new FakePackFs();
    const other = new SqliteTTSCacheStore(otherDb, {
      budgetBytes: 1024 * 1024,
      now: () => clock.t++,
      packFs: otherFs,
    });
    expect(await other.importPack(bytes.slice().buffer as ArrayBuffer, sidecar)).toBe(true);

    const got = await other.get('k2');
    expect(got).not.toBeNull();
    expect(new Uint8Array(got!.audio)[0]).toBe(2);
    expect(got!.boundaries).toEqual(BOUNDARIES);
    // Re-import is a no-op.
    expect(await other.importPack(bytes.slice().buffer as ArrayBuffer, sidecar)).toBe(false);
  });

  test('importPack rejects a sidecar that does not match the bytes', async () => {
    const sidecar = await readSidecar();
    const bytes = packFs.files.get(await packName())!;

    const otherDb = await NodeDatabaseService.open(':memory:');
    const otherFs = new FakePackFs();
    const other = new SqliteTTSCacheStore(otherDb, {
      budgetBytes: 1024 * 1024,
      now: () => clock.t++,
      packFs: otherFs,
    });
    const corrupt = { ...sidecar, totalSize: sidecar.totalSize + 1 };
    expect(await other.importPack(bytes.slice().buffer as ArrayBuffer, corrupt)).toBe(false);
    expect(await otherFs.list()).toHaveLength(0);
    expect(await other.get('k1')).toBeNull();
  });

  test('getSectionStatuses reports total, recorded, and packed', async () => {
    // Section 3 is fully packed (from beforeEach). Add section 5 partial.
    await store.registerSectionMarks(5, ['m1', 'm2', 'm3']);
    await store.put('p1', sentence(1));
    await store.recordMarkKey(5, 0, 'p1');

    const statuses = await store.getSectionStatuses();
    expect(statuses.get(3)).toEqual({ total: 2, recorded: 2, packed: true });
    expect(statuses.get(5)).toEqual({ total: 3, recorded: 1, packed: false });
    expect(await store.totalCacheBytes()).toBeGreaterThan(0);
  });

  test('the sync source surface reflects the database', async () => {
    const name = await packName();
    expect(await store.listPacks()).toEqual([{ name, size: 80 }]);
    expect(await store.hasPack(name)).toBe(true);
    expect(await store.hasPack('nope.mp3')).toBe(false);

    const bytes = await store.readPackBytes(name);
    expect(bytes?.byteLength).toBe(80);

    // The sidecar rebuilt from rows matches the one written at compaction.
    const rebuilt = await store.buildPackSidecar(name);
    expect(rebuilt).toEqual(await readSidecar());
    expect(await store.buildPackSidecar('nope.mp3')).toBeNull();
  });

  test('evicting a pack removes its sidecar too', async () => {
    // Shrink the budget with a new store over the same db and force eviction.
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 100,
      now: () => clock.t++,
      packFs,
    });
    await tight.put('k3', sentence(3, 60));
    expect(await packFs.list()).toHaveLength(0);
  });
});
