import { describe, beforeEach, afterEach } from 'vitest';
import { WebDatabaseService } from '@/services/database/webDatabaseService';
import { DatabaseService } from '@/types/database';
import { baseTests } from './suites/base-tests';
import { ftsTests } from './suites/fts-tests';
import { vectorTests } from './suites/vector-tests';
import { migrationTests } from './suites/migration-tests';

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
