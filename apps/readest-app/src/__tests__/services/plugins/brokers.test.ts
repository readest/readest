import { describe, expect, test, vi } from 'vitest';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import { MAX_PLUGIN_RESOURCE_BYTES } from '@/services/plugins/contract';
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

  test('caps individual cells and aggregate bytes returned by SQL', async () => {
    const defaultLimit = createDatabase({
      rows: [{ data: new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES + 1) }],
    });
    const defaultBroker = new SqlBroker({ createHandle: () => 'db-default' });
    const defaultHandle = await defaultBroker.register(pluginContext, defaultLimit.db, 'active');

    await expect(
      defaultBroker.select(pluginContext, {
        handle: defaultHandle,
        sql: 'SELECT data FROM resources',
        maxRows: 1,
      }),
    ).rejects.toMatchObject({ code: 'SQL_RESULT_LIMIT' });

    const oversizedCell = createDatabase({ rows: [{ data: new Uint8Array(5) }] });
    const cellBroker = new SqlBroker({
      createHandle: () => 'db-cell',
      maxResultBytes: 8,
      maxResultCellBytes: 4,
    });
    const cellHandle = await cellBroker.register(pluginContext, oversizedCell.db, 'active');

    await expect(
      cellBroker.select(pluginContext, {
        handle: cellHandle,
        sql: 'SELECT data FROM resources',
        maxRows: 1,
      }),
    ).rejects.toMatchObject({ code: 'SQL_RESULT_LIMIT' });

    const oversizedResult = createDatabase({
      rows: [{ first: new Uint8Array(4), second: new Uint8Array(4) }],
    });
    const resultBroker = new SqlBroker({
      createHandle: () => 'db-result',
      maxResultBytes: 15,
      maxResultCellBytes: 4,
    });
    const resultHandle = await resultBroker.register(pluginContext, oversizedResult.db, 'active');

    await expect(
      resultBroker.select(pluginContext, {
        handle: resultHandle,
        sql: 'SELECT first, second FROM resources',
        maxRows: 1,
      }),
    ).rejects.toMatchObject({ code: 'SQL_RESULT_LIMIT' });

    const nativeBlob = createDatabase({ rows: [{ data: [1, 2, 3, 4] }] });
    const nativeBroker = new SqlBroker({
      createHandle: () => 'db-native',
      maxResultBytes: 8,
      maxResultCellBytes: 4,
    });
    const nativeHandle = await nativeBroker.register(pluginContext, nativeBlob.db, 'active');

    await expect(
      nativeBroker.select(pluginContext, {
        handle: nativeHandle,
        sql: 'SELECT data FROM resources',
        maxRows: 1,
      }),
    ).resolves.toEqual({ rows: [{ data: new Uint8Array([1, 2, 3, 4]) }] });
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

  test('permits bounded bulk inserts and rejects larger parameter lists', async () => {
    const { db } = createDatabase();
    const broker = new SqlBroker({ createHandle: () => 'db-1' });
    const handle = await broker.register(pluginContext, db, 'staging');
    const request = {
      handle,
      sql: 'INSERT INTO terms(value) VALUES (?)',
      params: Array(9_000).fill('value'),
    };

    await expect(broker.execute(pluginContext, request)).resolves.toMatchObject({
      rowsAffected: 1,
    });
    await expect(
      broker.execute(pluginContext, { ...request, params: [...request.params, 'too-many'] }),
    ).rejects.toThrow(/parameter limit/i);
  });

  test('caps SQL parameter cells, calls, and complete transactions by bytes', async () => {
    const { db } = createDatabase();
    const broker = new SqlBroker({
      createHandle: () => 'db-1',
      maxParamCellBytes: 4,
      maxParamBytes: 8,
    });
    const handle = await broker.register(pluginContext, db, 'staging');

    await expect(
      broker.execute(pluginContext, {
        handle,
        sql: 'INSERT INTO resources(data) VALUES (?)',
        params: [new Uint8Array(5)],
      }),
    ).rejects.toMatchObject({ code: 'SQL_PARAMETER_SIZE_LIMIT' });
    await expect(
      broker.execute(pluginContext, {
        handle,
        sql: 'INSERT INTO resources(data) VALUES (?), (?)',
        params: [new Uint8Array(4), new Uint8Array(5)],
      }),
    ).rejects.toMatchObject({ code: 'SQL_PARAMETER_SIZE_LIMIT' });
    await expect(
      broker.transaction(pluginContext, {
        handle,
        statements: [
          { sql: 'INSERT INTO resources(data) VALUES (?)', params: [new Uint8Array(4)] },
          { sql: 'INSERT INTO resources(data) VALUES (?)', params: [new Uint8Array(5)] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SQL_PARAMETER_SIZE_LIMIT' });
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
