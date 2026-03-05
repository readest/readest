import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseService, DatabaseExecResult, DatabaseRow } from '@/types/database';

// ---------------------------------------------------------------------------
// Mock: NativeDatabaseService
// ---------------------------------------------------------------------------

vi.mock('tauri-plugin-turso', () => {
  const rows = new Map<string, DatabaseRow[]>();

  const mockDb = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const insertTable = sql.match(/INTO\s+(\w+)/i)?.[1];
      const fromTable = sql.match(/FROM\s+(\w+)/i)?.[1];
      const table = insertTable ?? fromTable ?? '_default';
      if (/^INSERT/i.test(sql.trim())) {
        const existing = rows.get(table) ?? [];
        const id = existing.length + 1;
        existing.push({ id, value: params[0] ?? null });
        rows.set(table, existing);
        return { rowsAffected: 1, lastInsertId: id };
      }
      if (/^DELETE/i.test(sql.trim())) {
        const existing = rows.get(table) ?? [];
        rows.set(table, []);
        return { rowsAffected: existing.length, lastInsertId: 0 };
      }
      return { rowsAffected: 0, lastInsertId: 0 };
    }),
    select: vi.fn(async (sql: string) => {
      const table = sql.match(/FROM\s+(\w+)/i)?.[1] ?? '_default';
      return rows.get(table) ?? [];
    }),
    batch: vi.fn(async () => {}),
    close: vi.fn(async () => {
      rows.clear();
      return true;
    }),
  };

  return {
    Database: {
      load: vi.fn(async () => mockDb),
    },
    __mockDb: mockDb,
    __rows: rows,
  };
});

// ---------------------------------------------------------------------------
// Mock: @tursodatabase/database-wasm
// ---------------------------------------------------------------------------

vi.mock('@tursodatabase/database-wasm', () => {
  const rows = new Map<string, DatabaseRow[]>();

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...params: unknown[]) => {
        const table = sql.match(/INTO\s+(\w+)/i)?.[1] ?? '_default';
        if (/^INSERT/i.test(sql.trim())) {
          const existing = rows.get(table) ?? [];
          const id = existing.length + 1;
          existing.push({ id, value: params[0] ?? null });
          rows.set(table, existing);
          return { changes: 1, lastInsertRowid: id };
        }
        if (/^DELETE/i.test(sql.trim())) {
          const existing = rows.get(table) ?? [];
          rows.set(table, []);
          return { changes: existing.length, lastInsertRowid: 0 };
        }
        return { changes: 0, lastInsertRowid: 0 };
      }),
      all: vi.fn(() => {
        const table = sql.match(/FROM\s+(\w+)/i)?.[1] ?? '_default';
        return rows.get(table) ?? [];
      }),
    })),
    exec: vi.fn(),
    close: vi.fn(() => {
      rows.clear();
    }),
  };

  return {
    connect: vi.fn(() => mockDb),
    __mockDb: mockDb,
    __rows: rows,
  };
});

// ---------------------------------------------------------------------------
// Tests: NativeDatabaseService
// ---------------------------------------------------------------------------

