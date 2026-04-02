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
  // Example schema — replace with real migrations when ready:
  //
  // library: [
  //   {
  //     name: '2026030601_initial_schema',
  //     sql: `
  //       CREATE TABLE IF NOT EXISTS books (
  //         id INTEGER PRIMARY KEY AUTOINCREMENT,
  //         title TEXT NOT NULL,
  //         author TEXT,
  //         path TEXT NOT NULL UNIQUE,
  //         created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  //       );
  //     `,
  //   },
  // ],
};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}
