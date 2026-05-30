import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { BookRetriever } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type { ChunkRow, EmbeddingRow } from '@/services/reedy/db/types';

const DIM = 4;

function unitVec(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

function fakeModel(
  opts: { id?: string; embedFn?: (texts: string[]) => Promise<number[][]> } = {},
): EmbeddingModel {
  return {
    id: opts.id ?? 'fake-model',
    dim: DIM,
    embed: opts.embedFn ?? (async (texts) => texts.map(() => unitVec([1, 0, 0, 0]))),
  };
}

function chunk(id: string, bookHash: string, pos: number, text: string): ChunkRow {
  return {
    id,
    bookHash,
    sectionIndex: 0,
    chapterTitle: 'Ch1',
    startCfi: `epubcfi(/6/2!/4/${pos * 2 + 2},/1:0,/1:10)`,
    endCfi: `epubcfi(/6/2!/4/${pos * 2 + 2},/1:10,/1:20)`,
    positionIndex: pos,
    text,
    tokenCount: text.split(/\s+/).length,
  };
}

describe('BookRetriever', () => {
  let svc: DatabaseService;
  let reedy: ReedyDb;
  let retriever: BookRetriever;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    reedy = new ReedyDb(svc);
    retriever = new BookRetriever(reedy);
  });

  afterEach(async () => {
    await svc.close();
  });

  // -------------------------------------------------------------------------
  // status: not_indexed
  // -------------------------------------------------------------------------

  it('returns not_indexed when the book has no meta row', async () => {
    const res = await retriever.search({
      bookHash: 'unknown',
      query: 'whatever',
      k: 5,
      activeEmbeddingModel: fakeModel(),
    });
    expect(res.status).toBe('not_indexed');
    expect(res.passages).toEqual([]);
  });

  it('returns not_indexed while indexing is still in progress', async () => {
    await reedy.upsertBookMeta({
      bookHash: 'bk1',
      indexingStatus: 'indexing',
      chunkCount: 0,
      embeddingModel: 'fake-model',
      embeddingDim: DIM,
      indexedAt: null,
      error: null,
    });
    const res = await retriever.search({
      bookHash: 'bk1',
      query: 'q',
      k: 5,
      activeEmbeddingModel: fakeModel(),
    });
    expect(res.status).toBe('not_indexed');
  });

  it('returns not_indexed when the prior index failed', async () => {
    await reedy.upsertBookMeta({
      bookHash: 'bk1',
      indexingStatus: 'failed',
      chunkCount: 0,
      embeddingModel: 'fake-model',
      embeddingDim: DIM,
      indexedAt: null,
      error: 'gateway down',
    });
    const res = await retriever.search({
      bookHash: 'bk1',
      query: 'q',
      k: 5,
      activeEmbeddingModel: fakeModel(),
    });
    expect(res.status).toBe('not_indexed');
  });

  // -------------------------------------------------------------------------
  // status: empty_index
  // -------------------------------------------------------------------------

  it('returns empty_index for an image-only book that was indexed with zero chunks', async () => {
    await reedy.upsertBookMeta({
      bookHash: 'bk1',
      indexingStatus: 'empty_index',
      chunkCount: 0,
      embeddingModel: 'fake-model',
      embeddingDim: DIM,
      indexedAt: Date.now(),
      error: null,
    });
    const res = await retriever.search({
      bookHash: 'bk1',
      query: 'q',
      k: 5,
      activeEmbeddingModel: fakeModel(),
    });
    expect(res.status).toBe('empty_index');
    expect(res.passages).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // status: stale_index
  // -------------------------------------------------------------------------

  it('returns stale_index when the active model differs from the one used to index', async () => {
    await reedy.upsertBookMeta({
      bookHash: 'bk1',
      indexingStatus: 'indexed',
      chunkCount: 5,
      embeddingModel: 'nomic-embed-text',
      embeddingDim: DIM,
      indexedAt: Date.now(),
      error: null,
    });
    const res = await retriever.search({
      bookHash: 'bk1',
      query: 'q',
      k: 5,
      activeEmbeddingModel: fakeModel({ id: 'text-embedding-3-small' }),
    });
    expect(res.status).toBe('stale_index');
    expect(res.reason).toMatch(/text-embedding-3-small/);
    expect(res.reason).toMatch(/nomic-embed-text/);
  });

  // -------------------------------------------------------------------------
  // happy path + per-book isolation
  // -------------------------------------------------------------------------

  describe('with indexed data', () => {
    beforeEach(async () => {
      await reedy.upsertBookMeta({
        bookHash: 'bookA',
        indexingStatus: 'indexed',
        chunkCount: 4,
        embeddingModel: 'fake-model',
        embeddingDim: DIM,
        indexedAt: Date.now(),
        error: null,
      });
      await reedy.upsertBookMeta({
        bookHash: 'bookB',
        indexingStatus: 'indexed',
        chunkCount: 1,
        embeddingModel: 'fake-model',
        embeddingDim: DIM,
        indexedAt: Date.now(),
        error: null,
      });
      await reedy.ensureEmbeddingsTable(DIM);
      await reedy.insertChunks([
        chunk('a0', 'bookA', 0, 'alpha bravo charlie introduction'),
        chunk('a1', 'bookA', 1, 'delta echo foxtrot middle chapter'),
        chunk('a2', 'bookA', 2, 'golf hotel india later passages'),
        chunk('a3', 'bookA', 3, 'juliet kilo lima final wrap-up'),
        chunk('b1', 'bookB', 0, 'alpha bravo charlie introduction'),
      ]);
      const embs: EmbeddingRow[] = [
        { chunkId: 'a0', bookHash: 'bookA', embedding: unitVec([1, 0, 0, 0]) },
        { chunkId: 'a1', bookHash: 'bookA', embedding: unitVec([0, 1, 0, 0]) },
        { chunkId: 'a2', bookHash: 'bookA', embedding: unitVec([0, 0, 1, 0]) },
        { chunkId: 'a3', bookHash: 'bookA', embedding: unitVec([0, 0, 0, 1]) },
        { chunkId: 'b1', bookHash: 'bookB', embedding: unitVec([1, 0, 0, 0]) },
      ];
      await reedy.insertEmbeddings(embs);
    });

    it('returns ok with passages strictly from the requested book (T3 isolation)', async () => {
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'introduction',
        k: 5,
        activeEmbeddingModel: fakeModel({
          embedFn: async (texts) => texts.map(() => unitVec([1, 0, 0, 0])),
        }),
      });
      expect(res.status).toBe('ok');
      expect(res.passages.length).toBeGreaterThan(0);
      for (const p of res.passages) expect(p.bookHash).toBe('bookA');
    });

    it('exposes start_cfi and end_cfi on each passage so the UI can navigate', async () => {
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'introduction',
        k: 2,
        activeEmbeddingModel: fakeModel({
          embedFn: async (texts) => texts.map(() => unitVec([1, 0, 0, 0])),
        }),
      });
      expect(res.passages.length).toBeGreaterThan(0);
      for (const p of res.passages) {
        expect(p.cfi).toMatch(/^epubcfi\(/);
        expect(p.endCfi).toMatch(/^epubcfi\(/);
        expect(p.text).toBeTruthy();
      }
    });

    it('exact-quote query ranks the FTS-aligned chunk first (T2 FTS dominance)', async () => {
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'wrap-up',
        k: 3,
        activeEmbeddingModel: fakeModel({
          // Vector points elsewhere so FTS has to win
          embedFn: async (texts) => texts.map(() => unitVec([1, 0, 0, 0])),
        }),
      });
      expect(res.status).toBe('ok');
      expect(res.passages[0]!.id).toBe('a3');
    });

    it('paraphrase query without a lexical match ranks by vector similarity (T2 vector dominance)', async () => {
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'something completely orthogonal to chunk text',
        k: 3,
        activeEmbeddingModel: fakeModel({
          embedFn: async (texts) => texts.map(() => unitVec([0, 0, 1, 0])),
        }),
      });
      expect(res.status).toBe('ok');
      expect(res.passages[0]!.id).toBe('a2');
    });

    it('drops passages above spoilerBoundPosition', async () => {
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'final',
        k: 5,
        spoilerBoundPosition: 1,
        activeEmbeddingModel: fakeModel({
          embedFn: async (texts) => texts.map(() => unitVec([0, 0, 0, 1])),
        }),
      });
      for (const p of res.passages) expect(p.positionIndex).toBeLessThanOrEqual(1);
    });

    it('falls back to FTS-only with status=degraded when the embedding call times out', async () => {
      const slowModel: EmbeddingModel = {
        id: 'fake-model',
        dim: DIM,
        embed: async (_texts, opts) => {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 50);
            opts?.signal?.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
          return [unitVec([1, 0, 0, 0])];
        },
      };
      const res = await retriever.search({
        bookHash: 'bookA',
        query: 'introduction',
        k: 3,
        activeEmbeddingModel: slowModel,
        embeddingTimeoutMs: 10,
      });
      expect(res.status).toBe('degraded');
      expect(res.reason).toMatch(/timeout|abort/i);
      // FTS still finds the lexical match for "introduction"
      expect(res.passages.length).toBeGreaterThan(0);
      expect(res.passages[0]!.id).toBe('a0');
    });
  });
});
