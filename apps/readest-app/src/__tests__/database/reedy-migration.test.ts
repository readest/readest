import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';

/**
 * Verify the Reedy schema migration applies cleanly against a real Turso
 * (in-memory) SQLite database with the same `experimental: ['index_method']`
 * opt that production opens reedy.db with.
 *
 * Per plan §M1.1 the embeddings table is created lazily by BookIndexer on
 * first index (so its dim can match the active embedding model). The
 * migration must NOT create it; this test guards that contract.
 */
describe('Reedy migration', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
  });

  afterEach(async () => {
    await db.close();
  });

  async function listObjects(type: 'table' | 'index'): Promise<string[]> {
    const rows = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = '${type}' AND name NOT LIKE 'sqlite_%'`,
    );
    return rows.map((r) => r.name);
  }

  it('registers a non-empty migration set under the "reedy" schema', () => {
    const reedyMigrations = getMigrations('reedy');
    expect(reedyMigrations.length).toBeGreaterThan(0);
    for (const m of reedyMigrations) {
      expect(m.name).toMatch(/^\d{10}_/);
      expect(typeof m.sql).toBe('string');
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });

  it('creates reedy_book_meta and reedy_book_chunks tables', async () => {
    await migrate(db, getMigrations('reedy'));
    const tables = await listObjects('table');
    expect(tables).toContain('reedy_book_meta');
    expect(tables).toContain('reedy_book_chunks');
  });

  it('does NOT create the embeddings table at migration time (lazy)', async () => {
    await migrate(db, getMigrations('reedy'));
    const tables = await listObjects('table');
    expect(tables).not.toContain('reedy_book_chunk_embeddings');
  });

  it('creates idx_chunks_book_position index on (book_hash, position_index)', async () => {
    await migrate(db, getMigrations('reedy'));
    const indexes = await listObjects('index');
    expect(indexes).toContain('idx_chunks_book_position');
  });

  it('creates an FTS index over reedy_book_chunks.text that is queryable', async () => {
    await migrate(db, getMigrations('reedy'));

    await db.execute(
      `INSERT INTO reedy_book_chunks
         (id, book_hash, section_index, chapter_title, start_cfi, end_cfi, position_index, text, token_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['c1', 'bk1', 0, 'Ch1', '/6/4!/4/2,/1:0,/1:10', '/6/4!/4/2,/1:10,/1:20', 0, 'alpha bravo', 2],
    );
    await db.execute(
      `INSERT INTO reedy_book_chunks
         (id, book_hash, section_index, chapter_title, start_cfi, end_cfi, position_index, text, token_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'c2',
        'bk1',
        0,
        'Ch1',
        '/6/4!/4/4,/1:0,/1:10',
        '/6/4!/4/4,/1:10,/1:20',
        1,
        'charlie delta',
        2,
      ],
    );

    const matches = await db.select<{ id: string; text: string }>(
      "SELECT id, text FROM reedy_book_chunks WHERE fts_match(text, 'alpha')",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('c1');
  });

  it('is idempotent — running twice does not error and PRAGMA user_version stays at target', async () => {
    const reedyMigrations = getMigrations('reedy');
    await migrate(db, reedyMigrations);
    await migrate(db, reedyMigrations);

    const version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(reedyMigrations.length);
  });
});
