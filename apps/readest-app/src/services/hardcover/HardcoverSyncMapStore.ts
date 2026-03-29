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

  async getMapping(bookHash: string, noteId: string): Promise<HardcoverSyncMapRow | null> {
    if (this.isWebStorageAvailable()) {
      try {
        const raw = window.localStorage.getItem(this.getStorageKey(bookHash, noteId));
        return raw ? (JSON.parse(raw) as HardcoverSyncMapRow) : null;
      } catch (error) {
        console.error('Failed to read Hardcover note mapping from localStorage:', error);
        return null;
      }
    }

    return this.withDb(async (db) => {
      const rows = await db.select<HardcoverSyncMapRow>(
        `SELECT book_hash, note_id, hardcover_journal_id, payload_hash, synced_at
         FROM hardcover_note_mappings
         WHERE book_hash = ? AND note_id = ?
         LIMIT 1`,
        [bookHash, noteId],
      );
      return rows[0] ?? null;
    });
  }

  async getMappingByPayloadHash(
    bookHash: string,
    payloadHash: string,
  ): Promise<HardcoverSyncMapRow | null> {
    if (this.isWebStorageAvailable()) {
      try {
        const prefix = `${STORAGE_PREFIX}:${bookHash}:`;
        let best: HardcoverSyncMapRow | null = null;
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || !key.startsWith(prefix)) continue;
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const row = JSON.parse(raw) as HardcoverSyncMapRow;
          if (row.payload_hash !== payloadHash) continue;
          if (!best || row.synced_at > best.synced_at) {
            best = row;
          }
        }
        return best;
      } catch (error) {
        console.error('Failed to read Hardcover payload mapping from localStorage:', error);
        return null;
      }
    }

    return this.withDb(async (db) => {
      const rows = await db.select<HardcoverSyncMapRow>(
        `SELECT book_hash, note_id, hardcover_journal_id, payload_hash, synced_at
         FROM hardcover_note_mappings
         WHERE book_hash = ? AND payload_hash = ?
         ORDER BY synced_at DESC
         LIMIT 1`,
        [bookHash, payloadHash],
      );
      return rows[0] ?? null;
    });
  }

  async upsertMapping(
    bookHash: string,
    noteId: string,
    journalId: number,
    payloadHash: string,
  ): Promise<void> {
    const now = Date.now();

    if (this.isWebStorageAvailable()) {
      try {
        const row: HardcoverSyncMapRow = {
          book_hash: bookHash,
          note_id: noteId,
          hardcover_journal_id: journalId,
          payload_hash: payloadHash,
          synced_at: now,
        };
        window.localStorage.setItem(this.getStorageKey(bookHash, noteId), JSON.stringify(row));
        return;
      } catch (error) {
        console.error('Failed to write Hardcover note mapping to localStorage:', error);
      }
    }

    await this.withDb(async (db) => {
      await db.execute(
        `INSERT INTO hardcover_note_mappings
          (book_hash, note_id, hardcover_journal_id, payload_hash, synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_hash, note_id)
         DO UPDATE SET
           hardcover_journal_id = excluded.hardcover_journal_id,
           payload_hash = excluded.payload_hash,
           synced_at = excluded.synced_at`,
        [bookHash, noteId, journalId, payloadHash, now],
      );
    });
  }
}
