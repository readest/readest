// SQLite-backed TTSCacheStore: the per-book audio cache of the design in
// .agents/plans/2026-07-13-tts-cache-sqlite-packs.md. One database per book
// (Cache/tts-cache/<book_hash>/cache.db) so deleting a book's audio cache is
// a directory delete and cache traffic never contends with another database
// behind the turso per-db mutex.
//
// Two tiers:
// - loose rows: one BLOB per sentence, content-addressed, written by
//   CachingProvider as sentences are synthesized;
// - section packs: once a section's manifest is fully cached, its sentence
//   MP3s are concatenated into one pack file in reading order. Each Edge
//   sentence is a self-contained MP3 stream, so bytes[offset..offset+length]
//   of a pack is exactly the original sentence (range reads decode
//   independently) while the pack as a whole stays a playable MP3.
//
// Manifests carry ordered MARK NAMES from the section timeline enumeration;
// the client records the ACTUAL synthesis key per mark as it speaks. That
// keeps the cache purely content-addressed with zero text/lang re-derivation:
// if enumeration and synthesis ever disagree, the section simply never packs
// (a missed optimization, never wrong audio).
//
// The store does not own the DatabaseService lifecycle: the caller opens the
// per-book database and closes it when the TTS session shuts down.

import { md5 } from 'js-md5';
import type { DatabaseService, DatabaseRow } from '@/types/database';
import type { TTSWordBoundary } from '@/libs/edgeTTS';
import type { TTSCacheEntry, TTSCacheStore } from './cache';

