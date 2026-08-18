import { beforeEach, describe, expect, test, vi } from 'vitest';

import { md5 } from 'js-md5';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import type { DatabaseRow } from '@/types/database';
import { chapterDownloadStatus } from '@/services/tts/downloadChapters';
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
  async readSidecar(name: string): Promise<TTSPackSidecar | null> {
    const data = this.files.get(name);
    if (!data) return null;
    return JSON.parse(new TextDecoder().decode(data)) as TTSPackSidecar;
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

  test('a section sharing a sentence key with an already-packed section still packs (regression)', async () => {
    // Section A packs first, adopting the shared key k1 into its pack. From
    // then on k1's entry is pack-backed (audio NULL pointing at pack A).
    await cacheSection(4, ['mA1', 'mA2'], ['k1', 'k2']);
    expect(await store.compact()).toBe(1);
    expect((await store.getSectionStatuses()).get(4)?.packed).toBe(true);

    // Section B repeats k1 (a cache hit during a download, so no loose row is
    // written) plus a fresh k3. The old completable check rejected B because
    // k1's entry has audio NULL, so B could never pack and its chapter failed
    // forever, even though every sentence was cached.
    await store.registerSectionMarks(5, ['mB1', 'mB2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(5, 0, 'k1');
    await store.recordMarkKey(5, 1, 'k3');
    expect(await store.compact()).toBe(1);
    expect((await store.getSectionStatuses()).get(5)?.packed).toBe(true);

    const packNames = (await packFs.list()).filter((n) => n.endsWith('.mp3'));
    expect(packNames).toHaveLength(2);
    // The shared sentence is still readable after B's pack adopted the key.
    expect(await store.get('k1')).not.toBeNull();
    expect(await store.get('k3')).not.toBeNull();
  });

  test('an empty-manifest section that packed is reported as packed (regression)', async () => {
    // Cover / blank / symbol-only sections have zero recordable sentences, but
    // still pack an (empty) pack and must be reported as packed — otherwise a
    // "Download all" for a book with such a chapter fails forever.
    await store.registerSectionMarks(6, []);
    expect(await store.compact()).toBe(1);
    expect(await store.getSectionStatuses()).toEqual(
      new Map([[6, { total: 0, recorded: 0, packed: true, pinned: false, active: false }]]),
    );
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
    expect(statuses.get(9)).toEqual({
      total: 3,
      recorded: 0,
      packed: false,
      pinned: false,
      active: false,
    });
  });

  test('re-registering identical marks preserves an already recorded key', async () => {
    await store.registerSectionMarks(9, ['m1', 'm2']);
    await store.put('k1', sentence(1));
    await store.recordMarkKey(9, 0, 'k1');
    // A later identical registration (fingerprint unchanged) is a no-op, but
    // even a forced re-run must not wipe the recorded key.
    await store.registerSectionMarks(9, ['m1', 'm2']);
    const statuses = await store.getSectionStatuses();
    expect(statuses.get(9)).toEqual({
      total: 2,
      recorded: 1,
      packed: false,
      pinned: false,
      active: false,
    });
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

  test('a lost pinned pack becomes repairable instead of staying downloaded', async () => {
    await store.beginDownloadSections([3]);
    await cacheSection(3, ['m1'], ['k1']);
    await store.compact();
    await store.completeDownloadSections([3]);
    packFs.files.clear();

    expect(await store.get('k1')).toBeNull();
    expect((await store.getSectionStatuses()).get(3)).toMatchObject({
      packed: false,
      pinned: true,
    });
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

  test('a shared key survives a later non-owning pack being evicted', async () => {
    // Section A pinned: packs k1 + k2 into packA, completed to durable.
    await store.beginDownloadSections([1]);
    await cacheSection(1, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    await store.completeDownloadSections([1]);

    // Section B unpinned: packs k1 (cache hit, shared) + k3 into packB. The
    // shared k1 row is repointed to packB by #adoptPack.
    await store.registerSectionMarks(2, ['mB1', 'mB2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(2, 0, 'k1');
    await store.recordMarkKey(2, 1, 'k3');
    await store.compact();
    expect((await packFs.list()).filter((n) => n.endsWith('.mp3'))).toHaveLength(2);

    // Force eviction of the unpinned packB.
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 100,
      now: () => clock.t++,
      packFs,
    });
    await tight.put('oversize', sentence(9, 80));

    // k1 was transferred to packA, so its audio is still readable offline.
    expect(await store.get('k1')).not.toBeNull();
    // k3 had no surviving pack -> NULL/NULL fallback (bounded recovery).
    expect(await store.get('k3')).toBeNull();
    // The pinned section is still packed and pinned.
    expect((await store.getSectionStatuses()).get(1)).toMatchObject({
      packed: true,
      pinned: true,
    });
  });

  test('a stale pack of a pinned section is evictable after a manifest rebuild', async () => {
    // v1 manifest + pack for section 1.
    await store.registerSectionMarks(1, ['m1', 'm2']);
    await store.put('k1', sentence(1));
    await store.recordMarkKey(1, 0, 'k1');
    await store.put('k2', sentence(2));
    await store.recordMarkKey(1, 1, 'k2');
    await store.compact();
    expect((await packFs.list()).filter((n) => n.endsWith('.mp3'))).toHaveLength(1);

    // Rebuild the manifest to v2, pack v2 (v1 pack is now stale).
    await store.registerSectionMarks(1, ['m1', 'm2', 'm3']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(1, 2, 'k3');
    await store.compact();
    expect((await packFs.list()).filter((n) => n.endsWith('.mp3'))).toHaveLength(2);

    // Pin section 1 and mark it complete.
    await store.beginDownloadSections([1]);
    await store.completeDownloadSections([1]);

    // Force eviction: the stale v1 pack must be evictable despite the pin.
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 100,
      now: () => clock.t++,
      packFs,
    });
    await tight.put('oversize', sentence(9, 80));

    const surviving = (await packFs.list()).filter((n) => n.endsWith('.mp3'));
    expect(surviving).toHaveLength(1);
    expect((await store.getSectionStatuses()).get(1)).toMatchObject({
      packed: true,
      pinned: true,
    });
  });

  test('a corrupted pack file self-heals by transferring shared keys, not destroying them', async () => {
    // Same shared-key fixture as the transfer test.
    await store.beginDownloadSections([1]);
    await cacheSection(1, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    await store.completeDownloadSections([1]);
    await store.registerSectionMarks(2, ['mB1', 'mB2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(2, 0, 'k1');
    await store.recordMarkKey(2, 1, 'k3');
    await store.compact();

    // Corrupt packB's MP3 (keep its sidecar so offsets stay readable).
    const pack2Name = (await packFs.list()).find((n) => n.includes('2-') && n.endsWith('.mp3'))!;
    packFs.files.delete(pack2Name);

    // Self-heal transfers k1 to packA, NULL-falls-back k3.
    expect(await store.get('k1')).not.toBeNull();
    expect(await store.get('k3')).toBeNull();
    expect((await store.getSectionStatuses()).get(1)).toMatchObject({
      packed: true,
      pinned: true,
    });
  });

  test('detached entries do not keep a section eternally completable after a heal', async () => {
    // Pinned section 1 packs, then its pack file is lost with no surviving
    // candidate: self-heal detaches k1/k2 to loose misses. compact() must not
    // re-attempt the section until the sentences re-synthesize — a predicate
    // that sees detached rows as packable churns a full-section audio load
    // plus a "pack audio missing" warning every debounce cycle, forever.
    await store.beginDownloadSections([1]);
    await cacheSection(1, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    await store.completeDownloadSections([1]);
    const packName = (await packFs.list()).find((n) => n.endsWith('.mp3'))!;
    packFs.files.delete(packName);
    expect(await store.get('k1')).toBeNull();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await store.compact()).toBe(0);
      const missing = warn.mock.calls.filter((call) =>
        String(call[0]).includes('pack audio missing'),
      );
      expect(missing).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  test('an entry pointing at a vanished pack row detaches to a loose miss', async () => {
    // A crash between a transfer commit and file cleanup (or an interleaved
    // eviction) can leave an entry whose pack_id references no pack row. The
    // read must detach it so the next synthesis repopulates the row, instead
    // of leaving a permanent silent miss that neither eviction branch counts.
    await cacheSection(3, ['m1'], ['k1']);
    await store.compact();
    await db.execute('DELETE FROM packs', []);
    expect(await store.get('k1')).toBeNull();
    const rows = await db.select<DatabaseRow & { pack_id: number | null }>(
      "SELECT pack_id FROM entries WHERE key = 'k1'",
    );
    expect(rows[0]!.pack_id).toBeNull();
  });

  test('a transfer candidate with malformed sidecar offsets is skipped, not committed as NULL', async () => {
    // Pinned section 1 owns k1+k2 in packA; section 2 packs k1 (shared) + k3,
    // adopting k1's row into packB. packA's sidecar is corrupted so k1's entry
    // lacks a numeric offset: evicting packB must not repoint k1 at packA with
    // NULL offsets (JSON.stringify drops undefined, so json_extract yields
    // NULL — a permanent silent miss). With no valid candidate it detaches.
    await store.beginDownloadSections([1]);
    await cacheSection(1, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    await store.completeDownloadSections([1]);
    await store.registerSectionMarks(2, ['mB1', 'mB2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(2, 0, 'k1');
    await store.recordMarkKey(2, 1, 'k3');
    await store.compact();

    const packAName = (await packFs.list()).find((n) => n.startsWith('1-') && n.endsWith('.mp3'))!;
    const sidecarName = packSidecarName(packAName);
    const sidecar = JSON.parse(
      new TextDecoder().decode(packFs.files.get(sidecarName)!),
    ) as TTSPackSidecar;
    delete (sidecar.entries[0] as { offset?: number }).offset;
    packFs.files.set(sidecarName, new TextEncoder().encode(JSON.stringify(sidecar)));

    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 100,
      now: () => clock.t++,
      packFs,
    });
    await tight.put('oversize', sentence(9, 80));

    const rows = await db.select<DatabaseRow & { pack_id: number | null }>(
      "SELECT pack_id FROM entries WHERE key = 'k1'",
    );
    expect(rows[0]!.pack_id).toBeNull();
  });

  test('an imported pack for a pinned section survives eviction (imported-% special-case)', async () => {
    // Build a pack on another store and import it here under an 'imported-...'
    // fingerprint that never matches the local manifest's.
    const otherDb = await NodeDatabaseService.open(':memory:');
    const otherFs = new FakePackFs();
    const other = new SqliteTTSCacheStore(otherDb, {
      budgetBytes: 1024 * 1024,
      now: () => clock.t++,
      packFs: otherFs,
    });
    await other.registerSectionMarks(1, ['m1', 'm2']);
    await other.put('k1', sentence(1));
    await other.recordMarkKey(1, 0, 'k1');
    await other.put('k2', sentence(2));
    await other.recordMarkKey(1, 1, 'k2');
    await other.compact();
    const otherName = (await otherFs.list()).find((n) => n.endsWith('.mp3'))!;
    const otherSidecar = JSON.parse(
      new TextDecoder().decode(otherFs.files.get(packSidecarName(otherName))!),
    ) as TTSPackSidecar;
    const otherBytes = otherFs.files.get(otherName)!.slice().buffer as ArrayBuffer;
    await otherDb.close();

    // Import into the pinned section's store.
    await store.registerSectionMarks(1, ['m1', 'm2']);
    expect(await store.importPack(otherBytes, otherSidecar)).toBe(true);
    await store.beginDownloadSections([1]);
    await store.completeDownloadSections([1]);

    // Force eviction: the imported pack must survive despite fingerprint mismatch.
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 100,
      now: () => clock.t++,
      packFs,
    });
    await tight.put('oversize', sentence(9, 80));

    const surviving = (await packFs.list()).filter((n) => n.endsWith('.mp3'));
    expect(surviving).toContain(otherName);
    expect((await store.getSectionStatuses()).get(1)).toMatchObject({
      packed: true,
      pinned: true,
    });
  });

  test('an explicit download can exceed the cache budget and its pack is never evicted', async () => {
    const tight = new SqliteTTSCacheStore(db, {
      budgetBytes: 50,
      now: () => clock.t++,
      packFs,
    });
    await tight.beginDownloadSections([1]);
    await tight.registerSectionMarks(1, ['m1', 'm2']);
    expect((await tight.getSectionStatuses()).get(1)).toMatchObject({
      pinned: false,
      active: true,
    });
    await tight.put('k1', sentence(1));
    await tight.recordMarkKey(1, 0, 'k1');
    await tight.put('k2', sentence(2));
    await tight.recordMarkKey(1, 1, 'k2');
    expect(await tight.compact()).toBe(1);
    await tight.completeDownloadSections([1]);

    expect((await tight.getSectionStatuses()).get(1)).toMatchObject({
      pinned: true,
      active: false,
    });
    expect(await tight.get('k1')).not.toBeNull();
    expect(await tight.get('k2')).not.toBeNull();
    expect((await packFs.list()).filter((name) => name.endsWith('.mp3'))).toHaveLength(1);

    // Ordinary warm-cache audio still obeys the 50-byte budget; it must not
    // evict or expand storage beyond the explicitly downloaded 80-byte pack.
    await tight.put('warm', sentence(9, 40));
    expect(await tight.get('warm')).toBeNull();
    expect(await tight.get('k1')).not.toBeNull();
  });

  test('one window cancelling cannot remove another window completed pin', async () => {
    await store.beginDownloadSections([8]);
    await store.beginDownloadSections([8]);
    await cacheSection(8, ['m1'], ['shared']);
    await store.compact();

    await store.completeDownloadSections([8]);
    expect((await store.getSectionStatuses()).get(8)).toMatchObject({
      pinned: true,
      active: true,
    });

    await store.cancelDownloadSections([8]);
    expect((await store.getSectionStatuses()).get(8)).toMatchObject({
      pinned: true,
      active: false,
    });
    expect(await store.get('shared')).not.toBeNull();
  });

  test('beginning a multi-section download is atomic', async () => {
    const execute = db.execute.bind(db);
    let inserts = 0;
    const executeSpy = vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO pinned_sections') && ++inserts === 2) {
        throw new Error('pin failed');
      }
      return execute(sql, params);
    });

    await expect(store.beginDownloadSections([1, 2])).rejects.toThrow('pin failed');
    executeSpy.mockRestore();

    const statuses = await store.getSectionStatuses();
    expect(statuses.get(1)?.active).not.toBe(true);
    expect(statuses.get(2)?.active).not.toBe(true);
  });

  test('completing a multi-section download is atomic', async () => {
    await store.beginDownloadSections([1, 2]);
    await cacheSection(1, ['m1'], ['k1']);
    await cacheSection(2, ['m1'], ['k2']);
    await store.compact();
    const execute = db.execute.bind(db);
    let updates = 0;
    const executeSpy = vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql.includes('UPDATE pinned_sections') && ++updates === 2) {
        throw new Error('completion failed');
      }
      return execute(sql, params);
    });

    await expect(store.completeDownloadSections([1, 2])).rejects.toThrow('completion failed');
    executeSpy.mockRestore();

    const statuses = await store.getSectionStatuses();
    expect(statuses.get(1)).toMatchObject({ pinned: false, active: true });
    expect(statuses.get(2)).toMatchObject({ pinned: false, active: true });
  });

  test('clearDownloads removes pinned audio while preserving ordinary warm cache entries', async () => {
    await store.beginDownloadSections([3]);
    await cacheSection(3, ['m1', 'm2'], ['k1', 'k2']);
    await store.compact();
    await store.completeDownloadSections([3]);
    await store.put('warm', sentence(9));

    await store.clearDownloads();

    expect(await store.hasDownloads()).toBe(false);
    expect(await store.get('k1')).toBeNull();
    expect(await store.get('k2')).toBeNull();
    expect(await store.get('warm')).not.toBeNull();
    expect((await packFs.list()).filter((name) => name.endsWith('.mp3'))).toHaveLength(0);
  });

  test('clearDownloads fully removes downloaded chapters sharing sentences with a warm section (regression)', async () => {
    // Two downloaded chapters share k1. A third, warm-cache section also
    // repeats k1 and packs last, so k1's single entry row ends up owned by
    // the warm section's pack. Clear downloads must still remove the
    // downloaded chapters entirely — their marks, statuses, and pack files —
    // while the warm section keeps its own cache.
    await store.beginDownloadSections([4, 5]);
    await cacheSection(4, ['mA1', 'mA2'], ['k1', 'k2']);
    expect(await store.compact()).toBe(1);
    await store.registerSectionMarks(5, ['mB1', 'mB2']);
    await store.put('k4', sentence(4));
    await store.recordMarkKey(5, 0, 'k1');
    await store.recordMarkKey(5, 1, 'k4');
    expect(await store.compact()).toBe(1);
    await store.completeDownloadSections([4, 5]);

    await store.registerSectionMarks(6, ['mC1', 'mC2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(6, 0, 'k1');
    await store.recordMarkKey(6, 1, 'k3');
    expect(await store.compact()).toBe(1);
    expect((await store.getSectionStatuses()).get(6)).toMatchObject({
      packed: true,
      pinned: false,
    });

    await store.clearDownloads();

    expect(await store.hasDownloads()).toBe(false);
    expect(await store.get('k2')).toBeNull();
    expect(await store.get('k4')).toBeNull();
    // The warm section still owns the shared sentence.
    expect(await store.get('k1')).not.toBeNull();
    const statuses = await store.getSectionStatuses();
    // Cleared chapters leave no marks behind, so the podcast sheet must not
    // label them partially downloaded.
    expect(statuses.get(4)).toBeUndefined();
    expect(statuses.get(5)).toBeUndefined();
    expect(statuses.get(6)).toMatchObject({ packed: true, pinned: false });
    expect(
      chapterDownloadStatus(
        { key: 'ch4', label: 'Chapter 4', depth: 0, startSection: 4, endSection: 5 },
        statuses,
      ),
    ).toBe('none');
    // Only the warm section's pack remains on disk.
    expect((await packFs.list()).filter((name) => name.endsWith('.mp3'))).toHaveLength(1);
  });

  test('clearDownloads drops a shared entry a warm pack adopted when no section marks it anymore (regression)', async () => {
    // Section 4 downloads k1; warm section 6 also marks k1 and packs last,
    // adopting k1's entry row into its pack. Section 6's manifest then
    // changes (a re-enumeration, e.g. a voice change) so nothing marks k1
    // anymore. Clear downloads must garbage-collect the row instead of
    // leaking it inside the surviving warm pack.
    await store.beginDownloadSections([4]);
    await cacheSection(4, ['mA1'], ['k1']);
    expect(await store.compact()).toBe(1);
    await store.completeDownloadSections([4]);

    await store.registerSectionMarks(6, ['mC1', 'mC2']);
    await store.put('k3', sentence(3));
    await store.recordMarkKey(6, 0, 'k1');
    await store.recordMarkKey(6, 1, 'k3');
    expect(await store.compact()).toBe(1);
    expect(await store.get('k1')).not.toBeNull();

    await store.registerSectionMarks(6, ['mC2']);
    await store.recordMarkKey(6, 0, 'k3');

    await store.clearDownloads();

    expect(await store.get('k1')).toBeNull();
    expect(await store.get('k3')).not.toBeNull();
    expect((await store.getSectionStatuses()).get(4)).toBeUndefined();
    expect((await packFs.list()).filter((name) => name.endsWith('.mp3'))).toHaveLength(1);
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
    expect(statuses.get(3)).toEqual({
      total: 2,
      recorded: 2,
      packed: true,
      pinned: false,
      active: false,
    });
    expect(statuses.get(5)).toEqual({
      total: 3,
      recorded: 1,
      packed: false,
      pinned: false,
      active: false,
    });
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
