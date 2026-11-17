import type { MigrationEntry } from '@/services/database/migrate';

export const XRAY_MIGRATIONS: MigrationEntry[] = [
  {
    name: '2026082401_xray_storage',
    sql: `
      CREATE TABLE IF NOT EXISTS xray_books (
        book_hash TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        max_position_index INTEGER NOT NULL,
        pending_position_index INTEGER,
        last_batch_id TEXT,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS xray_batches (
        batch_id TEXT NOT NULL,
        book_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        min_position_index INTEGER NOT NULL,
        max_position_index INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (batch_id, book_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_xray_batches_book_position
      ON xray_batches (book_hash, max_position_index, min_position_index);

      CREATE TABLE IF NOT EXISTS xray_lookups (
        lookup_key TEXT NOT NULL,
        book_hash TEXT NOT NULL,
        max_position_index INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (lookup_key, book_hash, max_position_index, fingerprint)
      );
    `,
  },
];
