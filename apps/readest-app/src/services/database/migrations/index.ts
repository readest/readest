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
};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}
