import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { XRayPipeline, type XRayExtractionModel } from '@/services/ai/xray/XRayPipeline';
import type { XRaySourceSlice } from '@/services/ai/xray/source/ReedyXRaySource';
import { XRayStore } from '@/services/ai/xray/storage/XRayStore';
import type {
  XRayBookFingerprint,
  XRayModelExtraction,
  XRaySourceUnit,
} from '@/services/ai/xray/types';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';

const BOOK_HASH = 'book-a';
const fingerprint = (contentHash: string): XRayBookFingerprint => ({
  bookHash: BOOK_HASH,
  contentHash,
});

const unit = (positionIndex: number): XRaySourceUnit => ({
  unitId: `unit-${positionIndex}`,
  startCfi: `epubcfi(/6/2!/4/2/1:${positionIndex * 10})`,
  endCfi: `epubcfi(/6/2!/4/2/1:${positionIndex * 10 + 9})`,
  sectionIndex: 0,
  positionIndex,
  text: `Alice enters room ${positionIndex}.`,
});

const slice = (contentHash: string, positions: number[]): XRaySourceSlice => ({
  fingerprint: fingerprint(contentHash),
  units: positions.map(unit),
  maxPositionIndex: positions.at(-1) ?? -1,
});

const extractionFor = (sourceUnits: readonly XRaySourceUnit[]): XRayModelExtraction => ({
  entities: sourceUnits.length
    ? [
        {
          name: 'Alice',
          type: 'character',
          aliases: [],
          description: 'A character',
          evidence: [
            {
              unitId: sourceUnits[0]!.unitId,
              exactQuote: 'Alice',
              confidence: 1,
              inferred: false,
            },
          ],
          facts: [],
        },
      ]
    : [],
  relationships: [],
  events: [],
  claims: [],
});

describe('XRayPipeline', () => {
  let db: NodeDatabaseService;
  let store: XRayStore;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    store = new XRayStore(db);
    await store.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('extracts only new units in bounded batches and resumes from the committed cursor', async () => {
    const readThrough = vi.fn().mockResolvedValue(slice('index-1', [0, 1, 2]));
    const extract = vi.fn(async ({ units }: { units: readonly XRaySourceUnit[] }) =>
      extractionFor(units),
    );
    const pipeline = new XRayPipeline({ readThrough }, store, { extract } as XRayExtractionModel, {
      maxUnitsPerBatch: 2,
    });

    await expect(pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:40)')).resolves.toEqual({
      kind: 'updated',
      batchCount: 2,
      unitCount: 3,
      maxPositionIndex: 2,
    });
    expect(extract.mock.calls.map(([request]) => request.units.map((item) => item.unitId))).toEqual(
      [['unit-0', 'unit-1'], ['unit-2']],
    );
    await expect(store.getState(BOOK_HASH)).resolves.toMatchObject({
      fingerprint: fingerprint('index-1'),
      maxPositionIndex: 2,
    });
    await expect(store.listBatches(BOOK_HASH, 2)).resolves.toHaveLength(2);

    await expect(pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:40)')).resolves.toEqual({
      kind: 'current',
      batchCount: 0,
      unitCount: 0,
      maxPositionIndex: 2,
    });
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('keeps the last committed cursor when extraction fails and retries the pending batch', async () => {
    const readThrough = vi.fn().mockResolvedValue(slice('index-1', [0]));
    const extract = vi
      .fn<XRayExtractionModel['extract']>()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockImplementationOnce(async ({ units }) => extractionFor(units));
    const pipeline = new XRayPipeline({ readThrough }, store, { extract });

    await expect(pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:20)')).rejects.toThrow(
      'model unavailable',
    );
    await expect(store.getState(BOOK_HASH)).resolves.toMatchObject({
      maxPositionIndex: -1,
      pendingPositionIndex: 0,
      error: 'model unavailable',
    });

    await expect(pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:20)')).resolves.toMatchObject({
      kind: 'updated',
      maxPositionIndex: 0,
    });
    await expect(store.getState(BOOK_HASH)).resolves.toEqual(
      expect.not.objectContaining({ pendingPositionIndex: expect.anything() }),
    );
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('rebuilds only X-Ray-derived rows when the Reedy fingerprint changes', async () => {
    const readThrough = vi
      .fn()
      .mockResolvedValueOnce(slice('index-1', [0]))
      .mockResolvedValueOnce(slice('index-2', [0]));
    const extract = vi.fn(async ({ units }: { units: readonly XRaySourceUnit[] }) =>
      extractionFor(units),
    );
    const pipeline = new XRayPipeline({ readThrough }, store, { extract });

    await pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:20)');
    const firstBatch = (await store.listBatches(BOOK_HASH, 0))[0]!;
    await pipeline.update(BOOK_HASH, 'epubcfi(/6/2!/4/2/1:20)');

    const batches = await store.listBatches(BOOK_HASH, 0);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.fingerprint).toEqual(fingerprint('index-2'));
    expect(batches[0]!.batchId).not.toBe(firstBatch.batchId);
    await expect(store.getState(BOOK_HASH)).resolves.toMatchObject({
      fingerprint: fingerprint('index-2'),
    });
  });
});
