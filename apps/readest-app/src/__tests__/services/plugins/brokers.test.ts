import { describe, expect, test, vi } from 'vitest';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import type { DatabaseExecResult, DatabaseRow, DatabaseService } from '@/types/database';

const pluginContext = { pluginId: 'readest.yomitan', dictionaryId: 'dict-1' };

const createDatabase = (options?: { failOn?: string; rows?: Record<string, unknown>[] }) => {
  const execute = vi.fn(async (sql: string): Promise<DatabaseExecResult> => {
    if (options?.failOn && sql.includes(options.failOn)) throw new Error('database failure');
    return { rowsAffected: 1, lastInsertId: 0 };
  });
  const selectMock = vi.fn(async (_sql: string, _params?: unknown[]) => options?.rows ?? []);
  const select: DatabaseService['select'] = async <T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> => (await selectMock(sql, params)) as T[];
  const db: DatabaseService = {
    execute,
    select,
    batch: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { db, execute, select: selectMock };
};

describe('SourceBroker', () => {
  test('returns only scoped metadata and bounded byte ranges', async () => {
    const broker = new SourceBroker({ createHandle: () => 'source-1' });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'dict.zip', {
      type: 'application/zip',
      lastModified: 123,
    });
    const handle = broker.register(pluginContext, file);

    await expect(broker.stat(pluginContext, { handle })).resolves.toEqual({
      name: 'dict.zip',
      size: 4,
      type: 'application/zip',
      lastModified: 123,
    });
    const result = await broker.readRange(pluginContext, { handle, offset: 1, length: 2 });
    expect([...result.bytes]).toEqual([2, 3]);
  });

  test('rejects cross-plugin access, out-of-bounds reads, and oversized reads', async () => {
    const broker = new SourceBroker({ maxReadBytes: 2, createHandle: () => 'source-1' });
    const handle = broker.register(pluginContext, new File(['abcd'], 'dict.zip'));

    await expect(
      broker.stat({ ...pluginContext, pluginId: 'other.plugin' }, { handle }),
    ).rejects.toThrow(/scope/i);
    await expect(broker.readRange(pluginContext, { handle, offset: 3, length: 2 })).rejects.toThrow(
      /bounds/i,
    );
    await expect(broker.readRange(pluginContext, { handle, offset: 0, length: 3 })).rejects.toThrow(
      /limit/i,
    );
  });
});

describe('SqlBroker', () => {
  test('makes active handles query-only and caps returned rows', async () => {
    const { db, execute, select } = createDatabase({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    const broker = new SqlBroker({ createHandle: () => 'db-1', maxRows: 2 });
    const handle = await broker.register(pluginContext, db, 'active');

    expect(execute).toHaveBeenCalledWith('PRAGMA query_only = 1');
    await expect(
      broker.execute(pluginContext, { handle, sql: 'DELETE FROM terms', params: [] }),
    ).rejects.toThrow(/read-only/i);
    await expect(
      broker.select(pluginContext, {
        handle,
        sql: 'SELECT id FROM terms',
        params: [],
        maxRows: 2,
      }),
    ).rejects.toThrow(/row limit/i);
    expect(select).toHaveBeenCalledWith(
      'SELECT * FROM (SELECT id FROM terms) AS plugin_query LIMIT ?',
      [3],
    );
  });

  test('permits scoped staging DDL/DML and rejects escape-oriented SQL', async () => {
    const { db } = createDatabase();
    const broker = new SqlBroker({ createHandle: () => 'db-1' });
    const handle = await broker.register(pluginContext, db, 'staging');

    await expect(
      broker.execute(pluginContext, {
        handle,
        sql: 'CREATE TABLE terms (id INTEGER PRIMARY KEY, value TEXT)',
        params: [],
      }),
    ).resolves.toMatchObject({ rowsAffected: 1 });
    await expect(
      broker.execute(pluginContext, {
        handle,
        sql: 'INSERT INTO terms(value) VALUES (?)',
        params: ['safe'],
      }),
    ).resolves.toMatchObject({ rowsAffected: 1 });

    for (const sql of [
      "ATTACH DATABASE '/tmp/out.db' AS escaped",
      'DETACH DATABASE escaped',
      "SELECT load_extension('evil')",
      'PRAGMA writable_schema = ON',
      'SELECT 1; DROP TABLE terms',
    ]) {
      await expect(broker.execute(pluginContext, { handle, sql, params: [] })).rejects.toThrow(
        /not allowed/i,
      );
    }
  });

  test('rolls back a failed staging transaction', async () => {
    const { db, execute } = createDatabase({ failOn: 'INSERT INTO broken' });
    const broker = new SqlBroker({ createHandle: () => 'db-1' });
    const handle = await broker.register(pluginContext, db, 'staging');

    await expect(
      broker.transaction(pluginContext, {
        handle,
        statements: [
          { sql: 'INSERT INTO terms(value) VALUES (?)', params: ['ok'] },
          { sql: 'INSERT INTO broken(value) VALUES (?)', params: ['fail'] },
        ],
      }),
    ).rejects.toThrow('database failure');

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT INTO terms(value) VALUES (?)',
      'INSERT INTO broken(value) VALUES (?)',
      'ROLLBACK',
    ]);
  });

  test('rejects database handles outside their plugin and dictionary scope', async () => {
    const { db } = createDatabase();
    const broker = new SqlBroker({ createHandle: () => 'db-1' });
    const handle = await broker.register(pluginContext, db, 'staging');

    await expect(
      broker.select(
        { ...pluginContext, dictionaryId: 'dict-2' },
        { handle, sql: 'SELECT 1', params: [], maxRows: 1 },
      ),
    ).rejects.toThrow(/scope/i);
  });
});
