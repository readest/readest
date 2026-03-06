import { it, expect } from 'vitest';
import { DatabaseService } from '@/types/database';
import { migrate, MigrationEntry } from '@/services/database/migrate';

/**
 * Shared migration tests exercised against any real DatabaseService.
 * Verifies the migration runner works correctly with actual SQLite
 * across all three turso backends (native, node, wasm).
 *
 * Call inside a describe() block:
 *   describe('Migrations', () => { migrationTests(() => db); });
 */
export function migrationTests(getDb: () => DatabaseService) {
  const migrationV1: MigrationEntry[] = [
    {
      name: '2026030601_create_books',
      sql: `
        CREATE TABLE books (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          author TEXT
        );
      `,
    },
  ];

  const migrationV2: MigrationEntry[] = [
    ...migrationV1,
    {
      name: '2026030602_create_annotations',
      sql: `
        CREATE TABLE annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL REFERENCES books(id),
          cfi TEXT NOT NULL,
          text TEXT
        );
      `,
    },
  ];

  const migrationV3: MigrationEntry[] = [
    ...migrationV2,
    {
      name: '2026031501_add_bookmarks',
      sql: `
        CREATE TABLE bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL REFERENCES books(id),
          cfi TEXT NOT NULL,
          label TEXT
        );
        CREATE INDEX idx_bookmarks_book ON bookmarks(book_id);
      `,
    },
  ];

  // ---------------------------------------------------------------------------
  // Basic migration
  // ---------------------------------------------------------------------------

  it('applies migrations and creates tables', async () => {
    const db = getDb();
    await migrate(db, migrationV1);

    // Table should exist and be usable
    const result = await db.execute('INSERT INTO books (title, author) VALUES (?, ?)', [
      'Test Book',
      'Author',
    ]);
    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBe(1);

    const rows = await db.select<{ id: number; title: string; author: string }>(
      'SELECT * FROM books',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Test Book');
  });

  it('creates the __migrations tracking table', async () => {
    const db = getDb();
    await migrate(db, migrationV1);

    const tracked = await db.select<{ id: number; name: string; applied_at: string }>(
      'SELECT * FROM __migrations ORDER BY id',
    );
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.name).toBe('2026030601_create_books');
    expect(tracked[0]!.applied_at).toBeTruthy();
  });

  it('sets PRAGMA user_version to migration count', async () => {
    const db = getDb();
    await migrate(db, migrationV2);

    const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(rows[0]!.user_version).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  it('is idempotent — running twice has no effect', async () => {
    const db = getDb();
    await migrate(db, migrationV2);

    // Insert data
    await db.execute('INSERT INTO books (title) VALUES (?)', ['Book 1']);

    // Run again — should not duplicate tables or data
    await migrate(db, migrationV2);

    const books = await db.select<{ title: string }>('SELECT * FROM books');
    expect(books).toHaveLength(1);

    const tracked = await db.select('SELECT * FROM __migrations');
    expect(tracked).toHaveLength(2);

    const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(rows[0]!.user_version).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Incremental migration
  // ---------------------------------------------------------------------------

  it('applies only new migrations incrementally', async () => {
    const db = getDb();

    // First: apply V1
    await migrate(db, migrationV1);
    let version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(1);

    // Second: apply V2 (adds annotations)
    await migrate(db, migrationV2);
    version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(2);

    // Verify annotations table works
    await db.execute('INSERT INTO books (title) VALUES (?)', ['B1']);
    await db.execute('INSERT INTO annotations (book_id, cfi, text) VALUES (?, ?, ?)', [
      1,
      '/2/4',
      'A note',
    ]);
    const annotations = await db.select<{ text: string }>('SELECT text FROM annotations');
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.text).toBe('A note');

    // Third: apply V3 (adds bookmarks + index)
    await migrate(db, migrationV3);
    version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(3);

    // Verify bookmarks table works
    await db.execute('INSERT INTO bookmarks (book_id, cfi, label) VALUES (?, ?, ?)', [
      1,
      '/2/8',
      'Chapter 3',
    ]);
    const bookmarks = await db.select<{ label: string }>('SELECT label FROM bookmarks');
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]!.label).toBe('Chapter 3');
  });

  // ---------------------------------------------------------------------------
  // Multi-statement migration
  // ---------------------------------------------------------------------------

  it('handles migrations with multiple SQL statements', async () => {
    const db = getDb();
    await migrate(db, migrationV3);

    // V3 migration creates both a table and an index
    // Verify the index exists via sqlite_master
    const indexes = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bookmarks_book'",
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.name).toBe('idx_bookmarks_book');
  });

  // ---------------------------------------------------------------------------
  // Empty migrations
  // ---------------------------------------------------------------------------

  it('does nothing for empty migration list', async () => {
    const db = getDb();
    await migrate(db, []);

    // No tracking table should be created
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__migrations'",
    );
    expect(tables).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Custom tracking table
  // ---------------------------------------------------------------------------

  it('supports custom tracking table name', async () => {
    const db = getDb();
    await migrate(db, migrationV1, { table: '__schema_history' });

    const tracked = await db.select<{ name: string }>('SELECT name FROM __schema_history');
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.name).toBe('2026030601_create_books');

    // Default table should not exist
    const defaultTable = await db.select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__migrations'",
    );
    expect(defaultTable).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Fast-path verification
  // ---------------------------------------------------------------------------

  it('fast-path skips when user_version is current', async () => {
    const db = getDb();
    await migrate(db, migrationV2);

    // Manually verify user_version is set
    const before = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(before[0]!.user_version).toBe(2);

    // Running same migrations again should hit the fast-path
    // and not touch the tracking table
    await migrate(db, migrationV2);

    const after = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(after[0]!.user_version).toBe(2);

    const tracked = await db.select('SELECT * FROM __migrations');
    expect(tracked).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Data survives migration
  // ---------------------------------------------------------------------------

  it('existing data survives new migrations', async () => {
    const db = getDb();

    // Apply V1 and insert data
    await migrate(db, migrationV1);
    await db.execute('INSERT INTO books (title, author) VALUES (?, ?)', ['Book A', 'Author A']);
    await db.execute('INSERT INTO books (title, author) VALUES (?, ?)', ['Book B', 'Author B']);

    // Apply V2 — books data should survive
    await migrate(db, migrationV2);

    const books = await db.select<{ title: string; author: string }>(
      'SELECT title, author FROM books ORDER BY id',
    );
    expect(books).toHaveLength(2);
    expect(books[0]!.title).toBe('Book A');
    expect(books[1]!.title).toBe('Book B');
  });
}
