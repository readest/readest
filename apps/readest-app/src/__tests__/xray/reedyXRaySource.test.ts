import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import type { BookMeta, ChunkRow } from '@/services/reedy/db/types';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type { BookIndexer } from '@/services/reedy/retrieval/BookIndexer';
import type { BookRetriever } from '@/services/reedy/retrieval/BookRetriever';
import { ReedyXRaySource } from '@/services/ai/xray/source/ReedyXRaySource';
import type { DatabaseService } from '@/types/database';

const BOOK_HASH = 'book-a';
const MODEL_ID = 'embedding-a';

const indexedMeta = (overrides: Partial<BookMeta> = {}): BookMeta => ({
  bookHash: BOOK_HASH,
  indexingStatus: 'indexed',
  chunkCount: 2,
  embeddingModel: MODEL_ID,
  embeddingDim: 2,
  indexedAt: 1_000,
  error: null,
  ...overrides,
});

const chunk = (
  id: string,
  positionIndex: number,
  startOffset: number,
  endOffset: number,
): ChunkRow => ({
  id,
  bookHash: BOOK_HASH,
  sectionIndex: 0,
  chapterTitle: 'Chapter 1',
  startCfi: `epubcfi(/6/2!/4/2/1:${startOffset})`,
  endCfi: `epubcfi(/6/2!/4/2/1:${endOffset})`,
  positionIndex,
  text: `Chunk ${positionIndex}`,
  tokenCount: 2,
});

const fixedModel = (): EmbeddingModel => ({
  id: MODEL_ID,
  dim: 2,
  async embed(texts) {
    return texts.map(() => [1, 0]);
  },
});

describe('ReedyXRaySource', () => {
  let db: DatabaseService;
  let reedy: ReedyDb;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(db, getMigrations('reedy'));
    reedy = new ReedyDb(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('reports missing, ready, and stale Reedy indexes', async () => {
    const source = new ReedyXRaySource(db, reedy, fixedModel());
    await expect(source.getStatus(BOOK_HASH)).resolves.toEqual({ kind: 'not_indexed' });

    await reedy.upsertBookMeta(indexedMeta());
    await expect(source.getStatus(BOOK_HASH)).resolves.toEqual({
      kind: 'ready',
      fingerprint: {
        bookHash: BOOK_HASH,
        contentHash: 'embedding-a:2:2:1000',
      },
      maxPositionIndex: 1,
    });

    const stale = new ReedyXRaySource(db, reedy, { ...fixedModel(), id: 'embedding-b' });
    await expect(stale.getStatus(BOOK_HASH)).resolves.toEqual({
      kind: 'stale_index',
      activeModel: 'embedding-b',
      indexedModel: MODEL_ID,
    });
  });

  it('reads only complete chunks at or before the current CFI', async () => {
    await reedy.upsertBookMeta(indexedMeta());
    const first = chunk('chunk-0', 0, 0, 10);
    const second = chunk('chunk-1', 1, 11, 20);
    await reedy.insertChunks([second, first]);

    const source = new ReedyXRaySource(db, reedy, fixedModel());
    await expect(source.readThrough(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:15)')).resolves.toEqual({
      fingerprint: {
        bookHash: BOOK_HASH,
        contentHash: 'embedding-a:2:2:1000',
      },
      units: [
        {
          unitId: first.id,
          startCfi: first.startCfi,
          endCfi: first.endCfi,
          sectionIndex: first.sectionIndex,
          positionIndex: first.positionIndex,
          text: first.text,
        },
      ],
      maxPositionIndex: 0,
    });
  });

  it('rejects a read when the Reedy index changes during the query', async () => {
    await reedy.insertChunks([chunk('chunk-0', 0, 0, 10)]);
    const getBookMeta = vi
      .fn()
      .mockResolvedValueOnce(indexedMeta({ chunkCount: 1 }))
      .mockResolvedValueOnce(indexedMeta({ chunkCount: 1, indexedAt: 2_000 }));
    const source = new ReedyXRaySource(
      db,
      { getBookMeta } as Pick<ReedyDb, 'getBookMeta'>,
      fixedModel(),
    );

    await expect(source.readThrough(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:15)')).rejects.toThrow(
      'Reedy index changed while X-Ray was reading it',
    );
  });

  it('warms the embedding model before handing it to BookIndexer', async () => {
    let dim: number | null = null;
    const model: EmbeddingModel = {
      id: MODEL_ID,
      get dim() {
        if (dim === null) throw new Error('embedding dim unknown');
        return dim;
      },
      async embed(texts) {
        dim = 2;
        return texts.map(() => [1, 0]);
      },
    };
    const indexBook = vi.fn(async (_book: BookDoc, _hash: string, activeModel: EmbeddingModel) => {
      expect(activeModel.dim).toBe(2);
    });
    const source = new ReedyXRaySource(db, reedy, model, { indexBook } as Pick<
      BookIndexer,
      'indexBook'
    >);

    await source.indexBook({} as BookDoc, BOOK_HASH);

    expect(indexBook).toHaveBeenCalledOnce();
  });

  it('derives the Reedy search spoiler bound from the current CFI', async () => {
    await reedy.upsertBookMeta(indexedMeta());
    await reedy.insertChunks([chunk('chunk-0', 0, 0, 10), chunk('chunk-1', 1, 11, 20)]);
    const search = vi.fn().mockResolvedValue({ passages: [], status: 'ok' });
    const source = new ReedyXRaySource(db, reedy, fixedModel(), undefined, { search } as Pick<
      BookRetriever,
      'search'
    >);

    await source.searchThrough(BOOK_HASH, 'Who is this?', 'epubcfi(/6/2!/4/2/1:15)', 3);

    expect(search).toHaveBeenCalledWith({
      bookHash: BOOK_HASH,
      query: 'Who is this?',
      k: 3,
      spoilerBoundPosition: 0,
      activeEmbeddingModel: expect.objectContaining({ id: MODEL_ID }),
    });
  });
});
