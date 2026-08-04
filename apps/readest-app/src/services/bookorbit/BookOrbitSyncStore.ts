import type { AppService } from '@/types/system';

export interface BookOrbitNoteIdentity {
  /** KOReader identity datetime the exchange key is derived from. */
  datetime: string;
  serverId: number | null;
}

export type BookOrbitWatermarkKind = 'annotations' | 'bookmarks';

type MappingRow = {
  book_hash: string;
  note_id: string;
  server_id: number | null;
  ko_datetime: string;
  synced_at: number;
};

type BookSyncRow = {
  book_hash: string;
  annotations_synced_at: number;
  bookmarks_synced_at: number;
};

const DB_SCHEMA = 'bookorbit-sync';
const DB_PATH = 'bookorbit-sync.db';

const UPSERT_MAPPING_SQL = `
  INSERT INTO bookorbit_note_mappings
    (book_hash, note_id, server_id, ko_datetime, synced_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(book_hash, note_id)
   DO UPDATE SET
     server_id = excluded.server_id,
     ko_datetime = excluded.ko_datetime,
     synced_at = excluded.synced_at
`;

const UPSERT_BOOK_SYNC_SQL = `
  INSERT INTO bookorbit_book_sync
    (book_hash, annotations_synced_at, bookmarks_synced_at)
   VALUES (?, ?, ?)
   ON CONFLICT(book_hash)
   DO UPDATE SET
     annotations_synced_at = excluded.annotations_synced_at,
     bookmarks_synced_at = excluded.bookmarks_synced_at
`;

type OpenDb = Awaited<ReturnType<AppService['openDatabase']>>;

/**
 * Persists per-book BookOrbit sync state: the KOReader identity datetime of
 * remote-born notes (not re-derivable from the note itself) and the per-kind
 * exchange watermarks. Mirrors HardcoverSyncMapStore's load-modify-flush shape.
 */
export class BookOrbitSyncStore {
  private appService: AppService;
  private loadedBookHash: string | null = null;
  private mappings: Map<string, MappingRow> = new Map();
  private watermarks: BookSyncRow | null = null;
  private modified = false;

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

  async loadForBook(bookHash: string): Promise<void> {
    this.loadedBookHash = bookHash;
    this.mappings.clear();
    this.watermarks = null;
    this.modified = false;

    await this.withDb(async (db) => {
      const rows = await db.select<MappingRow>(
        `SELECT book_hash, note_id, server_id, ko_datetime, synced_at
         FROM bookorbit_note_mappings
         WHERE book_hash = ?`,
        [bookHash],
      );
      for (const row of rows) {
        this.mappings.set(row.note_id, row);
      }
      const syncRows = await db.select<BookSyncRow>(
        `SELECT book_hash, annotations_synced_at, bookmarks_synced_at
         FROM bookorbit_book_sync
         WHERE book_hash = ?`,
        [bookHash],
      );
      this.watermarks = syncRows[0] ?? {
        book_hash: bookHash,
        annotations_synced_at: 0,
        bookmarks_synced_at: 0,
      };
    });
  }

  private async ensureLoaded(bookHash: string): Promise<void> {
    if (this.loadedBookHash !== bookHash) {
      await this.loadForBook(bookHash);
    }
  }

  async getIdentity(bookHash: string, noteId: string): Promise<BookOrbitNoteIdentity | null> {
    await this.ensureLoaded(bookHash);
    const row = this.mappings.get(noteId);
    return row ? { datetime: row.ko_datetime, serverId: row.server_id } : null;
  }

  async getIdentities(bookHash: string): Promise<Map<string, BookOrbitNoteIdentity>> {
    await this.ensureLoaded(bookHash);
    const out = new Map<string, BookOrbitNoteIdentity>();
    for (const row of this.mappings.values()) {
      out.set(row.note_id, { datetime: row.ko_datetime, serverId: row.server_id });
    }
    return out;
  }

  async setIdentity(
    bookHash: string,
    noteId: string,
    identity: BookOrbitNoteIdentity,
  ): Promise<void> {
    await this.ensureLoaded(bookHash);
    this.mappings.set(noteId, {
      book_hash: bookHash,
      note_id: noteId,
      server_id: identity.serverId,
      ko_datetime: identity.datetime,
      synced_at: Date.now(),
    });
    this.modified = true;
  }

  async getWatermark(bookHash: string, kind: BookOrbitWatermarkKind): Promise<number> {
    await this.ensureLoaded(bookHash);
    if (!this.watermarks) return 0;
    return kind === 'annotations'
      ? this.watermarks.annotations_synced_at
      : this.watermarks.bookmarks_synced_at;
  }

  async setWatermark(bookHash: string, kind: BookOrbitWatermarkKind, value: number): Promise<void> {
    await this.ensureLoaded(bookHash);
    if (!this.watermarks) return;
    if (kind === 'annotations') {
      this.watermarks.annotations_synced_at = value;
    } else {
      this.watermarks.bookmarks_synced_at = value;
    }
    this.modified = true;
  }

  async flush(): Promise<void> {
    if (!this.modified || !this.loadedBookHash) return;

    await this.withDb(async (db) => {
      for (const row of this.mappings.values()) {
        await db.execute(UPSERT_MAPPING_SQL, [
          row.book_hash,
          row.note_id,
          row.server_id,
          row.ko_datetime,
          row.synced_at,
        ]);
      }
      if (this.watermarks) {
        await db.execute(UPSERT_BOOK_SYNC_SQL, [
          this.watermarks.book_hash,
          this.watermarks.annotations_synced_at,
          this.watermarks.bookmarks_synced_at,
        ]);
      }
    });
    this.modified = false;
  }
}
