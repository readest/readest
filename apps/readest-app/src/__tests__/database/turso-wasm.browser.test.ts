import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebDatabaseService } from '@/services/database/webDatabaseService';
import { DatabaseService } from '@/types/database';
import { baseTests } from './suites/base-tests';
import { ftsTests } from './suites/fts-tests';
import { vectorTests } from './suites/vector-tests';
import { migrationTests } from './suites/migration-tests';

/**
 * Browser-based integration tests for WebDatabaseService using @readest/turso-database-wasm.
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

describe('WebDatabaseService (browser WASM, persistent SQLite)', () => {
  test('supports two open databases with sequential writes', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const names = [
      `Readest_Dictionaries_dictionary-plugin-control-${suffix}.sqlite3`,
      `Readest_Dictionaries_dictionary-plugin-${'a'.repeat(64)}-${'b'.repeat(32)}-${suffix}.sqlite3`,
    ];
    const control = await WebDatabaseService.open(names[0]!);
    const index = await WebDatabaseService.open(names[1]!);

    try {
      await control.execute('CREATE TABLE control_state (value TEXT NOT NULL)');
      await control.execute('INSERT INTO control_state (value) VALUES (?)', ['ready']);
      await index.execute('CREATE TABLE dictionary_terms (term TEXT NOT NULL)');
      await index.execute('INSERT INTO dictionary_terms (term) VALUES (?)', ['読む']);

      await expect(control.select('SELECT value FROM control_state')).resolves.toEqual([
        { value: 'ready' },
      ]);
      await expect(index.select('SELECT term FROM dictionary_terms')).resolves.toEqual([
        { term: '読む' },
      ]);
    } finally {
      await index.close();
      await control.close();
      const root = await navigator.storage.getDirectory();
      for (const name of names.flatMap((name) => [name, `${name}-wal`])) {
        await root.removeEntry(name).catch(() => undefined);
      }
    }
  });
});
