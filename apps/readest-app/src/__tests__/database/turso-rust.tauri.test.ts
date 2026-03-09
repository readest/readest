import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { invoke } from '../tauri/tauri-invoke';
import { DatabaseService, DatabaseExecResult, DatabaseRow } from '@/types/database';
import { baseTests } from './suites/base-tests';
import { ftsTests } from './suites/fts-tests';
import { vectorTests } from './suites/vector-tests';
import { migrationTests } from './suites/migration-tests';

/**
 * Thin DatabaseService adapter over raw Tauri IPC invoke() calls.
 * Enables reuse of the shared test suites.
 */
class TauriDatabaseAdapter implements DatabaseService {
  constructor(private dbPath: string) {}

  async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecResult> {
    const result = (await invoke('plugin:turso|execute', {
      db: this.dbPath,
      query: sql,
      values: params,
    })) as { rowsAffected: number; lastInsertId: number };
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    };
  }

  async select<T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await invoke('plugin:turso|select', {
      db: this.dbPath,
      query: sql,
      values: params,
    })) as T[];
  }

  async batch(statements: string[]): Promise<void> {
    await invoke('plugin:turso|batch', {
      db: this.dbPath,
      queries: statements,
    });
  }

  async close(): Promise<void> {
    await invoke('plugin:turso|close', { db: this.dbPath });
  }
}

/**
 * Integration tests for the turso-backed tauri-plugin-turso running inside
 * the Tauri WebView. Calls plugin IPC commands via __TAURI_INTERNALS__.invoke().
 *
 * The database is opened with experimental index_method enabled so that
 * FTS (Tantivy-based) CREATE INDEX ... USING fts works.
 */
describe('turso plugin (native Tauri)', () => {
  const DB_PATH = 'sqlite::memory:';
  let dbPath: string;
  let db: DatabaseService;

  beforeEach(async () => {
    dbPath = (await invoke('plugin:turso|load', {
      options: { path: DB_PATH, experimental: ['index_method'] },
    })) as string;
    db = new TauriDatabaseAdapter(dbPath);
  });

  afterEach(async () => {
    await db.close();
  });

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  it('loads an in-memory database and returns a path', () => {
    expect(typeof dbPath).toBe('string');
    expect(dbPath.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Plugin config
  // ---------------------------------------------------------------------------

  it('get_config returns encryption status', async () => {
    const config = (await invoke('plugin:turso|get_config')) as { encrypted: boolean };
    expect(typeof config.encrypted).toBe('boolean');
  });

  // ---------------------------------------------------------------------------
  // Shared test suites
  // ---------------------------------------------------------------------------

  describe('Base Operations', () => {
    baseTests(() => db);
  });

  describe('Full-Text Search', () => {
    ftsTests(() => db);
  });

  describe('Vector Search', () => {
    vectorTests(() => db);
  });

  describe('Migrations', () => {
    migrationTests(() => db);
  });
});
