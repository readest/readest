import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import type { BookMeta, ChunkRow } from '@/services/reedy/db/types';
import { ReedyXRaySource } from '@/services/ai/xray/source/ReedyXRaySource';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

const mocks = vi.hoisted(() => ({ openNativeDatabase: vi.fn() }));

vi.mock('@/services/database/nativeDatabaseService', () => ({
  NativeDatabaseService: { open: mocks.openNativeDatabase },
}));

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

describe('ReedyXRaySource', () => {
  let db: DatabaseService;
  let reedy: ReedyDb;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(db, getMigrations('reedy'));
    reedy = new ReedyDb(db);
    mocks.openNativeDatabase.mockReset().mockResolvedValue(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('opens the canonical Reedy database without creating a second index', async () => {
    const databaseExists = vi.fn().mockResolvedValue(true);
    const resolveFilePath = vi.fn().mockResolvedValue('/data/reedy.db');
    const openDatabase = vi.fn();

    await ReedyXRaySource.open(
      { databaseExists, resolveFilePath, openDatabase } as unknown as AppService,
      MODEL_ID,
    );

    expect(databaseExists).toHaveBeenCalledWith('reedy.db', 'Data');
    expect(resolveFilePath).toHaveBeenCalledWith('reedy.db', 'Data');
    expect(mocks.openNativeDatabase).toHaveBeenCalledWith('sqlite:/data/reedy.db', {
      experimental: ['index_method'],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('does not create a Reedy database when the canonical index is missing', async () => {
    const source = await ReedyXRaySource.open(
      {
        databaseExists: vi.fn().mockResolvedValue(false),
      } as unknown as AppService,
      MODEL_ID,
    );

    await expect(source.getStatus(BOOK_HASH)).resolves.toEqual({ kind: 'not_indexed' });
    expect(mocks.openNativeDatabase).not.toHaveBeenCalled();
  });

  it('opens Reedy after indexing creates a database later in the session', async () => {
    let exists = false;
    const databaseExists = vi.fn(async () => exists);
    const source = await ReedyXRaySource.open(
      {
        databaseExists,
        resolveFilePath: vi.fn().mockResolvedValue('/data/reedy.db'),
      } as unknown as AppService,
      MODEL_ID,
    );

    await expect(source.getStatus(BOOK_HASH)).resolves.toEqual({ kind: 'not_indexed' });
    await reedy.upsertBookMeta(indexedMeta());
    exists = true;

    await expect(source.getStatus(BOOK_HASH)).resolves.toMatchObject({ kind: 'ready' });
    expect(mocks.openNativeDatabase).toHaveBeenCalledOnce();
  });

  it('reports missing, ready, and stale Reedy indexes', async () => {
    const source = new ReedyXRaySource(db, reedy, MODEL_ID);
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

    const stale = new ReedyXRaySource(db, reedy, 'embedding-b');
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

    const source = new ReedyXRaySource(db, reedy, MODEL_ID);
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
      MODEL_ID,
    );

    await expect(source.readThrough(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:15)')).rejects.toThrow(
      'Reedy index changed while X-Ray was reading it',
    );
  });
});
