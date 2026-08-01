import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, beforeEach, afterEach, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { baseTests } from './suites/base-tests';
import { ftsTests } from './suites/fts-tests';
import { vectorTests } from './suites/vector-tests';
import { migrationTests } from './suites/migration-tests';

/**
 * Integration tests using a real in-memory SQLite database via @tursodatabase/database.
 * These complement the mock-based tests in mock.test.ts by exercising
 * actual SQL execution through the DatabaseService interface using the same
 * turso engine that powers the browser-based @readest/turso-database-wasm.
 */
describe('NodeDatabaseService (real in-memory SQLite)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
  });

  afterEach(async () => {
    await db.close();
  });

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

// Turso is WAL-only with no auto-checkpoint and does not fold the WAL on
// close by itself; DatabaseService.close() must checkpoint so file-level
// copy or sync of the database directory sees the data in the main file.
describe('NodeDatabaseService WAL checkpoint on close', () => {
  it('folds the wal into the main file when closing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turso-close-'));
    try {
      const fileDb = await NodeDatabaseService.open(join(dir, 't.db'));
      await fileDb.execute('CREATE TABLE t (x TEXT)');
      await fileDb.execute('INSERT INTO t (x) VALUES (?)', ['y'.repeat(100_000)]);
      await fileDb.close();
      expect(statSync(join(dir, 't.db')).size).toBeGreaterThan(4096);
      const walPath = join(dir, 't.db-wal');
      expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