describe('NativeDatabaseService', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('tauri-plugin-turso');
    (mod as unknown as { __rows: Map<string, DatabaseRow[]> }).__rows.clear();

    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    db = await NativeDatabaseService.open('sqlite:test.db');
  });

  it('execute() returns DatabaseExecResult for INSERT', async () => {
    const result: DatabaseExecResult = await db.execute('INSERT INTO items (value) VALUES (?)', [
      'hello',
    ]);
    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBeGreaterThan(0);
  });

  it('execute() returns DatabaseExecResult for DELETE', async () => {
    await db.execute('INSERT INTO items (value) VALUES (?)', ['a']);
    const result = await db.execute('DELETE FROM items');
    expect(result.rowsAffected).toBe(1);
  });

  it('select() returns typed row arrays', async () => {
    await db.execute('INSERT INTO items (value) VALUES (?)', ['alpha']);
    await db.execute('INSERT INTO items (value) VALUES (?)', ['beta']);

    const rows = await db.select<{ id: number; value: string }>('SELECT * FROM items');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(1);
    expect(rows[0]!.value).toBe('alpha');
    expect(rows[1]!.id).toBe(2);
    expect(rows[1]!.value).toBe('beta');
  });

  it('select() returns empty array when no rows', async () => {
    const rows = await db.select('SELECT * FROM empty_table');
    expect(rows).toEqual([]);
  });

  it('batch() delegates to underlying db.batch()', async () => {
    await db.batch(['CREATE TABLE t (id INTEGER)', 'INSERT INTO t VALUES (1)']);
    const mod = await import('tauri-plugin-turso');
    const mockDb = (mod as unknown as { __mockDb: { batch: ReturnType<typeof vi.fn> } }).__mockDb;
    expect(mockDb.batch).toHaveBeenCalledWith([
      'CREATE TABLE t (id INTEGER)',
      'INSERT INTO t VALUES (1)',
    ]);
  });

  it('close() delegates to underlying db.close()', async () => {
    await db.close();
    const mod = await import('tauri-plugin-turso');
    const mockDb = (mod as unknown as { __mockDb: { close: ReturnType<typeof vi.fn> } }).__mockDb;
    expect(mockDb.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: WebDatabaseService
// ---------------------------------------------------------------------------

describe('WebDatabaseService', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@tursodatabase/database-wasm');
    (mod as unknown as { __rows: Map<string, DatabaseRow[]> }).__rows.clear();

    const { WebDatabaseService } = await import('@/services/database/webDatabaseService');
    db = await WebDatabaseService.open('test.db');
  });

  it('execute() maps changes/lastInsertRowid to DatabaseExecResult', async () => {
    const result: DatabaseExecResult = await db.execute('INSERT INTO items (value) VALUES (?)', [
      'hello',
    ]);
    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBeGreaterThan(0);
  });

  it('select() returns row objects from prepare().all()', async () => {
    await db.execute('INSERT INTO items (value) VALUES (?)', ['alpha']);
    await db.execute('INSERT INTO items (value) VALUES (?)', ['beta']);

    const rows = await db.select<{ id: number; value: string }>('SELECT * FROM items');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(1);
    expect(rows[0]!.value).toBe('alpha');
  });

  it('select() returns empty array when no rows', async () => {
    const rows = await db.select('SELECT * FROM empty_table');
    expect(rows).toEqual([]);
  });

  it('batch() wraps in BEGIN/COMMIT transaction', async () => {
    await db.batch(['CREATE TABLE t (id INTEGER)', 'INSERT INTO t VALUES (1)']);
    const mod = await import('@tursodatabase/database-wasm');
    const mockDb = (mod as unknown as { __mockDb: { exec: ReturnType<typeof vi.fn> } }).__mockDb;
    expect(mockDb.exec).toHaveBeenCalledWith('BEGIN');
    expect(mockDb.exec).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)');
    expect(mockDb.exec).toHaveBeenCalledWith('INSERT INTO t VALUES (1)');
    expect(mockDb.exec).toHaveBeenCalledWith('COMMIT');
  });

  it('batch() rolls back on error', async () => {
    const mod = await import('@tursodatabase/database-wasm');
    const mockDb = (mod as unknown as { __mockDb: { exec: ReturnType<typeof vi.fn> } }).__mockDb;
    let callCount = 0;
    mockDb.exec.mockImplementation((_sql: string) => {
      callCount++;
      // Fail on the second exec (first real statement after BEGIN)
      if (callCount === 2) throw new Error('SQL error');
    });

    await expect(db.batch(['BAD SQL', 'GOOD SQL'])).rejects.toThrow('SQL error');
    expect(mockDb.exec).toHaveBeenCalledWith('ROLLBACK');
  });

  it('close() delegates to underlying db.close()', async () => {
    await db.close();
    const mod = await import('@tursodatabase/database-wasm');
    const mockDb = (mod as unknown as { __mockDb: { close: ReturnType<typeof vi.fn> } }).__mockDb;
    expect(mockDb.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: DatabaseExecResult shape
// ---------------------------------------------------------------------------

describe('DatabaseExecResult type contract', () => {
  it('has rowsAffected and lastInsertId properties', () => {
    const result: DatabaseExecResult = {
      rowsAffected: 5,
      lastInsertId: 42,
    };
    expect(result.rowsAffected).toBe(5);
    expect(result.lastInsertId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Tests: Unified API consistency
// ---------------------------------------------------------------------------

describe('API consistency between Native and Web implementations', () => {
  it('both implementations satisfy the DatabaseService interface', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    const nativeDb: DatabaseService = await NativeDatabaseService.open('sqlite:test.db');
    expect(nativeDb.execute).toBeDefined();
    expect(nativeDb.select).toBeDefined();
    expect(nativeDb.batch).toBeDefined();
    expect(nativeDb.close).toBeDefined();

    const { WebDatabaseService } = await import('@/services/database/webDatabaseService');
    const webDb: DatabaseService = await WebDatabaseService.open('test.db');
    expect(webDb.execute).toBeDefined();
    expect(webDb.select).toBeDefined();
    expect(webDb.batch).toBeDefined();
    expect(webDb.close).toBeDefined();
  });

  it('both return same shape from execute()', async () => {
    const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
    const nativeDb = await NativeDatabaseService.open('sqlite:test.db');
    const nativeResult = await nativeDb.execute('INSERT INTO t (value) VALUES (?)', ['x']);

    const { WebDatabaseService } = await import('@/services/database/webDatabaseService');
    const webDb = await WebDatabaseService.open('test.db');
    const webResult = await webDb.execute('INSERT INTO t (value) VALUES (?)', ['x']);

    expect(Object.keys(nativeResult).sort()).toEqual(['lastInsertId', 'rowsAffected']);
    expect(Object.keys(webResult).sort()).toEqual(['lastInsertId', 'rowsAffected']);
    expect(typeof nativeResult.rowsAffected).toBe('number');
    expect(typeof webResult.rowsAffected).toBe('number');
    expect(typeof nativeResult.lastInsertId).toBe('number');
    expect(typeof webResult.lastInsertId).toBe('number');
  });
});
