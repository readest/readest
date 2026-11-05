import type { AppService } from '@/types/system';
import type { GrimmoryNoteKind, GrimmoryNoteLink } from './notesSync';
import type { GrimmoryBookType } from './types';

/** The Grimmory book and file a local book was verified to be. */
export interface GrimmoryBookMatch {
  bookId: number;
  bookFileId: number;
  bookType: GrimmoryBookType | null;
  /** Whether the file is the book's primary file (not an alternative format). */
  isPrimary: boolean;
  /** readingStatusUpdatedAt of the status last sent; 0 when none was. */
  statusPushedAt: number;
}

type BookRow = {
  book_hash: string;
  book_id: number;
  book_file_id: number;
  book_type: string | null;
  is_primary: number;
  status_pushed_at: number;
};

type LinkRow = {
  note_id: string;
  kind: string;
  server_id: number;
  local_updated_at: number;
};

const DB_SCHEMA = 'grimmory-sync';
const DB_PATH = 'grimmory-sync.db';

type OpenDb = Awaited<ReturnType<AppService['openDatabase']>>;

const toMatch = (row: BookRow): GrimmoryBookMatch => ({
  bookId: Number(row.book_id),
  bookFileId: Number(row.book_file_id),
  bookType: row.book_type,
  isPrimary: !!Number(row.is_primary),
  statusPushedAt: Number(row.status_pushed_at),
});

/**
 * Local Grimmory sync state, per account (server + user): which Grimmory book
 * each local book is, and which server item each synced note is linked to.
 */
export class GrimmorySyncStore {
  constructor(private appService: AppService) {}

  private async withDb<T>(fn: (db: OpenDb) => Promise<T>): Promise<T> {
    const db = await this.appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  getBook(account: string, bookHash: string): Promise<GrimmoryBookMatch | null> {
    return this.withDb(async (db) => {
      const rows = await db.select<BookRow>(
        `SELECT * FROM grimmory_books WHERE account = ? AND book_hash = ?`,
        [account, bookHash],
      );
      return rows[0] ? toMatch(rows[0]) : null;
    });
  }

  getBooks(account: string): Promise<Map<string, GrimmoryBookMatch>> {
    return this.withDb(async (db) => {
      const rows = await db.select<BookRow>(`SELECT * FROM grimmory_books WHERE account = ?`, [
        account,
      ]);
      return new Map(rows.map((row) => [row.book_hash, toMatch(row)]));
    });
  }

  setBook(account: string, bookHash: string, match: GrimmoryBookMatch): Promise<void> {
    return this.withDb(async (db) => {
      await db.execute(
        `INSERT INTO grimmory_books
           (account, book_hash, book_id, book_file_id, book_type, is_primary, status_pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account, book_hash) DO UPDATE SET
           book_id = excluded.book_id,
           book_file_id = excluded.book_file_id,
           book_type = excluded.book_type,
           is_primary = excluded.is_primary,
           status_pushed_at = excluded.status_pushed_at`,
        [
          account,
          bookHash,
          match.bookId,
          match.bookFileId,
          match.bookType,
          match.isPrimary ? 1 : 0,
          match.statusPushedAt,
        ],
      );
    });
  }

  /** Forget a match and its links, e.g. when the Grimmory book was deleted. */
  deleteBook(account: string, bookHash: string): Promise<void> {
    return this.withDb(async (db) => {
      await db.execute(`DELETE FROM grimmory_books WHERE account = ? AND book_hash = ?`, [
        account,
        bookHash,
      ]);
      await db.execute(`DELETE FROM grimmory_note_links WHERE account = ? AND book_hash = ?`, [
        account,
        bookHash,
      ]);
    });
  }

  getLinks(account: string, bookHash: string): Promise<GrimmoryNoteLink[]> {
    return this.withDb(async (db) => {
      const rows = await db.select<LinkRow>(
        `SELECT note_id, kind, server_id, local_updated_at FROM grimmory_note_links
         WHERE account = ? AND book_hash = ?`,
        [account, bookHash],
      );
      return rows.map((row) => ({
        noteId: row.note_id,
        kind: row.kind as GrimmoryNoteKind,
        serverId: Number(row.server_id),
        localUpdatedAt: Number(row.local_updated_at),
      }));
    });
  }

  /** Replace every link of one kind for a book. */
  setLinks(
    account: string,
    bookHash: string,
    kind: GrimmoryNoteKind,
    links: GrimmoryNoteLink[],
  ): Promise<void> {
    return this.withDb(async (db) => {
      await db.execute(
        `DELETE FROM grimmory_note_links WHERE account = ? AND book_hash = ? AND kind = ?`,
        [account, bookHash, kind],
      );
      for (const link of links) {
        await db.execute(
          `INSERT OR REPLACE INTO grimmory_note_links
             (account, book_hash, note_id, kind, server_id, local_updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [account, bookHash, link.noteId, kind, link.serverId, link.localUpdatedAt],
        );
      }
    });
  }
}
