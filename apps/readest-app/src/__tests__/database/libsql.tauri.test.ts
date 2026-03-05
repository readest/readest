import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { invoke } from '../tauri/tauri-invoke';

/**
 * Integration tests for tauri-plugin-libsql running inside the Tauri WebView.
 * These call plugin IPC commands directly via __TAURI_INTERNALS__.invoke().
 */
describe('libsql plugin (native Tauri)', () => {
  const DB_PATH = 'sqlite::memory:';
  let dbPath: string;

  beforeEach(async () => {
    dbPath = (await invoke('plugin:libsql|load', {
      options: { path: DB_PATH },
    })) as string;
  });

  afterEach(async () => {
    await invoke('plugin:libsql|close', { db: dbPath });
  });

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  it('loads an in-memory database and returns a path', () => {
    expect(typeof dbPath).toBe('string');
    expect(dbPath.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Schema & basic operations
  // ---------------------------------------------------------------------------

  it('creates a table and inserts a row', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });

    const result = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['apple'],
    })) as { rowsAffected: number; lastInsertId: number };

    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBe(1);
  });

  it('inserts multiple rows with auto-incrementing ids', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });

    const r1 = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['a'],
    })) as { lastInsertId: number };

    const r2 = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['b'],
    })) as { lastInsertId: number };

    const r3 = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['c'],
    })) as { lastInsertId: number };

    expect(r1.lastInsertId).toBe(1);
    expect(r2.lastInsertId).toBe(2);
    expect(r3.lastInsertId).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // SELECT queries
  // ---------------------------------------------------------------------------

  it('select returns typed rows', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name, qty) VALUES (?, ?)',
      values: ['apple', 10],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name, qty) VALUES (?, ?)',
      values: ['banana', 20],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT * FROM items ORDER BY id',
      values: [],
    })) as Array<{ id: number; name: string; qty: number }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe('apple');
    expect(rows[0]!.qty).toBe(10);
    expect(rows[1]!.name).toBe('banana');
    expect(rows[1]!.qty).toBe(20);
  });

  it('select with WHERE and params', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['apple'],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['banana'],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT * FROM items WHERE name = ?',
      values: ['banana'],
    })) as Array<{ id: number; name: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('banana');
  });

  it('select returns empty array for no matching rows', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT * FROM items',
      values: [],
    })) as unknown[];

    expect(rows).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // UPDATE & DELETE
  // ---------------------------------------------------------------------------

  it('UPDATE returns rowsAffected', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['old'],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['old'],
    });

    const result = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'UPDATE items SET name = ? WHERE name = ?',
      values: ['new', 'old'],
    })) as { rowsAffected: number };

    expect(result.rowsAffected).toBe(2);
  });

  it('DELETE returns rowsAffected', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['a'],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['b'],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO items (name) VALUES (?)',
      values: ['c'],
    });

    const result = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'DELETE FROM items WHERE name IN (?, ?)',
      values: ['a', 'c'],
    })) as { rowsAffected: number };

    expect(result.rowsAffected).toBe(2);

    const remaining = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT name FROM items',
      values: [],
    })) as Array<{ name: string }>;

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('b');
  });

  // ---------------------------------------------------------------------------
  // Batch execution
  // ---------------------------------------------------------------------------

  it('batch executes multiple statements atomically', async () => {
    await invoke('plugin:libsql|batch', {
      db: dbPath,
      queries: [
        'CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)',
        "INSERT INTO t1 (val) VALUES ('one')",
        "INSERT INTO t1 (val) VALUES ('two')",
        "INSERT INTO t1 (val) VALUES ('three')",
      ],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT val FROM t1 ORDER BY id',
      values: [],
    })) as Array<{ val: string }>;

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.val)).toEqual(['one', 'two', 'three']);
  });

  // ---------------------------------------------------------------------------
  // Data types
  // ---------------------------------------------------------------------------

  it('handles NULL values correctly', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO t (val) VALUES (?)',
      values: [null],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT * FROM t',
      values: [],
    })) as Array<{ id: number; val: string | null }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.val).toBeNull();
  });

  it('handles integer and real types', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE nums (i INTEGER, r REAL)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO nums (i, r) VALUES (?, ?)',
      values: [42, 3.14],
    });

    const rows = (await invoke('plugin:libsql|select', {
      db: dbPath,
      query: 'SELECT * FROM nums',
      values: [],
    })) as Array<{ i: number; r: number }>;

    expect(rows[0]!.i).toBe(42);
    expect(rows[0]!.r).toBeCloseTo(3.14);
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('throws on invalid SQL', async () => {
    await expect(
      invoke('plugin:libsql|execute', {
        db: dbPath,
        query: 'INVALID SQL STATEMENT',
        values: [],
      }),
    ).rejects.toThrow();
  });

  it('throws on constraint violation', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT UNIQUE)',
      values: [],
    });
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO t (val) VALUES (?)',
      values: ['unique_val'],
    });

    await expect(
      invoke('plugin:libsql|execute', {
        db: dbPath,
        query: 'INSERT INTO t (val) VALUES (?)',
        values: ['unique_val'],
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Result contract
  // ---------------------------------------------------------------------------

  it('execute result always has rowsAffected and lastInsertId as numbers', async () => {
    await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'CREATE TABLE t (id INTEGER PRIMARY KEY)',
      values: [],
    });

    const result = (await invoke('plugin:libsql|execute', {
      db: dbPath,
      query: 'INSERT INTO t DEFAULT VALUES',
      values: [],
    })) as { rowsAffected: number; lastInsertId: number };

    expect(typeof result.rowsAffected).toBe('number');
    expect(typeof result.lastInsertId).toBe('number');
  });

  // ---------------------------------------------------------------------------
  // Plugin config
  // ---------------------------------------------------------------------------

  it('get_config returns encryption status', async () => {
    const config = (await invoke('plugin:libsql|get_config')) as { encrypted: boolean };
    expect(typeof config.encrypted).toBe('boolean');
  });
});
