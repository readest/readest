import { MigrationEntry, SchemaType } from '../migrate';

/**
 * Migration definitions for each schema type.
 *
 * To add a new migration:
 *   1. Append a new entry to the appropriate schema array below.
 *   2. Use a date-based name: YYYYMMDDNN (NN = sequence within the day).
 *   3. Never reorder or remove existing entries.
 *
 * To add a new schema type:
 *   1. Add the type to SchemaType in migrate.ts.
 *   2. Add a new key here with its migration array.
 */
const migrations: Record<SchemaType, MigrationEntry[]> = {
  'hardcover-sync': [
    {
      name: '2026032901_hardcover_note_mappings',
      sql: `
        CREATE TABLE IF NOT EXISTS hardcover_note_mappings (
          book_hash TEXT NOT NULL,
          note_id TEXT NOT NULL,
          hardcover_journal_id INTEGER NOT NULL,
          payload_hash TEXT NOT NULL,
          synced_at INTEGER NOT NULL,
          PRIMARY KEY (book_hash, note_id)
        );

        CREATE INDEX IF NOT EXISTS idx_hardcover_note_mappings_synced_at
        ON hardcover_note_mappings (synced_at);
      `,
    },
  ],
  // The embeddings table is created lazily by BookIndexer because its
  // vector32(<dim>) column needs the active embedding model's dim, which
  // isn't known at migration time. Tantivy FTS lives on the chunks.text
  // column directly (no virtual table). Writers MUST DELETE+INSERT chunk
  // rows rather than UPDATE — Tantivy 0.25→0.26 has a known WASM-only
  // UPDATE regression (see fts-tests.ts:306 FIXME). MVP indexing is
  // write-once per book so this is naturally satisfied.
  reedy: [
    {
      name: '2026052601_reedy_init',
      sql: `
        CREATE TABLE IF NOT EXISTS reedy_book_meta (
          book_hash TEXT PRIMARY KEY,
          indexing_status TEXT NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          embedding_model TEXT NOT NULL,
          embedding_dim INTEGER NOT NULL,
          indexed_at INTEGER,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS reedy_book_chunks (
          id TEXT PRIMARY KEY,
          book_hash TEXT NOT NULL,
          section_index INTEGER NOT NULL,
          chapter_title TEXT,
          start_cfi TEXT NOT NULL,
          end_cfi TEXT NOT NULL,
          position_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          token_count INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_book_position
        ON reedy_book_chunks (book_hash, position_index);

        CREATE INDEX IF NOT EXISTS idx_chunks_fts
        ON reedy_book_chunks USING fts (text) WITH (tokenizer = 'ngram');
      `,
    },
    {
      // MVP measurement (plan §M1.9). Local-only by default — no network
      // egress; the user can manually export a 90-day JSON bundle from
      // settings to share. `app_version` + `schema_version` are captured
      // per row so future bundle replay still parses cleanly after we
      // evolve the event shape.
      name: '2026052602_reedy_metrics',
      sql: `
        CREATE TABLE IF NOT EXISTS reedy_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          event TEXT NOT NULL,
          book_hash TEXT,
          session_id TEXT,
          turn_id TEXT,
          message_id TEXT,
          app_version TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          payload TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_metrics_ts ON reedy_metrics (ts DESC);
        CREATE INDEX IF NOT EXISTS idx_metrics_session ON reedy_metrics (session_id, ts DESC);
      `,
    },
  ],
};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}
