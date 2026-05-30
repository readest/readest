import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import type { ChunkRow, EmbeddingRow } from '@/services/reedy/db/types';

const DIM = 4;

function chunk(id: string, bookHash: string, pos: number, text: string): ChunkRow {
  return {
    id,
    bookHash,
    sectionIndex: 0,
    chapterTitle: 'Ch1',
    startCfi: `/6/4!/4/${pos * 2 + 2},/1:0,/1:10`,
    endCfi: `/6/4!/4/${pos * 2 + 2},/1:10,/1:20`,
    positionIndex: pos,
    text,
    tokenCount: text.split(/\s+/).length,
  };
}

function unitVec(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return values.map((v) => v / norm);
}

describe('ReedyDb', () => {
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

  describe('book meta', () => {
    it('getBookMeta returns null when no row exists', async () => {
      const meta = await reedy.getBookMeta('missing');
      expect(meta).toBeNull();
    });

    it('upsertBookMeta then getBookMeta round-trips all fields', async () => {
      await reedy.upsertBookMeta({
        bookHash: 'bk1',
        indexingStatus: 'indexed',
        chunkCount: 42,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: DIM,
        indexedAt: 1700000000,
        error: null,
      });

      const meta = await reedy.getBookMeta('bk1');
      expect(meta).toEqual({
        bookHash: 'bk1',
        indexingStatus: 'indexed',
        chunkCount: 42,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: DIM,
        indexedAt: 1700000000,
        error: null,
      });
    });

    it('setIndexingStatus preserves untouched fields (partial update)', async () => {
      await reedy.upsertBookMeta({
        bookHash: 'bk1',
        indexingStatus: 'indexing',
        chunkCount: 0,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: DIM,
        indexedAt: null,
        error: null,
      });

      await reedy.setIndexingStatus('bk1', 'failed', { error: 'embed timeout' });

      const meta = await reedy.getBookMeta('bk1');
      expect(meta?.indexingStatus).toBe('failed');
      expect(meta?.error).toBe('embed timeout');
      expect(meta?.embeddingModel).toBe('nomic-embed-text');
      expect(meta?.embeddingDim).toBe(DIM);
    });
  });

  describe('ensureEmbeddingsTable', () => {
    it('creates the embeddings table on first call', async () => {
      await reedy.ensureEmbeddingsTable(DIM);
      const tables = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      expect(tables).toHaveLength(1);
    });

    it('is idempotent across repeated calls with the same dim', async () => {
      await reedy.ensureEmbeddingsTable(DIM);
      await reedy.ensureEmbeddingsTable(DIM);
      await reedy.ensureEmbeddingsTable(DIM);
      const tables = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      expect(tables).toHaveLength(1);
    });

    it('throws when called with a different dim than the existing table', async () => {
      await reedy.ensureEmbeddingsTable(DIM);
      await expect(reedy.ensureEmbeddingsTable(DIM + 1)).rejects.toThrow(/dim/);
    });
  });

  describe('chunk + embedding writes', () => {
    beforeEach(async () => {
      await reedy.ensureEmbeddingsTable(DIM);
    });

    it('insertChunks writes multiple rows in one batch', async () => {
      const chunks = [
        chunk('c1', 'bk1', 0, 'alpha bravo'),
        chunk('c2', 'bk1', 1, 'charlie delta'),
        chunk('c3', 'bk1', 2, "let's go — apostrophe & ampersand"),
      ];
      await reedy.insertChunks(chunks);

      const rows = await svc.select<{ id: string; text: string }>(
        'SELECT id, text FROM reedy_book_chunks ORDER BY position_index',
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.text)).toEqual(chunks.map((c) => c.text));
    });

    it('insertEmbeddings writes vectors that round-trip via vector_extract', async () => {
      await reedy.insertChunks([chunk('c1', 'bk1', 0, 'alpha')]);
      const emb: EmbeddingRow = {
        chunkId: 'c1',
        bookHash: 'bk1',
        embedding: unitVec([1, 2, 3, 4]),
      };
      await reedy.insertEmbeddings([emb]);

      const rows = await svc.select<{ extracted: string }>(
        "SELECT vector_extract(embedding) AS extracted FROM reedy_book_chunk_embeddings WHERE chunk_id = 'c1'",
      );
      expect(rows).toHaveLength(1);
      const parsed = JSON.parse(rows[0]!.extracted) as number[];
      expect(parsed).toHaveLength(DIM);
      for (let i = 0; i < DIM; i++) {
        expect(parsed[i]).toBeCloseTo(emb.embedding[i]!, 4);
      }
    });

    it('insertEmbeddings throws when embedding length does not match dim', async () => {
      await reedy.insertChunks([chunk('c1', 'bk1', 0, 'alpha')]);
      await expect(
        reedy.insertEmbeddings([{ chunkId: 'c1', bookHash: 'bk1', embedding: [1, 2, 3] }]),
      ).rejects.toThrow(/dim/);
    });
  });

  describe('dropBookData / wipeAllData', () => {
    beforeEach(async () => {
      await reedy.ensureEmbeddingsTable(DIM);
      await reedy.insertChunks([
        chunk('a1', 'bookA', 0, 'A one'),
        chunk('a2', 'bookA', 1, 'A two'),
        chunk('b1', 'bookB', 0, 'B one'),
      ]);
      await reedy.insertEmbeddings([
        { chunkId: 'a1', bookHash: 'bookA', embedding: unitVec([1, 0, 0, 0]) },
        { chunkId: 'a2', bookHash: 'bookA', embedding: unitVec([0, 1, 0, 0]) },
        { chunkId: 'b1', bookHash: 'bookB', embedding: unitVec([0, 0, 1, 0]) },
      ]);
    });

    it('dropBookData removes only the targeted book’s chunks and embeddings', async () => {
      await reedy.dropBookData('bookA');

      const chunks = await svc.select<{ id: string }>(
        'SELECT id FROM reedy_book_chunks ORDER BY id',
      );
      expect(chunks.map((c) => c.id)).toEqual(['b1']);

      const embs = await svc.select<{ chunk_id: string }>(
        'SELECT chunk_id FROM reedy_book_chunk_embeddings ORDER BY chunk_id',
      );
      expect(embs.map((e) => e.chunk_id)).toEqual(['b1']);
    });

    it('wipeAllData clears chunks, embeddings, and meta across every book', async () => {
      await reedy.upsertBookMeta({
        bookHash: 'bookA',
        indexingStatus: 'indexed',
        chunkCount: 2,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: DIM,
        indexedAt: 1700000000,
        error: null,
      });

      await reedy.wipeAllData();

      const chunks = await svc.select('SELECT id FROM reedy_book_chunks');
      const meta = await svc.select('SELECT book_hash FROM reedy_book_meta');
      // wipeAllData DROPS the embeddings table so ensureEmbeddingsTable(newDim)
      // can recreate it with a different vector32 width. Check it's gone.
      const embTable = await svc.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      expect(chunks).toHaveLength(0);
      expect(meta).toHaveLength(0);
      expect(embTable).toHaveLength(0);
    });

    it('wipeAllData lets ensureEmbeddingsTable recreate the table at a new dim', async () => {
      await reedy.wipeAllData();
      await reedy.ensureEmbeddingsTable(DIM + 4);

      const rows = await svc.select<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      expect(rows[0]!.sql).toMatch(/vector32\s*\(\s*8\s*\)/i);
    });
  });

  describe('hybridSearch', () => {
    beforeEach(async () => {
      await reedy.ensureEmbeddingsTable(DIM);
      // bookA: 4 chunks at increasing positions, embeddings on different axes.
      // bookB: 1 chunk with an embedding very close to bookA's first to test
      // that book filtering works.
      const chunks = [
        chunk('a1', 'bookA', 0, 'apple banana cherry'),
        chunk('a2', 'bookA', 1, 'date elderberry fig'),
        chunk('a3', 'bookA', 2, 'grape honeydew imbe'),
        chunk('a4', 'bookA', 3, 'jackfruit kiwi lemon'),
        chunk('b1', 'bookB', 0, 'apple banana cherry'),
      ];
      const embs: EmbeddingRow[] = [
        { chunkId: 'a1', bookHash: 'bookA', embedding: unitVec([1, 0, 0, 0]) },
        { chunkId: 'a2', bookHash: 'bookA', embedding: unitVec([0, 1, 0, 0]) },
        { chunkId: 'a3', bookHash: 'bookA', embedding: unitVec([0, 0, 1, 0]) },
        { chunkId: 'a4', bookHash: 'bookA', embedding: unitVec([0, 0, 0, 1]) },
        { chunkId: 'b1', bookHash: 'bookB', embedding: unitVec([1, 0, 0, 0]) },
      ];
      await reedy.insertChunks(chunks);
      await reedy.insertEmbeddings(embs);
    });

    it('filters strictly by book_hash (no cross-book bleed)', async () => {
      const res = await reedy.hybridSearch({
        bookHash: 'bookA',
        queryText: 'apple',
        queryEmbedding: unitVec([1, 0, 0, 0]),
        k: 5,
      });
      for (const r of res) expect(r.bookHash).toBe('bookA');
    });

    it('ranks the vector-aligned chunk highly when query embedding points at it', async () => {
      const res = await reedy.hybridSearch({
        bookHash: 'bookA',
        queryText: 'something unrelated',
        queryEmbedding: unitVec([0, 0, 1, 0]),
        k: 5,
      });
      expect(res.length).toBeGreaterThan(0);
      expect(res[0]!.id).toBe('a3');
    });

    it('ranks the FTS-matched chunk highly when query text matches that chunk', async () => {
      const res = await reedy.hybridSearch({
        bookHash: 'bookA',
        queryText: 'jackfruit',
        queryEmbedding: unitVec([1, 0, 0, 0]), // misaligned vector
        k: 5,
      });
      expect(res.length).toBeGreaterThan(0);
      expect(res[0]!.id).toBe('a4');
    });

    it('drops chunks with position_index > spoilerBoundPosition', async () => {
      const res = await reedy.hybridSearch({
        bookHash: 'bookA',
        queryText: 'apple banana',
        queryEmbedding: unitVec([0, 0, 0, 1]), // would otherwise surface a4
        k: 5,
        spoilerBoundPosition: 1,
      });
      for (const r of res) expect(r.positionIndex).toBeLessThanOrEqual(1);
    });
  });
});
