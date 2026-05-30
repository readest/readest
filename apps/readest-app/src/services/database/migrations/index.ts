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
  opds: [
    {
      name: '2026052701_opds_source_mappings',
      sql: `
        CREATE TABLE IF NOT EXISTS opds_source_mappings (
          catalog_id TEXT NOT NULL,
          source_url TEXT NOT NULL,
          book_hash TEXT NOT NULL,
          PRIMARY KEY (catalog_id, source_url)
        );
      `,
    },
  ],
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
    {
      // Memory store for the agent runtime (Phase 3.1). One table, three
      // scopes: user / book / session. UNIQUE(scope, scope_key, key)
      // gives us upsert semantics — writing the same key twice replaces
      // the prior summary. Embeddings live in a sibling table created
      // lazily by MemoryService (same single-model-lock pattern as
      // reedy_book_chunk_embeddings) so the vector32 dim matches the
      // active embedding model.
      name: '2026052603_reedy_memory',
      sql: `
        CREATE TABLE IF NOT EXISTS reedy_memory (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          scope_key TEXT NOT NULL,
          key TEXT NOT NULL,
          summary TEXT NOT NULL,
          source_message_id TEXT,
          updated_at INTEGER NOT NULL,
          UNIQUE(scope, scope_key, key)
        );

        CREATE INDEX IF NOT EXISTS idx_memory_scope
        ON reedy_memory (scope, scope_key, updated_at DESC);
      `,
    },
    {
      // Skill catalog for the agent runtime (Phase 5.1). Built-in skills
      // are seeded on first SkillRegistry boot; user-defined skills
      // (post-MVP) live in the same table with builtin=0. tool_allowlist
      // is a JSON-encoded string array applied by the runtime when
      // building the per-turn ToolSet.
      name: '2026052604_reedy_skills',
      sql: `
        CREATE TABLE IF NOT EXISTS reedy_skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          instructions TEXT NOT NULL,
          tool_allowlist TEXT,
          builtin INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1
        );
      `,
    },
  ],
};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}