// Pack file IO, rooted at the book's packs directory. Injected because the
// backends differ (tauri plugin-fs natively, OPFS on the web later) and so
// tests can run against an in-memory map. When absent (web today),
// compaction is disabled and packed rows read as misses.
export interface TTSPackFs {
  write(name: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readRange(name: string, offset: number, length: number): Promise<ArrayBuffer>;
  // Read and parse a pack's sidecar JSON, or null when the file is missing.
  // Used by the transfer-on-removal path to repoint shared entries at a
  // surviving pack with the correct (offset, length).
  readSidecar(name: string): Promise<TTSPackSidecar | null>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

// Portable description of a pack file: everything a fresh device needs to
// adopt the pack into its own database (sync) or to label an export. Written
// beside the pack as <name>.json AFTER the mp3 exists, so a sidecar's
// presence always implies a complete pack.
export interface TTSPackSidecarEntry {
  key: string;
  offset: number;
  length: number;
  boundaries: TTSWordBoundary[];
  durationMs?: number;
}

export interface TTSPackSidecar {
  version: 1;
  section: number;
  keysFingerprint: string;
  totalSize: number;
  entries: TTSPackSidecarEntry[];
}

export const packSidecarName = (packName: string): string => packName.replace(/\.mp3$/, '.json');

export interface SqliteTTSCacheStoreOptions {
  // Intra-book budget for loose rows + packs; the cross-book budget is
  // enforced by the global sweep at book granularity.
  budgetBytes: number;
  // Injectable clock for deterministic eviction tests; values must be
  // monotonic per store instance.
  now?: () => number;
  packFs?: TTSPackFs;
}

interface EntryRow extends DatabaseRow {
  audio: unknown;
  boundaries: string;
  duration_ms: number | null;
  pack_id: number | null;
  pack_offset: number | null;
  pack_length: number | null;
}

// Blob round-trip shapes differ per backend (node Buffer, wasm Uint8Array,
// tauri IPC number[]); normalize to a fresh ArrayBuffer the caller owns.
// instanceof is useless here — node Buffers fail cross-realm Uint8Array
// checks under vitest — so use realm-safe ArrayBuffer.isView plus a
// duck-type fallback. Slice by byteOffset/byteLength: Buffers share pooled
// ArrayBuffers, so copying the whole .buffer would leak neighbors.
const toArrayBuffer = (value: unknown): ArrayBuffer | null => {
  if (!value) return null;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value).buffer as ArrayBuffer;
  }
  const duck = value as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
  if (duck.buffer && typeof duck.byteOffset === 'number' && typeof duck.byteLength === 'number') {
    return new Uint8Array(duck.buffer, duck.byteOffset, duck.byteLength).slice()
      .buffer as ArrayBuffer;
  }
  return null;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS entries (
    key         TEXT PRIMARY KEY,
    provider    TEXT NOT NULL DEFAULT '',
    voice       TEXT NOT NULL DEFAULT '',
    audio       BLOB,
    pack_id     INTEGER,
    pack_offset INTEGER,
    pack_length INTEGER,
    boundaries  TEXT NOT NULL,
    duration_ms INTEGER,
    size        INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_accessed ON entries(accessed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_pack ON entries(pack_id)`,
  `CREATE TABLE IF NOT EXISTS manifests (
    section     INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS manifest_marks (
    section INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    mark    TEXT NOT NULL,
    key     TEXT,
    PRIMARY KEY (section, ordinal)
  )`,
  `CREATE TABLE IF NOT EXISTS packs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    section          INTEGER NOT NULL,
    fingerprint      TEXT NOT NULL,
    keys_fingerprint TEXT,
    path             TEXT NOT NULL,
    size             INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    accessed_at      INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pinned_sections (
    section INTEGER PRIMARY KEY,
    active  INTEGER NOT NULL DEFAULT 0,
    pinned  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manifest_marks_key ON manifest_marks(key)`,
  `CREATE INDEX IF NOT EXISTS idx_packs_section ON packs(section)`,
];

// Batch accessed_at updates: reads must not each cost a synchronous write.
const TOUCH_FLUSH_LIMIT = 64;

// importPack stores synced packs under a fingerprint prefixed with this, so a
// pack adopted from another device never equals the local manifest
// fingerprint yet still counts as "current" for its section.
const IMPORTED_FINGERPRINT_PREFIX = 'imported-';

// A pack is current for its section when its fingerprint matches the
// section's current manifest or was imported. Shared by status reporting and
// eviction protection so the convention cannot drift between queries.
const CURRENT_PACK_PREDICATE = `(p.fingerprint = m.fingerprint OR p.fingerprint LIKE '${IMPORTED_FINGERPRINT_PREFIX}%')`;

export class SqliteTTSCacheStore implements TTSCacheStore {
  #db: DatabaseService;
  #budgetBytes: number;
  #now: () => number;
  #packFs: TTSPackFs | null;
  #ready: Promise<void> | null = null;
  #pendingTouches = new Map<string, number>();
  #pendingPackTouches = new Map<number, number>();

  constructor(db: DatabaseService, options: SqliteTTSCacheStoreOptions) {
    this.#db = db;
    this.#budgetBytes = options.budgetBytes;
    this.#now = options.now ?? Date.now;
    this.#packFs = options.packFs ?? null;
  }

  #ensureSchema(): Promise<void> {
    if (!this.#ready) {
      this.#ready = (async () => {
        for (const statement of SCHEMA) {
          await this.#db.execute(statement);
        }
        // Additive migration for databases created before pack portability.
        await this.#db
          .execute('ALTER TABLE packs ADD COLUMN keys_fingerprint TEXT')
          .catch(() => {});
        // PR-build compatibility: the first queue draft represented completed
        // pins as active=0 and had no independent completed flag.
        let migratedLegacyPins = false;
        try {
          await this.#db.execute(
            'ALTER TABLE pinned_sections ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
          );
          migratedLegacyPins = true;
        } catch {
          // Fresh/current schema already has the column.
        }
        if (migratedLegacyPins) {
          await this.#db.execute('UPDATE pinned_sections SET pinned = 1 WHERE active = 0');
        }
      })();
    }
    return this.#ready;
  }

  async get(key: string): Promise<TTSCacheEntry | null> {
    await this.#ensureSchema();
    const rows = await this.#db.select<EntryRow>(
      `SELECT audio, boundaries, duration_ms, pack_id, pack_offset, pack_length
         FROM entries WHERE key = ?`,
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    const audio = toArrayBuffer(row.audio) ?? (await this.#readPackedAudio(key, row));
    if (!audio) return null;
    this.#pendingTouches.set(key, this.#now());
    if (row.pack_id != null) this.#pendingPackTouches.set(row.pack_id, this.#now());
    if (this.#pendingTouches.size + this.#pendingPackTouches.size >= TOUCH_FLUSH_LIMIT) {
      await this.#flushTouches();
    }
    return {
      audio,
      boundaries: JSON.parse(row.boundaries) as TTSWordBoundary[],
      durationMs: row.duration_ms ?? undefined,
    };
  }

  async #readPackedAudio(key: string, row: EntryRow): Promise<ArrayBuffer | null> {
    if (
      !this.#packFs ||
      row.pack_id == null ||
      row.pack_offset == null ||
      row.pack_length == null
    ) {
      return null;
    }
    const packs = await this.#db.select<DatabaseRow & { path: string }>(
      'SELECT path FROM packs WHERE id = ?',
      [row.pack_id],
    );
    const path = packs[0]?.path;
    if (!path) {
      // Dangling pack reference (crash artifact or interleaved eviction):
      // detach to a loose miss so the next synthesis repopulates the row
      // instead of leaving a permanent miss no eviction branch can reclaim.
      await this.#db.execute(
        `UPDATE entries
            SET pack_id = NULL, audio = NULL, size = 0,
                pack_offset = NULL, pack_length = NULL
          WHERE key = ?`,
        [key],
      );
      return null;
    }
    try {
      return await this.#packFs.readRange(path, row.pack_offset, row.pack_length);
    } catch (err) {
      // Self-heal: the pack file is gone or truncated. Transfer any shared
      // keys to a surviving pack (or detach them to NULL/NULL when no
      // candidate exists), then drop the pack so a pinned section becomes
      // visibly incomplete and can be downloaded again.
      console.warn(
        `[TTS] pack range read failed (key=${key} pack=${row.pack_id}); healing entry to a miss`,
        err,
      );
      await this.#transferSharedEntriesOnPackDeletion([row.pack_id]);
      // The heal may have repointed this entry to a surviving pack: retry so
      // the reader gets the audio instead of a false miss. Each retry removes
      // a pack row, so this terminates.
      const healed = await this.#db.select<EntryRow>(
        `SELECT audio, boundaries, duration_ms, pack_id, pack_offset, pack_length
           FROM entries WHERE key = ?`,
        [key],
      );
      const healedRow = healed[0];
      if (!healedRow) return null;
      const healedAudio = toArrayBuffer(healedRow.audio);
      if (healedAudio) return healedAudio;
      if (healedRow.pack_id == null || healedRow.pack_id === row.pack_id) return null;
      return this.#readPackedAudio(key, healedRow);
    }
  }

  async put(
    key: string,
    entry: TTSCacheEntry,
    meta?: { provider?: string; voice?: string },
  ): Promise<void> {
    await this.#ensureSchema();
    const size = entry.audio.byteLength;
    const activeDownload = await this.#hasActiveDownload();
    if (size > this.#budgetBytes && !activeDownload) return;
    const fits = await this.#evictUntilFits(size, key);
    if (!fits && !activeDownload) return;
    const timestamp = this.#now();
    await this.#db.execute(
      `INSERT OR REPLACE INTO entries
         (key, provider, voice, audio, boundaries, duration_ms, size, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        meta?.provider ?? '',
        meta?.voice ?? '',
        new Uint8Array(entry.audio),
        JSON.stringify(entry.boundaries),
        entry.durationMs ?? null,
        size,
        timestamp,
        timestamp,
      ],
    );
  }

  // Ordered mark names for a section, from the timeline enumeration. An
  // identical re-registration keeps the recorded keys; a changed list (voice
  // or text changes reshape marks rarely; section edits do) resets them.
  async registerSectionMarks(section: number, marks: string[]): Promise<void> {
    await this.#ensureSchema();
    const fingerprint = md5(JSON.stringify(marks));
    const existing = await this.#db.select<DatabaseRow & { fingerprint: string }>(
      'SELECT fingerprint FROM manifests WHERE section = ?',
      [section],
    );
    if (existing[0]?.fingerprint === fingerprint) return;
    await this.#db.execute('INSERT OR REPLACE INTO manifests VALUES (?, ?, ?)', [
      section,
      fingerprint,
      this.#now(),
    ]);
    // Idempotent per row instead of DELETE-then-INSERT: two concurrent
    // registrations of the same section (live enumeration + a download, or a
    // re-run) would otherwise both delete and then collide on the
    // (section, ordinal) primary key. UPSERT keeps each ordinal unique and
    // preserves a key already recorded for an unchanged mark; a trailing
    // DELETE trims ordinals left over from a shorter new manifest.
    for (let i = 0; i < marks.length; i++) {
      await this.#db.execute(
        `INSERT INTO manifest_marks (section, ordinal, mark, key) VALUES (?, ?, ?, NULL)
         ON CONFLICT(section, ordinal) DO UPDATE SET mark = excluded.mark`,
        [section, i, marks[i]!],
      );
    }
    await this.#db.execute('DELETE FROM manifest_marks WHERE section = ? AND ordinal >= ?', [
      section,
      marks.length,
    ]);
  }

  // The client observed the sentence at this ordinal actually synthesizing
  // under this cache key. Ordinal-keyed: mark names restart per block, but
  // the timeline enumeration ordinal is unique within the section.
  async recordMarkKey(section: number, ordinal: number, key: string): Promise<void> {
    await this.#ensureSchema();
    await this.#db.execute('UPDATE manifest_marks SET key = ? WHERE section = ? AND ordinal = ?', [
      key,
      section,
      ordinal,
    ]);
  }

  // Explicit downloads are durable user data, not disposable warm-cache
  // entries. Mark the target sections before synthesis so their loose rows
  // are protected while the pack is still being assembled.
  async beginDownloadSections(sections: number[]): Promise<void> {
    await this.#ensureSchema();
    await this.#transaction(async () => {
      for (const section of new Set(sections)) {
        await this.#db.execute(
          `INSERT INTO pinned_sections (section, active, pinned) VALUES (?, 1, 0)
           ON CONFLICT(section) DO UPDATE SET active = pinned_sections.active + 1`,
          [section],
        );
      }
    });
  }

  // A completed explicit download remains pinned only when compaction
  // produced its durable section pack. Incomplete sections fall back to
  // ordinary warm-cache data and can be retried later.
  async completeDownloadSections(sections: number[]): Promise<void> {
    await this.#ensureSchema();
    await this.#transaction(async () => {
      for (const section of new Set(sections)) {
        const pack = await this.#db.select<DatabaseRow & { id: number }>(
          'SELECT id FROM packs WHERE section = ? LIMIT 1',
          [section],
        );
        if (pack.length) {
          await this.#db.execute(
            `UPDATE pinned_sections
                SET active = MAX(active - 1, 0), pinned = 1
              WHERE section = ?`,
            [section],
          );
        } else {
          await this.#releaseDownloadSection(section);
        }
      }
    });
  }

  async cancelDownloadSections(sections: number[]): Promise<void> {
    await this.#ensureSchema();
    await this.#transaction(async () => {
      for (const section of new Set(sections)) {
        await this.#releaseDownloadSection(section);
      }
    });
  }

  async #releaseDownloadSection(section: number): Promise<void> {
    await this.#db.execute(
      'UPDATE pinned_sections SET active = MAX(active - 1, 0) WHERE section = ?',
      [section],
    );
    await this.#db.execute(
      'DELETE FROM pinned_sections WHERE section = ? AND active = 0 AND pinned = 0',
      [section],
    );
  }

  async #transaction(action: () => Promise<void>): Promise<void> {
    await this.#db.execute('BEGIN');
    try {
      await action();
      await this.#db.execute('COMMIT');
    } catch (err) {
      try {
        await this.#db.execute('ROLLBACK');
      } catch {
        // No open transaction to roll back.
      }
      throw err;
    }
  }

  async hasDownloads(): Promise<boolean> {
    await this.#ensureSchema();
    const rows = await this.#db.select<DatabaseRow & { section: number }>(
      'SELECT section FROM pinned_sections WHERE active > 0 OR pinned = 1 LIMIT 1',
    );
    return rows.length > 0;
  }

  // Remove only explicitly downloaded sections. Unpinned loose entries are
  // the ordinary playback cache and deliberately survive Clear downloads.
  async clearDownloads(): Promise<void> {
    await this.#ensureSchema();
    await this.#flushTouches();
    const packs = await this.#db.select<DatabaseRow & { id: number; path: string }>(
      `SELECT p.id, p.path FROM packs p
        JOIN pinned_sections ps ON ps.section = p.section
       WHERE ps.active > 0 OR ps.pinned = 1`,
    );
    // Shared sentences have one entry row per key, adopted by whichever
    // section packed last, so the row may now live in an unpinned section's
    // pack. Capture the cleared sections and their keys before the
    // transaction so their marks can be dropped and entries that only the
    // cleared sections referenced can be garbage-collected.
    const clearedSections = (
      await this.#db.select<DatabaseRow & { section: number }>(
        'SELECT section FROM pinned_sections WHERE active > 0 OR pinned = 1',
      )
    ).map((row) => row.section);
    const clearedKeys = (
      await this.#db.select<DatabaseRow & { key: string }>(
        `SELECT DISTINCT mm.key FROM manifest_marks mm
           JOIN pinned_sections ps ON ps.section = mm.section
          WHERE mm.key IS NOT NULL AND (ps.active > 0 OR ps.pinned = 1)`,
      )
    ).map((row) => row.key);
    const sectionPlaceholders = clearedSections.map(() => '?').join(',');
    try {
      await this.#db.execute('BEGIN');
      await this.#db.execute(
        `DELETE FROM entries WHERE pack_id IN (
           SELECT p.id FROM packs p
             JOIN pinned_sections ps ON ps.section = p.section
            WHERE ps.active > 0 OR ps.pinned = 1
         )`,
      );
      await this.#db.execute(
        `DELETE FROM entries WHERE pack_id IS NULL AND key IN (
           SELECT mm.key FROM manifest_marks mm
             JOIN pinned_sections ps ON ps.section = mm.section
            WHERE mm.key IS NOT NULL AND (ps.active > 0 OR ps.pinned = 1)
         )`,
      );
      await this.#db.execute(
        `DELETE FROM packs WHERE section IN (
           SELECT section FROM pinned_sections WHERE active > 0 OR pinned = 1
         )`,
      );
      // Cleared sections stop claiming sentences: drop their marks and
      // manifest so the podcast sheet offers them as not downloaded even
      // when a shared entry row survives in a warm section's pack.
      if (clearedSections.length) {
        await this.#db.execute(
          `DELETE FROM manifest_marks WHERE section IN (${sectionPlaceholders})`,
          clearedSections,
        );
        await this.#db.execute(
          `DELETE FROM manifests WHERE section IN (${sectionPlaceholders})`,
          clearedSections,
        );
      }
      // Entries that only the cleared sections referenced are now
      // unreachable (owned by a surviving pack or detached): drop them
      // instead of leaking rows the warm cache will never read. The keys ride
      // in as one JSON array — a fully downloaded book has one key per
      // distinct sentence, easily past SQLite's host-parameter cap.
      if (clearedKeys.length) {
        await this.#db.execute(
          `DELETE FROM entries
            WHERE key IN (SELECT j.value FROM json_each(?) AS j)
              AND NOT EXISTS (
                SELECT 1 FROM manifest_marks mm WHERE mm.key = entries.key
              )`,
          [JSON.stringify(clearedKeys)],
        );
      }
      await this.#db.execute('DELETE FROM pinned_sections');
      await this.#db.execute('COMMIT');
    } catch (err) {
      try {
        await this.#db.execute('ROLLBACK');
      } catch {
        // No open transaction to roll back.
      }
      throw err;
    }
    for (const pack of packs) {
      await this.#packFs?.remove(pack.path).catch(() => {});
      await this.#packFs?.remove(packSidecarName(pack.path)).catch(() => {});
    }
  }

  // Merge every fully cached section into one pack file. Returns the number
  // of packs created. Idle-time work: callers debounce it.
  async compact(): Promise<number> {
    if (!this.#packFs) return 0;
    await this.#ensureSchema();
    const completable = await this.#db.select<
      DatabaseRow & { section: number; fingerprint: string }
    >(
      `SELECT m.section, m.fingerprint FROM manifests m
        WHERE NOT EXISTS (
          SELECT 1 FROM packs p
           WHERE p.section = m.section AND p.fingerprint = m.fingerprint)
          AND NOT EXISTS (
          SELECT 1 FROM manifest_marks mm WHERE mm.section = m.section AND mm.key IS NULL)
          AND NOT EXISTS (
          SELECT 1 FROM manifest_marks mm
            LEFT JOIN entries e ON e.key = mm.key
           WHERE mm.section = m.section
             AND (e.key IS NULL OR (e.audio IS NULL AND e.pack_id IS NULL)))`,
    );
    let created = 0;
    for (const manifest of completable) {
      if (await this.#packSection(manifest.section, manifest.fingerprint)) created++;
    }
    return created;
  }

  async #packSection(section: number, fingerprint: string): Promise<boolean> {
    const rows = await this.#db.select<
      DatabaseRow & {
        key: string;
        audio: unknown;
        boundaries: string;
        duration_ms: number | null;
        pack_id: number | null;
        pack_offset: number | null;
        pack_length: number | null;
      }
    >(
      `SELECT mm.key, e.audio, e.boundaries, e.duration_ms,
              e.pack_id, e.pack_offset, e.pack_length
         FROM manifest_marks mm
         JOIN entries e ON e.key = mm.key
        WHERE mm.section = ? ORDER BY mm.ordinal ASC`,
      [section],
    );
    // Concatenate in reading order; a repeated sentence appears at each of
    // its positions (the pack doubles as a playable section MP3), while the
    // entry row points at the first occurrence.
    const parts: {
      key: string;
      bytes: Uint8Array;
      boundaries: string;
      durationMs: number | null;
    }[] = [];
    for (const row of rows) {
      let audio = toArrayBuffer(row.audio);
      if (!audio) {
        // This sentence was packed into another section first (identical text
        // under the same voice), so its entry is pack-backed with audio NULL.
        // Resolve the bytes from that pack so THIS section can pack too; the
        // content is identical by key, so embedding a copy is safe.
        audio = await this.#readPackedAudio(row.key, row);
      }
      if (!audio) {
        console.warn(`[TTS] pack audio missing for key=${row.key} section=${section}`);
        return false;
      }
      parts.push({
        key: row.key,
        bytes: new Uint8Array(audio),
        boundaries: row.boundaries,
        durationMs: row.duration_ms,
      });
    }
    const totalSize = parts.reduce((sum, p) => sum + p.bytes.length, 0);
    const merged = new Uint8Array(totalSize);
    const sidecarEntries: TTSPackSidecarEntry[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (const part of parts) {
      merged.set(part.bytes, offset);
      if (!seen.has(part.key)) {
        seen.add(part.key);
        sidecarEntries.push({
          key: part.key,
          offset,
          length: part.bytes.length,
          boundaries: JSON.parse(part.boundaries) as TTSWordBoundary[],
          durationMs: part.durationMs ?? undefined,
        });
      }
      offset += part.bytes.length;
    }

    // Pack identity is the hash of the ordered KEYS, not the mark names:
    // keys encode provider/voice/pitch/text, so two devices reading the same
    // section with different voices produce different pack names. That is
    // what makes packs safe to sync: same name always means same bytes.
    const keysFingerprint = md5(JSON.stringify(parts.map((p) => p.key)));
    const sidecar: TTSPackSidecar = {
      version: 1,
      section,
      keysFingerprint,
      totalSize,
      entries: sidecarEntries,
    };
    return this.#adoptPack(merged, sidecar, fingerprint);
  }

  // Write the pack + sidecar files and flip/insert the entry rows in one
  // transaction. Shared by compaction (flips existing loose rows) and
  // importPack (inserts packed rows a fresh device never had).
  async #adoptPack(
    merged: Uint8Array,
    sidecar: TTSPackSidecar,
    manifestFingerprint: string,
  ): Promise<boolean> {
    const packFs = this.#packFs!;
    const finalName = `${sidecar.section}-${sidecar.keysFingerprint.slice(0, 8)}.mp3`;
    const existing = await this.#db.select<DatabaseRow & { id: number }>(
      'SELECT id FROM packs WHERE path = ?',
      [finalName],
    );
    if (existing.length) {
      return false;
    }

    const tmpName = `tmp-${finalName}`;
    try {
      await packFs.write(tmpName, merged);
      await packFs.rename(tmpName, finalName);
      await packFs.write(
        packSidecarName(finalName),
        new TextEncoder().encode(JSON.stringify(sidecar)),
      );
    } catch (err) {
      // A failed section must not reject the whole compact(): drop whatever
      // landed (the DB has not changed yet) and report the section unpacked
      // so a later run retries it.
      console.warn(`[TTS] pack write failed section=${sidecar.section}`, err);
      await packFs.remove(tmpName).catch(() => {});
      await packFs.remove(finalName).catch(() => {});
      await packFs.remove(packSidecarName(finalName)).catch(() => {});
      return false;
    }

    const timestamp = this.#now();
    try {
      await this.#db.execute('BEGIN');
      await this.#db.execute(
        `INSERT INTO packs
           (section, fingerprint, keys_fingerprint, path, size, created_at, accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          sidecar.section,
          manifestFingerprint,
          sidecar.keysFingerprint,
          finalName,
          sidecar.totalSize,
          timestamp,
          timestamp,
        ],
      );
      const packIds = await this.#db.select<DatabaseRow & { id: number }>(
        'SELECT id FROM packs WHERE path = ?',
        [finalName],
      );
      const packId = packIds[0]!.id;
      for (const entry of sidecar.entries) {
        await this.#db.execute(
          `INSERT INTO entries
             (key, provider, voice, audio, pack_id, pack_offset, pack_length,
              boundaries, duration_ms, size, created_at, accessed_at)
           VALUES (?, '', '', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             audio = NULL, pack_id = excluded.pack_id,
             pack_offset = excluded.pack_offset, pack_length = excluded.pack_length`,
          [
            entry.key,
            packId,
            entry.offset,
            entry.length,
            JSON.stringify(entry.boundaries),
            entry.durationMs ?? null,
            entry.length,
            timestamp,
            timestamp,
          ],
        );
      }
      await this.#db.execute('COMMIT');
      return true;
    } catch (err) {
      console.warn('TTS pack transaction failed; keeping loose rows', err);
      try {
        await this.#db.execute('ROLLBACK');
      } catch {
        // No open transaction to roll back.
      }
      await packFs.remove(finalName).catch(() => {});
      await packFs.remove(packSidecarName(finalName)).catch(() => {});
      return false;
    }
  }

  // Adopt a pack produced elsewhere (another device via sync). Validates the
  // sidecar against the bytes; rejects rather than trusts. Returns false on
  // any mismatch, unsupported version, or when the pack already exists.
  async importPack(data: ArrayBuffer, sidecar: TTSPackSidecar): Promise<boolean> {
    if (!this.#packFs) return false;
    await this.#ensureSchema();
    if (sidecar.version !== 1) return false;
    if (sidecar.totalSize !== data.byteLength || !sidecar.entries.length) return false;
    const keys = new Set<string>();
    for (const entry of sidecar.entries) {
      if (keys.has(entry.key)) return false;
      keys.add(entry.key);
      if (
        entry.offset < 0 ||
        entry.length <= 0 ||
        entry.offset + entry.length > sidecar.totalSize
      ) {
        return false;
      }
    }
    const existing = await this.#db.select<DatabaseRow & { id: number }>(
      'SELECT id FROM packs WHERE keys_fingerprint = ?',
      [sidecar.keysFingerprint],
    );
    if (existing.length) return false;
    if (sidecar.totalSize > this.#budgetBytes) return false;
    if (!(await this.#evictUntilFits(sidecar.totalSize, ''))) return false;
    return this.#adoptPack(
      new Uint8Array(data),
      sidecar,
      `${IMPORTED_FINGERPRINT_PREFIX}${sidecar.keysFingerprint}`,
    );
  }

  // Per-section download status for the podcast UI. `recorded` is the count
  // of manifest sentences that have a cached key; `total` is the manifest
  // size; `packed` means the whole section compacted into a pack file.
  async getSectionStatuses(): Promise<
    Map<
      number,
      { total: number; recorded: number; packed: boolean; pinned: boolean; active: boolean }
    >
  > {
    await this.#ensureSchema();
    const out = new Map<
      number,
      { total: number; recorded: number; packed: boolean; pinned: boolean; active: boolean }
    >();
    const totals = await this.#db.select<DatabaseRow & { section: number; total: number }>(
      'SELECT section, COUNT(*) AS total FROM manifest_marks GROUP BY section',
    );
    for (const row of totals)
      out.set(row.section, {
        total: row.total,
        recorded: 0,
        packed: false,
        pinned: false,
        active: false,
      });
    const recorded = await this.#db.select<DatabaseRow & { section: number; recorded: number }>(
      `SELECT mm.section, COUNT(*) AS recorded FROM manifest_marks mm
         JOIN entries e ON e.key = mm.key
        GROUP BY mm.section`,
    );
    for (const row of recorded) {
      const entry = out.get(row.section);
      if (entry) entry.recorded = row.recorded;
    }
    const packed = await this.#db.select<DatabaseRow & { section: number }>(
      `SELECT DISTINCT p.section FROM packs p
        JOIN manifests m ON m.section = p.section AND ${CURRENT_PACK_PREDICATE}`,
    );
    for (const row of packed) {
      const entry = out.get(row.section) ?? {
        total: 0,
        recorded: 0,
        packed: false,
        pinned: false,
        active: false,
      };
      entry.packed = true;
      out.set(row.section, entry);
    }
    const pins = await this.#db.select<
      DatabaseRow & { section: number; active: number; pinned: number }
    >('SELECT section, active, pinned FROM pinned_sections WHERE active > 0 OR pinned = 1');
    for (const row of pins) {
      const entry = out.get(row.section) ?? {
        total: 0,
        recorded: 0,
        packed: false,
        pinned: false,
        active: false,
      };
      entry.pinned = row.pinned === 1;
      entry.active = row.active > 0;
      out.set(row.section, entry);
    }
    return out;
  }

  // Per-ordinal seconds for one voice's cached sentences of a section. Reads
  // boundaries/duration_ms only (audio stays untouched, packed or not):
  // decode-time duration when recorded, else the last word boundary's end.
  async getSectionDurations(section: number, voice: string): Promise<Map<number, number>> {
    await this.#ensureSchema();
    const out = new Map<number, number>();
    const rows = await this.#db.select<
      DatabaseRow & { ordinal: number; boundaries: string; duration_ms: number | null }
    >(
      `SELECT mm.ordinal, e.boundaries, e.duration_ms FROM manifest_marks mm
         JOIN entries e ON e.key = mm.key
        WHERE mm.section = ? AND e.voice = ?`,
      [section, voice],
    );
    for (const row of rows) {
      let seconds = row.duration_ms != null ? row.duration_ms / 1000 : 0;
      if (!(seconds > 0)) {
        try {
          const boundaries = JSON.parse(row.boundaries) as TTSWordBoundary[];
          const last = boundaries[boundaries.length - 1];
          // Boundary offsets are Edge wire ticks (100ns) from stream start.
          if (last) seconds = (last.offset + last.duration) / 10_000_000;
        } catch {
          continue;
        }
      }
      if (seconds > 0) out.set(row.ordinal, seconds);
    }
    return out;
  }

  async totalCacheBytes(): Promise<number> {
    await this.#ensureSchema();
    const rows = await this.#db.select<DatabaseRow & { total: number | null }>(
      `SELECT (SELECT COALESCE(SUM(size), 0) FROM entries WHERE pack_id IS NULL)
            + (SELECT COALESCE(SUM(size), 0) FROM packs) AS total`,
    );
    return rows[0]?.total ?? 0;
  }

  // ── Pack sync surface (services/sync/file/ttsPackSync) ────────────────
  // The database is the source of truth for what packs exist; the sidecar
  // is REBUILT from rows rather than read from disk, so a stale or missing
  // sidecar file can never poison a push.

  async listPacks(): Promise<{ name: string; size: number }[]> {
    await this.#ensureSchema();
    const rows = await this.#db.select<DatabaseRow & { path: string; size: number }>(
      'SELECT path, size FROM packs',
    );
    return rows.map((row) => ({ name: row.path, size: row.size }));
  }

  async hasPack(name: string): Promise<boolean> {
    await this.#ensureSchema();
    const rows = await this.#db.select<DatabaseRow & { id: number }>(
      'SELECT id FROM packs WHERE path = ?',
      [name],
    );
    return rows.length > 0;
  }

  async readPackBytes(name: string): Promise<ArrayBuffer | null> {
    if (!this.#packFs) return null;
    await this.#ensureSchema();
    const rows = await this.#db.select<DatabaseRow & { size: number }>(
      'SELECT size FROM packs WHERE path = ?',
      [name],
    );
    const size = rows[0]?.size;
    if (!size) return null;
    try {
      return await this.#packFs.readRange(name, 0, size);
    } catch {
      return null;
    }
  }

  async buildPackSidecar(name: string): Promise<TTSPackSidecar | null> {
    await this.#ensureSchema();
    const packs = await this.#db.select<
      DatabaseRow & { id: number; section: number; keys_fingerprint: string | null; size: number }
    >('SELECT id, section, keys_fingerprint, size FROM packs WHERE path = ?', [name]);
    const pack = packs[0];
    // Packs from before keys-based identity have no fingerprint: not portable.
    if (!pack?.keys_fingerprint) return null;
    const entries = await this.#db.select<
      DatabaseRow & {
        key: string;
        pack_offset: number;
        pack_length: number;
        boundaries: string;
        duration_ms: number | null;
      }
    >(
      `SELECT key, pack_offset, pack_length, boundaries, duration_ms
         FROM entries WHERE pack_id = ? ORDER BY pack_offset ASC`,
      [pack.id],
    );
    if (!entries.length) return null;
    return {
      version: 1,
      section: pack.section,
      keysFingerprint: pack.keys_fingerprint,
      totalSize: pack.size,
      entries: entries.map((entry) => ({
        key: entry.key,
        offset: entry.pack_offset,
        length: entry.pack_length,
        boundaries: JSON.parse(entry.boundaries) as TTSWordBoundary[],
        durationMs: entry.duration_ms ?? undefined,
      })),
    };
  }

  // Remove pack files the database does not know: tmp files from a crashed
  // compaction and packs whose rows were evicted before the file delete
  // landed. Called once when the per-book store opens.
  async gcPackFiles(): Promise<void> {
    if (!this.#packFs) return;
    await this.#ensureSchema();
    const known = new Set<string>();
    for (const row of await this.#db.select<DatabaseRow & { path: string }>(
      'SELECT path FROM packs',
    )) {
      known.add(row.path);
      known.add(packSidecarName(row.path));
    }
    for (const name of await this.#packFs.list()) {
      if (!known.has(name)) {
        await this.#packFs.remove(name).catch(() => {});
      }
    }
  }

  async #hasActiveDownload(): Promise<boolean> {
    const rows = await this.#db.select<DatabaseRow & { section: number }>(
      'SELECT section FROM pinned_sections WHERE active > 0 LIMIT 1',
    );
    return rows.length > 0;
  }

  async #evictUntilFits(incomingSize: number, replacingKey: string): Promise<boolean> {
    // Pending touches must land first so eviction sees true recency.
    await this.#flushTouches();
    const totals = await this.#db.select<DatabaseRow & { total: number | null }>(
      `SELECT (SELECT COALESCE(SUM(size), 0) FROM entries
                WHERE pack_id IS NULL AND key != ?)
            + (SELECT COALESCE(SUM(size), 0) FROM packs) AS total`,
      [replacingKey],
    );
    let total = totals[0]?.total ?? 0;
    while (total + incomingSize > this.#budgetBytes) {
      const oldestLoose = (
        await this.#db.select<DatabaseRow & { key: string; size: number; accessed_at: number }>(
          `SELECT key, size, accessed_at FROM entries
            WHERE pack_id IS NULL AND key != ?
              AND NOT EXISTS (
                SELECT 1 FROM manifest_marks mm
                  JOIN pinned_sections ps ON ps.section = mm.section
                 WHERE mm.key = entries.key AND (ps.active > 0 OR ps.pinned = 1)
              )
            ORDER BY accessed_at ASC LIMIT 1`,
          [replacingKey],
        )
      )[0];
      const oldestPack = (
        await this.#db.select<
          DatabaseRow & { id: number; path: string; size: number; accessed_at: number }
        >(
          `SELECT id, path, size, accessed_at FROM packs p
            WHERE NOT EXISTS (
              SELECT 1 FROM pinned_sections ps
                JOIN manifests m ON m.section = ps.section
               WHERE ps.section = p.section
                 AND (ps.active > 0 OR ps.pinned = 1)
                 AND ${CURRENT_PACK_PREDICATE}
            )
            ORDER BY accessed_at ASC LIMIT 1`,
        )
      )[0];
      if (!oldestLoose && !oldestPack) return false;
      const evictPack =
        oldestPack && (!oldestLoose || oldestPack.accessed_at <= oldestLoose.accessed_at);
      if (evictPack) {
        await this.#transferSharedEntriesOnPackDeletion([oldestPack!.id]);
        total -= oldestPack!.size;
      } else {
        await this.#db.execute('DELETE FROM entries WHERE key = ?', [oldestLoose!.key]);
        total -= oldestLoose!.size;
      }
    }
    return true;
  }

  // When a pack is about to be deleted (LRU eviction or self-heal because its
  // file is gone), any of its entry rows may still be referenced by a pinned
  // section through `manifest_marks`. Destroying those rows would make the
  // pinned chapter unplayable offline even though the bytes still exist in a
  // surviving pack that contains the same key. This helper repoints each
  // affected entry to a surviving current pack (via the content-addressed
  // `manifest_marks -> packs` bridge), or detaches it to (pack_id = NULL,
  // audio = NULL) when no candidate exists — the same recovery as today's
  // "Download incomplete" path, where the next synthesis repopulates the row.
  //
  // Runs as one transaction so the cache state is always consistent. File I/O
  // (sidecar reads for candidate offsets, then the pack/sidecar removals)
  // happens OUTSIDE the transaction, mirroring the existing self-heal pattern.
  async #transferSharedEntriesOnPackDeletion(packIds: number[]): Promise<void> {
    const packFs = this.#packFs;
    const packPlaceholders = packIds.map(() => '?').join(',');

    // The pack rows being removed: we need their paths for file cleanup.
    // Candidate selection and sidecar reads below run OUTSIDE the transaction
    // (file I/O must not sit inside it), so the transfer UPDATE re-validates
    // each candidate pack still exists before repointing entries at it.
    const packRows = await this.#db.select<DatabaseRow & { id: number; path: string }>(
      `SELECT id, path FROM packs WHERE id IN (${packPlaceholders})`,
      packIds,
    );

    // Candidates: for each key currently owned by one of the deleted packs,
    // find a surviving pack of a section whose manifest records the same key
    // and whose fingerprint matches that section's current manifest. Ranked
    // deterministically (pinned first, then FIFO, then id) so the outcome is
    // order-independent. The inner EXISTS is a correlated subquery (NOT a CTE)
    // so the planner keeps full index flexibility over entries(pack_id).
    const candidates = await this.#db.select<
      DatabaseRow & {
        key: string;
        candidate_pack_id: number;
        candidate_path: string;
        rn: number;
      }
    >(
      `SELECT * FROM (
        SELECT mm.key, p.id AS candidate_pack_id, p.path AS candidate_path,
               ROW_NUMBER() OVER (
                 PARTITION BY mm.key
                 ORDER BY (CASE WHEN ps.pinned = 1 THEN 0 ELSE 1 END),
                          p.created_at, p.id
               ) AS rn
          FROM manifest_marks mm
          JOIN packs p ON p.section = mm.section
          JOIN manifests m ON m.section = p.section AND ${CURRENT_PACK_PREDICATE}
          LEFT JOIN pinned_sections ps ON ps.section = p.section
         WHERE EXISTS (
                 SELECT 1 FROM entries e
                  WHERE e.key = mm.key AND e.pack_id IN (${packPlaceholders})
               )
           AND p.id NOT IN (${packPlaceholders})
       ) ORDER BY key, rn`,
      [...packIds, ...packIds],
    );

    // Resolve offsets/lengths from each candidate pack's sidecar, caching the
    // parse per path and indexing entries by key for O(1) lookups. Candidates
    // arrive in rank order per key, so each key takes its first valid one: a
    // corrupt or missing sidecar disqualifies only that candidate and the key
    // falls through to the next ranked pack. A key that resolves against no
    // candidate at all is left for the detach step below.
    const sidecarCache = new Map<
      string,
      { byKey: Map<string, { offset: number; length: number }> } | null
    >();
    const transfers: {
      key: string;
      packId: number;
      packOffset: number;
      packLength: number;
    }[] = [];
    const resolved = new Set<string>();
    for (const row of candidates) {
      if (resolved.has(row.key)) continue;
      let cached = sidecarCache.get(row.candidate_path);
      if (cached === undefined) {
        if (!packFs) continue;
        const sidecar = await packFs.readSidecar(packSidecarName(row.candidate_path));
        if (!sidecar) {
          sidecarCache.set(row.candidate_path, null);
          continue;
        }
        cached = {
          // Malformed entries are dropped here so a corrupt sidecar can only
          // disqualify its candidate: JSON.stringify drops undefined, so a
          // non-numeric offset passed through would commit as NULL and turn
          // the transferred entry into a permanent silent miss.
          byKey: new Map(
            sidecar.entries
              .filter(
                (e) =>
                  Number.isInteger(e.offset) &&
                  e.offset >= 0 &&
                  Number.isInteger(e.length) &&
                  e.length > 0,
              )
              .map((e) => [e.key, { offset: e.offset, length: e.length }]),
          ),
        };
        sidecarCache.set(row.candidate_path, cached);
      }
      if (!cached) continue;
      const se = cached.byKey.get(row.key);
      if (!se) continue;
      transfers.push({
        key: row.key,
        packId: row.candidate_pack_id,
        packOffset: se.offset,
        packLength: se.length,
      });
      resolved.add(row.key);
    }

    await this.#transaction(async () => {
      // Single UPDATE repointing every transferred entry at its new pack,
      // driven by a JSON payload expanded with json_each (built into libsql).
      // No temp table: the Turso node driver corrupts temp-table DDL on
      // in-memory databases once the schema grows past a few pages.
      if (transfers.length) {
        await this.#db.execute(
          `UPDATE entries
              SET pack_id = json_extract(j.value, '$.pack_id'),
                  pack_offset = json_extract(j.value, '$.pack_offset'),
                  pack_length = json_extract(j.value, '$.pack_length')
             FROM json_each(?) AS j
            WHERE entries.key = json_extract(j.value, '$.k')
              AND EXISTS (
                SELECT 1 FROM packs p WHERE p.id = json_extract(j.value, '$.pack_id')
              )`,
          [
            JSON.stringify(
              transfers.map((t) => ({
                k: t.key,
                pack_id: t.packId,
                pack_offset: t.packOffset,
                pack_length: t.packLength,
              })),
            ),
          ],
        );
      }

      // Entries still owned by a deleted pack after the transfer are the
      // no-candidate ones: detach them to a loose miss (same recovery as the
      // "Download incomplete" path). The transfer UPDATE ran first in this
      // transaction, so no NOT IN/EXISTS guard is needed.
      await this.#db.execute(
        `UPDATE entries
            SET pack_id = NULL, audio = NULL, size = 0,
                pack_offset = NULL, pack_length = NULL
          WHERE pack_id IN (${packPlaceholders})`,
        packIds,
      );

      // Reflect the new active references so a freshly-receiving pack is not
      // immediately re-selected by the LRU.
      if (transfers.length) {
        const distinctCandidateIds = [...new Set(transfers.map((t) => t.packId))];
        await this.#db.execute(
          `UPDATE packs SET accessed_at = ?
            WHERE id IN (${distinctCandidateIds.map(() => '?').join(',')})`,
          [this.#now(), ...distinctCandidateIds],
        );
      }

      // Drop the evicted packs (their entry rows are already gone or moved).
      await this.#db.execute(`DELETE FROM packs WHERE id IN (${packPlaceholders})`, packIds);
    });

    // File cleanup runs after COMMIT (matches the self-heal pattern).
    for (const pack of packRows) {
      await packFs?.remove(pack.path).catch(() => {});
      await packFs?.remove(packSidecarName(pack.path)).catch(() => {});
    }
  }

  async #flushTouches(): Promise<void> {
    if (this.#pendingTouches.size) {
      const touches = [...this.#pendingTouches];
      this.#pendingTouches.clear();
      for (const [key, timestamp] of touches) {
        await this.#db.execute('UPDATE entries SET accessed_at = ? WHERE key = ?', [
          timestamp,
          key,
        ]);
      }
    }
    if (this.#pendingPackTouches.size) {
      const touches = [...this.#pendingPackTouches];
      this.#pendingPackTouches.clear();
      for (const [id, timestamp] of touches) {
        await this.#db.execute('UPDATE packs SET accessed_at = ? WHERE id = ?', [timestamp, id]);
      }
    }
  }

  // Persist pending access times; call before the owner closes the database.
  async flush(): Promise<void> {
    await this.#ensureSchema();
    await this.#flushTouches();
  }
}
