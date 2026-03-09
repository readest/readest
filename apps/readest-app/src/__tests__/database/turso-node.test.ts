import { describe, beforeEach, afterEach } from 'vitest';
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
 * turso engine that powers the browser-based @tursodatabase/database-wasm.
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
