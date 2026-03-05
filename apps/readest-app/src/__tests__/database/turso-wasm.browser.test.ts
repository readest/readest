import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebDatabaseService } from '@/services/database/webDatabaseService';
import { DatabaseService, DatabaseExecResult } from '@/types/database';
import { ftsTests } from './suites/fts-tests';
import { vectorTests } from './suites/vector-tests';

/**
 * Browser-based integration tests for WebDatabaseService using @tursodatabase/database-wasm.
 * These run in real headless Chromium via @vitest/browser + Playwright, providing
 * Web Workers, SharedArrayBuffer, and OPFS support required by the WASM module.
 */
describe('WebDatabaseService (browser WASM, in-memory SQLite)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await WebDatabaseService.open(':memory:', { experimental: ['index_method'] });
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Schema & basic operations
  // -------------------------------------------------------------------------

  it('creates a table and inserts a row', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const result: DatabaseExecResult = await db.execute('INSERT INTO items (name) VALUES (?)', [
      'apple',
    ]);
    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBe(1);
  });

  it('inserts multiple rows with auto-incrementing ids', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const r1 = await db.execute('INSERT INTO items (name) VALUES (?)', ['a']);
    const r2 = await db.execute('INSERT INTO items (name) VALUES (?)', ['b']);
    const r3 = await db.execute('INSERT INTO items (name) VALUES (?)', ['c']);
    expect(r1.lastInsertId).toBe(1);
    expect(r2.lastInsertId).toBe(2);
    expect(r3.lastInsertId).toBe(3);
  });

  // -------------------------------------------------------------------------
  // SELECT queries
  // -------------------------------------------------------------------------

  it('select() returns typed rows', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)');
    await db.execute('INSERT INTO items (name, qty) VALUES (?, ?)', ['apple', 10]);
    await db.execute('INSERT INTO items (name, qty) VALUES (?, ?)', ['banana', 20]);

    const rows = await db.select<{ id: number; name: string; qty: number }>(
      'SELECT * FROM items ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe('apple');
    expect(rows[0]!.qty).toBe(10);
    expect(rows[1]!.name).toBe('banana');
    expect(rows[1]!.qty).toBe(20);
  });

  it('select() with WHERE and params', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO items (name) VALUES (?)', ['apple']);
    await db.execute('INSERT INTO items (name) VALUES (?)', ['banana']);
    await db.execute('INSERT INTO items (name) VALUES (?)', ['cherry']);

    const rows = await db.select<{ id: number; name: string }>(
      'SELECT * FROM items WHERE name = ?',
      ['banana'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('banana');
  });

  it('select() returns empty array for no matching rows', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const rows = await db.select('SELECT * FROM items');
    expect(rows).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // UPDATE & DELETE
  // -------------------------------------------------------------------------

  it('execute() UPDATE returns rowsAffected', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO items (name) VALUES (?)', ['old']);
    await db.execute('INSERT INTO items (name) VALUES (?)', ['old']);

    const result = await db.execute('UPDATE items SET name = ? WHERE name = ?', ['new', 'old']);
    expect(result.rowsAffected).toBe(2);
  });

  it('execute() DELETE returns rowsAffected', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO items (name) VALUES (?)', ['a']);
    await db.execute('INSERT INTO items (name) VALUES (?)', ['b']);
    await db.execute('INSERT INTO items (name) VALUES (?)', ['c']);

    const result = await db.execute('DELETE FROM items WHERE name IN (?, ?)', ['a', 'c']);
    expect(result.rowsAffected).toBe(2);

    const remaining = await db.select<{ name: string }>('SELECT name FROM items');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('b');
  });

  // -------------------------------------------------------------------------
  // Batch execution
  // -------------------------------------------------------------------------

  it('batch() executes multiple statements atomically', async () => {
    await db.batch([
      'CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)',
      "INSERT INTO t1 (val) VALUES ('one')",
      "INSERT INTO t1 (val) VALUES ('two')",
      "INSERT INTO t1 (val) VALUES ('three')",
    ]);

    const rows = await db.select<{ val: string }>('SELECT val FROM t1 ORDER BY id');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.val)).toEqual(['one', 'two', 'three']);
  });

  // -------------------------------------------------------------------------
  // Data types
  // -------------------------------------------------------------------------

  it('handles NULL values correctly', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
    await db.execute('INSERT INTO t (val) VALUES (?)', [null]);

    const rows = await db.select<{ id: number; val: string | null }>('SELECT * FROM t');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.val).toBeNull();
  });

  it('handles integer and real types', async () => {
    await db.execute('CREATE TABLE nums (i INTEGER, r REAL)');
    await db.execute('INSERT INTO nums (i, r) VALUES (?, ?)', [42, 3.14]);

    const rows = await db.select<{ i: number; r: number }>('SELECT * FROM nums');
    expect(rows[0]!.i).toBe(42);
    expect(rows[0]!.r).toBeCloseTo(3.14);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('throws on invalid SQL', async () => {
    await expect(db.execute('INVALID SQL STATEMENT')).rejects.toThrow();
  });

  it('throws on constraint violation', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT UNIQUE)');
    await db.execute('INSERT INTO t (val) VALUES (?)', ['unique_val']);
    await expect(db.execute('INSERT INTO t (val) VALUES (?)', ['unique_val'])).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // DatabaseExecResult contract
  // -------------------------------------------------------------------------

  it('execute() result always has rowsAffected and lastInsertId as numbers', async () => {
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    const result = await db.execute('INSERT INTO t DEFAULT VALUES');
    expect(typeof result.rowsAffected).toBe('number');
    expect(typeof result.lastInsertId).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Full-text search (Turso native FTS, Tantivy-based)
  // -------------------------------------------------------------------------

  describe('Full-Text Search', () => {
    ftsTests(() => db);
  });

  // -------------------------------------------------------------------------
  // Vector search
  // -------------------------------------------------------------------------

  describe('Vector Search', () => {
    vectorTests(() => db);
  });
});
