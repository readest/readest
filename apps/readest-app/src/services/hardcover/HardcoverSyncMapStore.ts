import { AppService } from '@/types/system';

type HardcoverSyncMapRow = {
  book_hash: string;
  note_id: string;
  hardcover_journal_id: number;
  payload_hash: string;
  synced_at: number;
};

const DB_SCHEMA = 'hardcover-sync';
const DB_PATH = 'hardcover-sync.db';
// Legacy localStorage key prefix used on Web before this store moved to SQLite.
// Kept only for one-time migration of existing entries into the database.
const LEGACY_STORAGE_PREFIX = 'hardcover-note-mapping';

const UPSERT_SQL = `
  INSERT INTO hardcover_note_mappings
    (book_hash, note_id, hardcover_journal_id, payload_hash, synced_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(book_hash, note_id)
   DO UPDATE SET
     hardcover_journal_id = excluded.hardcover_journal_id,
     payload_hash = excluded.payload_hash,
     synced_at = excluded.synced_at
`;

type OpenDb = Awaited<ReturnType<AppService['openDatabase']>>;

export class HardcoverSyncMapStore {
  private appService: AppService;
  private loadedBookHash: string | null = null;
  private mappings: Map<string, HardcoverSyncMapRow> = new Map();
  private modified: boolean = false;

  constructor(appService: AppService) {
    this.appService = appService;
  }

  private async withDb<T>(fn: (db: OpenDb) => Promise<T>) {
    const db = await this.appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  private async upsertRow(db: OpenDb, row: HardcoverSyncMapRow): Promise<void> {
    await db.execute(UPSERT_SQL, [
      row.book_hash,
      row.note_id,
      row.hardcover_journal_id,
      row.payload_hash,
      row.synced_at,
    ]);
  }

  // One-time migration: lift legacy localStorage entries for this book into
  // the database, then remove them. Runs only when window.localStorage is
  // available (i.e. on Web); a no-op on Tauri/native.
  private async migrateLegacyForBook(db: OpenDb, bookHash: string): Promise<void> {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    const prefix = `${LEGACY_STORAGE_PREFIX}:${bookHash}:`;
    const legacyKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        legacyKeys.push(key);
      }
    }
    if (legacyKeys.length === 0) return;

    for (const key of legacyKeys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        window.localStorage.removeItem(key);
        continue;
      }
      try {
        const row = JSON.parse(raw) as HardcoverSyncMapRow;
        await this.upsertRow(db, row);
      } catch (error) {
        console.error('Failed to migrate Hardcover mapping from localStorage:', error);
      }
      window.localStorage.removeItem(key);
    }
  }

  async loadForBook(bookHash: string): Promise<void> {
    this.loadedBookHash = bookHash;
    this.mappings.clear();
    this.modified = false;

    await this.withDb(async (db) => {
      await this.migrateLegacyForBook(db, bookHash);

      const rows = await db.select<HardcoverSyncMapRow>(
        `SELECT book_hash, note_id, hardcover_journal_id, payload_hash, synced_at
         FROM hardcover_note_mappings
         WHERE book_hash = ?`,
        [bookHash],
      );
      for (const row of rows) {
        this.mappings.set(row.note_id, row);
      }
    });
  }

  async flush(): Promise<void> {
    if (!this.modified || !this.loadedBookHash) return;

    await this.withDb(async (db) => {
      for (const row of this.mappings.values()) {
        await this.upsertRow(db, row);
      }
    });
    this.modified = false;
  }

  async getMapping(bookHash: string, noteId: string): Promise<HardcoverSyncMapRow | null> {
    if (this.loadedBookHash !== bookHash) {
      await this.loadForBook(bookHash);
    }
    return this.mappings.get(noteId) || null;
  }

  async getMappingByPayloadHash(
    bookHash: string,
    payloadHash: string,
  ): Promise<HardcoverSyncMapRow | null> {
    if (this.loadedBookHash !== bookHash) {
      await this.loadForBook(bookHash);
    }
    let best: HardcoverSyncMapRow | null = null;
    for (const row of this.mappings.values()) {
      if (row.payload_hash === payloadHash) {
        if (!best || row.synced_at > best.synced_at) best = row;
      }
    }
    return best;
  }

  async upsertMapping(
    bookHash: string,
    noteId: string,
    journalId: number,
    payloadHash: string,
  ): Promise<void> {
    if (this.loadedBookHash !== bookHash) {
      await this.loadForBook(bookHash);
    }
    this.mappings.set(noteId, {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: journalId,
      payload_hash: payloadHash,
      synced_at: Date.now(),
    });
    this.modified = true;
  }
}
