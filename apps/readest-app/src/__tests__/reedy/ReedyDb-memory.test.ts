import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';

const DIM = 4;

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

describe('ReedyDb · memory', () => {
  let svc: DatabaseService;
  let reedy: ReedyDb;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    reedy = new ReedyDb(svc);
  });

  afterEach(async () => {
    await svc.close();
  });

  describe('migration', () => {
    it('creates reedy_memory + idx_memory_scope', async () => {
      const tables = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_memory'",
      );
      expect(tables).toHaveLength(1);
      const indexes = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_scope'",
      );
      expect(indexes).toHaveLength(1);
    });

    it('does NOT create reedy_memory_embeddings at migration time (lazy)', async () => {
      const tables = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_memory_embeddings'",
      );
      expect(tables).toHaveLength(0);
    });
  });

  describe('ensureMemoryEmbeddingsTable', () => {
    it('creates the table on first call', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      const rows = await svc.select(
        "SELECT name FROM sqlite_master WHERE name='reedy_memory_embeddings'",
      );
      expect(rows).toHaveLength(1);
    });

    it('is idempotent at the same dim', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      const rows = await svc.select(
        "SELECT name FROM sqlite_master WHERE name='reedy_memory_embeddings'",
      );
      expect(rows).toHaveLength(1);
    });

    it('throws on dim mismatch', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      await expect(reedy.ensureMemoryEmbeddingsTable(DIM + 1)).rejects.toThrow(/dim/);
    });
  });

  describe('upsertMemory + getMemory', () => {
    it('inserts a new memory row + returns the full record', async () => {
      const row = await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'prefers-spoiler-free',
        summary: 'User asked to avoid spoilers.',
        sourceMessageId: 'msg-1',
      });
      expect(row.id).toMatch(/^mem-/);
      expect(row.summary).toBe('User asked to avoid spoilers.');
      expect(row.updatedAt).toBeGreaterThan(0);
      const fetched = await reedy.getMemory('user', 'u1', 'prefers-spoiler-free');
      expect(fetched?.id).toBe(row.id);
    });

    it('upserting the same (scope, scopeKey, key) replaces the prior summary', async () => {
      const first = await reedy.upsertMemory({
        scope: 'book',
        scopeKey: 'bk1',
        key: 'theme',
        summary: 'first',
      });
      await new Promise((r) => setTimeout(r, 2));
      const second = await reedy.upsertMemory({
        scope: 'book',
        scopeKey: 'bk1',
        key: 'theme',
        summary: 'second',
      });
      expect(second.id).toBe(first.id);
      expect(second.summary).toBe('second');
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    });

    it('stores an embedding when provided + upserts replace it', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      const row = await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'k',
        summary: 'hello',
        embedding: unit([1, 0, 0, 0]),
      });
      const embRows = await svc.select<{ extracted: string }>(
        `SELECT vector_extract(embedding) AS extracted FROM reedy_memory_embeddings WHERE memory_id = '${row.id}'`,
      );
      expect(embRows).toHaveLength(1);
      const parsed = JSON.parse(embRows[0]!.extracted) as number[];
      expect(parsed).toHaveLength(DIM);

      // Upsert with a different embedding replaces it.
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'k',
        summary: 'hello again',
        embedding: unit([0, 1, 0, 0]),
      });
      const after = await svc.select<{ extracted: string }>(
        `SELECT vector_extract(embedding) AS extracted FROM reedy_memory_embeddings WHERE memory_id = '${row.id}'`,
      );
      const parsedAfter = JSON.parse(after[0]!.extracted) as number[];
      expect(Math.abs(parsedAfter[1]! - 1)).toBeLessThan(0.01);
    });
  });

  describe('listMemories', () => {
    it('returns rows for the scope in recency-desc order', async () => {
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u1', key: 'a', summary: 'A' });
      await new Promise((r) => setTimeout(r, 2));
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u1', key: 'b', summary: 'B' });
      await new Promise((r) => setTimeout(r, 2));
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u1', key: 'c', summary: 'C' });
      const out = await reedy.listMemories('user', 'u1', 10);
      expect(out.map((m) => m.key)).toEqual(['c', 'b', 'a']);
    });

    it('isolates by scope and scopeKey', async () => {
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u1', key: 'k', summary: 'U1' });
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u2', key: 'k', summary: 'U2' });
      await reedy.upsertMemory({ scope: 'book', scopeKey: 'u1', key: 'k', summary: 'B1' });
      const out = await reedy.listMemories('user', 'u1', 10);
      expect(out.map((m) => m.summary)).toEqual(['U1']);
    });
  });

  describe('deleteMemory', () => {
    it('returns true when a row was deleted, false when nothing matched', async () => {
      await reedy.upsertMemory({ scope: 'user', scopeKey: 'u1', key: 'k', summary: 'x' });
      expect(await reedy.deleteMemory('user', 'u1', 'k')).toBe(true);
      expect(await reedy.deleteMemory('user', 'u1', 'k')).toBe(false);
    });

    it('cascade-deletes the embedding row', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      const row = await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'k',
        summary: 'x',
        embedding: unit([1, 0, 0, 0]),
      });
      await reedy.deleteMemory('user', 'u1', 'k');
      const embs = await svc.select(
        `SELECT memory_id FROM reedy_memory_embeddings WHERE memory_id = '${row.id}'`,
      );
      expect(embs).toHaveLength(0);
    });
  });

  describe('searchMemories', () => {
    beforeEach(async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'a',
        summary: 'about cats',
        embedding: unit([1, 0, 0, 0]),
      });
      await new Promise((r) => setTimeout(r, 2));
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'b',
        summary: 'about dogs',
        embedding: unit([0, 1, 0, 0]),
      });
      await new Promise((r) => setTimeout(r, 2));
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'c',
        summary: 'about birds',
        embedding: unit([0, 0, 1, 0]),
      });
    });

    it('ranks the vector-aligned memory first when query embedding points at it', async () => {
      const out = await reedy.searchMemories({
        scope: 'user',
        scopeKey: 'u1',
        queryEmbedding: unit([0, 1, 0, 0]),
        limit: 3,
      });
      expect(out[0]!.key).toBe('b');
      expect(out[0]!.vectorDistance).toBeLessThan(0.01);
    });

    it('returns rows by recency when no queryEmbedding is provided', async () => {
      const out = await reedy.searchMemories({
        scope: 'user',
        scopeKey: 'u1',
        limit: 3,
      });
      // Most-recent first (insertion order: a, b, c so c is newest).
      expect(out.map((m) => m.key)).toEqual(['c', 'b', 'a']);
      for (const r of out) expect(r.vectorDistance).toBeNull();
    });

    it('strictly isolates by scope_key — no other user shows up', async () => {
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u2',
        key: 'x',
        summary: 'other user about cats',
        embedding: unit([1, 0, 0, 0]),
      });
      const out = await reedy.searchMemories({
        scope: 'user',
        scopeKey: 'u1',
        queryEmbedding: unit([1, 0, 0, 0]),
        limit: 5,
      });
      for (const r of out) expect(r.scopeKey).toBe('u1');
    });
  });

  describe('wipeAllData', () => {
    it('clears memory + drops the memory embeddings table', async () => {
      await reedy.ensureMemoryEmbeddingsTable(DIM);
      await reedy.upsertMemory({
        scope: 'user',
        scopeKey: 'u1',
        key: 'k',
        summary: 's',
        embedding: unit([1, 0, 0, 0]),
      });
      await reedy.wipeAllData();
      const rows = await svc.select('SELECT id FROM reedy_memory');
      expect(rows).toHaveLength(0);
      const embTable = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE name='reedy_memory_embeddings'",
      );
      expect(embTable).toHaveLength(0);
    });
  });
});
