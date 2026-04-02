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
const STORAGE_PREFIX = 'hardcover-note-mapping';

export class HardcoverSyncMapStore {
  private appService: AppService;
  private loadedBookHash: string | null = null;
  private mappings: Map<string, HardcoverSyncMapRow> = new Map();
  private modified: boolean = false;

  constructor(appService: AppService) {
    this.appService = appService;
  }

  private isWebStorageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  private getStorageKey(bookHash: string, noteId: string): string {
    return `${STORAGE_PREFIX}:${bookHash}:${noteId}`;
  }

  private async withDb<T>(fn: (db: Awaited<ReturnType<AppService['openDatabase']>>) => Promise<T>) {
    const db = await this.appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  async loadForBook(bookHash: string): Promise<void> {
    this.loadedBookHash = bookHash;
    this.mappings.clear();
    this.modified = false;

    if (this.isWebStorageAvailable()) {
      try {
        const prefix = `${STORAGE_PREFIX}:${bookHash}:`;
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const row = JSON.parse(raw) as HardcoverSyncMapRow;
              this.mappings.set(row.note_id, row);
            }
          }
        }
      } catch (error) {
        console.error('Failed to read Hardcover note mapping from localStorage:', error);
      }
      return;
    }

    await this.withDb(async (db) => {
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

    if (this.isWebStorageAvailable()) {
      try {
        for (const row of this.mappings.values()) {
          window.localStorage.setItem(
            this.getStorageKey(row.book_hash, row.note_id),
            JSON.stringify(row),
          );
        }
        this.modified = false;
      } catch (error) {
        console.error('Failed to write Hardcover note mapping to localStorage:', error);
      }
      return;
    }

    await this.withDb(async (db) => {
      // Execute inserts sequentially but within a single DB connection
      for (const row of this.mappings.values()) {
        await db.execute(
          `INSERT INTO hardcover_note_mappings
            (book_hash, note_id, hardcover_journal_id, payload_hash, synced_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(book_hash, note_id)
           DO UPDATE SET
             hardcover_journal_id = excluded.hardcover_journal_id,
             payload_hash = excluded.payload_hash,
             synced_at = excluded.synced_at`,
          [row.book_hash, row.note_id, row.hardcover_journal_id, row.payload_hash, row.synced_at],
        );
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
