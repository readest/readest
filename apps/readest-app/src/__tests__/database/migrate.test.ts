import { describe, it, expect, beforeEach } from 'vitest';
import { migrate, MigrationEntry } from '@/services/database/migrate';
import { DatabaseService, DatabaseExecResult, DatabaseRow } from '@/types/database';

/**
 * In-memory DatabaseService for testing the migration runner.
 * Tracks tables, rows, and PRAGMA user_version.
 */
function createMockDb(): DatabaseService & {
  userVersion: number;
  tables: Map<string, DatabaseRow[]>;
} {
  const tables = new Map<string, DatabaseRow[]>();
  let userVersion = 0;

  const db: DatabaseService & { userVersion: number; tables: Map<string, DatabaseRow[]> } = {
    userVersion: 0,
    tables,

    async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecResult> {
      const trimmed = sql.trim();

      if (/^CREATE TABLE/i.test(trimmed)) {
        const tableName = trimmed.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i)?.[1];
        if (tableName && !tables.has(tableName)) {
          tables.set(tableName, []);
        }
        return { rowsAffected: 0, lastInsertId: 0 };
      }

      if (/^INSERT INTO/i.test(trimmed)) {
        const tableName = trimmed.match(/INTO\s+(\w+)/i)?.[1] ?? '_default';
        const existing = tables.get(tableName) ?? [];
        const id = existing.length + 1;

        // Parse VALUES for the migration tracking table
        const valuesMatch = trimmed.match(/VALUES\s*\(([^)]+)\)/i);
        if (valuesMatch) {
          const rawVal =
            params.length > 0 ? params[0] : valuesMatch[1]!.trim().replace(/^'|'$/g, '');
          existing.push({ id, name: rawVal });
        } else {
          existing.push({ id });
        }
        tables.set(tableName, existing);
        return { rowsAffected: 1, lastInsertId: id };
      }

      return { rowsAffected: 0, lastInsertId: 0 };
    },

    async select<T extends DatabaseRow = DatabaseRow>(sql: string): Promise<T[]> {
      const trimmed = sql.trim();

      if (/^PRAGMA user_version/i.test(trimmed)) {
        return [{ user_version: userVersion } as unknown as T];
      }

      const tableName = trimmed.match(/FROM\s+(\w+)/i)?.[1] ?? '_default';
      return (tables.get(tableName) ?? []) as T[];
    },

    async batch(statements: string[]): Promise<void> {
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (/^PRAGMA user_version\s*=/i.test(trimmed)) {
          const val = parseInt(trimmed.match(/=\s*(\d+)/)?.[1] ?? '0', 10);
          userVersion = val;
          db.userVersion = val;
        } else {
          await db.execute(trimmed);
        }
      }
    },

    async close(): Promise<void> {
      tables.clear();
    },
  };

  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrate()', () => {
  let db: ReturnType<typeof createMockDb>;

  const migrations: MigrationEntry[] = [
    {
      name: '2026030601_create_books',
      sql: `
        CREATE TABLE IF NOT EXISTS books (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL
        );
      `,
    },
    {
      name: '2026030602_create_annotations',
      sql: `
        CREATE TABLE IF NOT EXISTS annotations (
          id INTEGER PRIMARY KEY,
          book_id INTEGER NOT NULL,
          text TEXT
        );
      `,
    },
  ];

  beforeEach(() => {
    db = createMockDb();
  });

  it('applies all migrations on a fresh database', async () => {
    await migrate(db, migrations);

    expect(db.tables.has('books')).toBe(true);
    expect(db.tables.has('annotations')).toBe(true);
    expect(db.tables.has('__migrations')).toBe(true);
    expect(db.userVersion).toBe(2);
  });

  it('records migration names in the tracking table', async () => {
    await migrate(db, migrations);

    const tracked = db.tables.get('__migrations') ?? [];
    const names = tracked.map((r) => r['name']);
    expect(names).toContain('2026030601_create_books');
    expect(names).toContain('2026030602_create_annotations');
  });

  it('skips already-applied migrations (idempotent)', async () => {
    await migrate(db, migrations);
    const firstRunTracked = (db.tables.get('__migrations') ?? []).length;

    // Run again — should be a no-op via PRAGMA user_version fast-path
    await migrate(db, migrations);
    const secondRunTracked = (db.tables.get('__migrations') ?? []).length;

    expect(secondRunTracked).toBe(firstRunTracked);
    expect(db.userVersion).toBe(2);
  });

  it('applies only new migrations when schema grows', async () => {
    // Apply first migration only
    await migrate(db, [migrations[0]!]);
    expect(db.userVersion).toBe(1);
    expect(db.tables.has('books')).toBe(true);
    expect(db.tables.has('annotations')).toBe(false);

    // Now apply both — only second should run
    await migrate(db, migrations);
    expect(db.userVersion).toBe(2);
    expect(db.tables.has('annotations')).toBe(true);

    const tracked = db.tables.get('__migrations') ?? [];
    expect(tracked).toHaveLength(2);
  });

  it('does nothing when migrations array is empty', async () => {
    await migrate(db, []);
    expect(db.tables.size).toBe(0);
    expect(db.userVersion).toBe(0);
  });

  it('uses custom tracking table name', async () => {
    await migrate(db, migrations, { table: '__custom_migrations' });

    expect(db.tables.has('__custom_migrations')).toBe(true);
    expect(db.tables.has('__migrations')).toBe(false);
  });

  it('handles migration names with single quotes', async () => {
    const trickyMigrations: MigrationEntry[] = [
      {
        name: "2026030601_it's_tricky",
        sql: 'CREATE TABLE IF NOT EXISTS tricky (id INTEGER PRIMARY KEY);',
      },
    ];

    await migrate(db, trickyMigrations);
    expect(db.tables.has('tricky')).toBe(true);
    expect(db.userVersion).toBe(1);
  });
});

describe('getMigrations()', () => {
  it('returns an array for defined schema types', async () => {
    const { getMigrations } = await import('@/services/database/migrations');
    const result = getMigrations('nonexistent_schema');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
