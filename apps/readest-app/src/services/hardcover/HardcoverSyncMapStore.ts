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

export class HardcoverSyncMapStore {
  private appService: AppService;

  constructor(appService: AppService) {
    this.appService = appService;
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

  async upsertMapping(
    bookHash: string,
    noteId: string,
    journalId: number,
    payloadHash: string,
  ): Promise<void> {
    const now = Date.now();
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
