import type { AppService } from '@/types/system';

export interface NotionPageMapping {
  targetId: string;
  bookHash: string;
  pageId: string;
  title: string;
}

export interface NotionNoteMapping {
  targetId: string;
  bookHash: string;
  noteId: string;
  payloadHash: string;
  blockIds: string[];
  staleBlockIds: string[];
}

export interface NotionSyncStoreLike {
  getPageMapping(targetId: string, bookHash: string): Promise<NotionPageMapping | null>;
  setPageMapping(mapping: NotionPageMapping): Promise<void>;
  clearBookMappings(targetId: string, bookHash: string): Promise<void>;
  getNoteMapping(
    targetId: string,
    bookHash: string,
    noteId: string,
  ): Promise<NotionNoteMapping | null>;
  setNoteMapping(mapping: NotionNoteMapping): Promise<void>;
}

type PageRow = {
  target_id: string;
  book_hash: string;
  page_id: string;
  title: string;
};

type NoteRow = {
  target_id: string;
  book_hash: string;
  note_id: string;
  payload_hash: string;
  block_ids: string;
  stale_block_ids: string;
};

const DB_SCHEMA = 'notion-sync';
const DB_PATH = 'notion-sync.db';
type OpenDb = Awaited<ReturnType<AppService['openDatabase']>>;

const parseIds = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Durable remote identities make Notion pushes updateable and retry-safe. */
export class NotionSyncStore implements NotionSyncStoreLike {
  private databasePromise: Promise<OpenDb> | null = null;

  constructor(private readonly appService: AppService) {}

  private async withDb<T>(callback: (database: OpenDb) => Promise<T>): Promise<T> {
    this.databasePromise ??= this.appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    return callback(await this.databasePromise);
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise;
    this.databasePromise = null;
    if (databasePromise) await (await databasePromise).close();
  }

  async getPageMapping(targetId: string, bookHash: string): Promise<NotionPageMapping | null> {
    return this.withDb(async (database) => {
      const rows = await database.select<PageRow>(
        `SELECT target_id, book_hash, page_id, title
         FROM notion_book_pages
         WHERE target_id = ? AND book_hash = ?`,
        [targetId, bookHash],
      );
      const row = rows[0];
      return row
        ? {
            targetId: row.target_id,
            bookHash: row.book_hash,
            pageId: row.page_id,
            title: row.title,
          }
        : null;
    });
  }

  async setPageMapping(mapping: NotionPageMapping): Promise<void> {
    await this.withDb(async (database) => {
      await database.execute(
        `INSERT INTO notion_book_pages (target_id, book_hash, page_id, title)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(target_id, book_hash)
         DO UPDATE SET page_id = excluded.page_id, title = excluded.title`,
        [mapping.targetId, mapping.bookHash, mapping.pageId, mapping.title],
      );
    });
  }

  async clearBookMappings(targetId: string, bookHash: string): Promise<void> {
    await this.withDb(async (database) => {
      await database.execute('BEGIN');
      try {
        await database.execute(
          'DELETE FROM notion_note_mappings WHERE target_id = ? AND book_hash = ?',
          [targetId, bookHash],
        );
        await database.execute(
          'DELETE FROM notion_book_pages WHERE target_id = ? AND book_hash = ?',
          [targetId, bookHash],
        );
        await database.execute('COMMIT');
      } catch (error) {
        await database.execute('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  }

  async getNoteMapping(
    targetId: string,
    bookHash: string,
    noteId: string,
  ): Promise<NotionNoteMapping | null> {
    return this.withDb(async (database) => {
      const rows = await database.select<NoteRow>(
        `SELECT target_id, book_hash, note_id, payload_hash, block_ids, stale_block_ids
         FROM notion_note_mappings
         WHERE target_id = ? AND book_hash = ? AND note_id = ?`,
        [targetId, bookHash, noteId],
      );
      const row = rows[0];
      return row
        ? {
            targetId: row.target_id,
            bookHash: row.book_hash,
            noteId: row.note_id,
            payloadHash: row.payload_hash,
            blockIds: parseIds(row.block_ids),
            staleBlockIds: parseIds(row.stale_block_ids),
          }
        : null;
    });
  }

  async setNoteMapping(mapping: NotionNoteMapping): Promise<void> {
    await this.withDb(async (database) => {
      await database.execute(
        `INSERT INTO notion_note_mappings
           (target_id, book_hash, note_id, payload_hash, block_ids, stale_block_ids, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(target_id, book_hash, note_id)
         DO UPDATE SET
           payload_hash = excluded.payload_hash,
           block_ids = excluded.block_ids,
           stale_block_ids = excluded.stale_block_ids,
           synced_at = excluded.synced_at`,
        [
          mapping.targetId,
          mapping.bookHash,
          mapping.noteId,
          mapping.payloadHash,
          JSON.stringify(mapping.blockIds),
          JSON.stringify(mapping.staleBlockIds),
          Date.now(),
        ],
      );
    });
  }
}
