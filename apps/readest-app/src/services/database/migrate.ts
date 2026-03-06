import { DatabaseService } from '@/types/database';

export interface MigrationEntry {
  /** Migration name, e.g. "2026030601_initial_schema" */
  name: string;
  /** SQL statements separated by semicolons */
  sql: string;
}

/**
 * Discriminator for databases with different schemas.
 * Add new schema types here as needed.
 */
export type SchemaType = string;

export interface MigrateOptions {
  /** Name of the tracking table. @default '__migrations' */
  table?: string;
}

/**
 * Run pending migrations against a DatabaseService instance.
 *
 * Uses PRAGMA user_version as an O(1) fast-path to skip migration checks
 * when the database is already at the latest version. This makes it cheap
 * to call on every openDatabase(), even with hundreds of database files.
 *
 * Each migration runs atomically via batch() — the schema changes and
 * the tracking record are committed together.
 */
export async function migrate(
  db: DatabaseService,
  migrations: MigrationEntry[],
  options: MigrateOptions = {},
): Promise<void> {
  const targetVersion = migrations.length;
  if (targetVersion === 0) return;

  // Fast path: PRAGMA user_version is stored in the file header.
  // Reading it requires no table scan — essentially free.
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = rows[0]?.user_version ?? 0;
  if (currentVersion >= targetVersion) return;

  const table = options.table ?? '__migrations';

  // Ensure tracking table exists (only reached when migrations are needed)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Get already-applied migration names
  const applied = await db.select<{ name: string }>(`SELECT name FROM ${table}`);
  const appliedSet = new Set(applied.map((r) => r.name));

  // Apply pending migrations in order
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]!;
    if (appliedSet.has(migration.name)) continue;

    const statements = migration.sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Record the migration and bump user_version atomically
    const safeName = migration.name.replace(/'/g, "''");
    statements.push(`INSERT INTO ${table} (name) VALUES ('${safeName}')`);
    statements.push(`PRAGMA user_version = ${i + 1}`);

    await db.batch(statements);
  }
}
