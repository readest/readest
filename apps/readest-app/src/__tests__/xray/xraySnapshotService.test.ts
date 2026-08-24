import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { XRaySourceSlice } from '@/services/ai/xray/source/ReedyXRaySource';
import { XRaySnapshotService } from '@/services/ai/xray/XRaySnapshotService';
import { XRayStore } from '@/services/ai/xray/storage/XRayStore';
import type {
  XRayBookFingerprint,
  XRayEntity,
  XRayExtractionBatch,
  XRaySourceUnit,
} from '@/services/ai/xray/types';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';

const BOOK_HASH = 'book-a';
const fingerprint: XRayBookFingerprint = { bookHash: BOOK_HASH, contentHash: 'index-1' };

const unit = (positionIndex: number, text: string): XRaySourceUnit => ({
  unitId: `unit-${positionIndex}`,
  startCfi: `epubcfi(/6/2!/4/2/1:${positionIndex * 20})`,
  endCfi: `epubcfi(/6/2!/4/2/1:${positionIndex * 20 + 19})`,
  sectionIndex: 0,
  positionIndex,
  text,
});

const sourceSlice = (units: XRaySourceUnit[]): XRaySourceSlice => ({
  fingerprint,
  units,
  maxPositionIndex: units.at(-1)?.positionIndex ?? -1,
});

const entity = (
  sourceUnit: XRaySourceUnit,
  description: string,
  aliases: string[] = [],
): XRayEntity => ({
  name: 'Alice',
  type: 'character',
  aliases,
  description,
  evidence: [
    {
      unitId: sourceUnit.unitId,
      exactQuote: 'Alice',
      startCfi: sourceUnit.startCfi,
      endCfi: sourceUnit.endCfi,
      sectionIndex: sourceUnit.sectionIndex,
      positionIndex: sourceUnit.positionIndex,
      confidence: 1,
      inferred: false,
    },
  ],
  facts: [
    {
      key: 'role',
      value: sourceUnit.positionIndex === 0 ? 'traveler' : 'investigator',
      evidence: [
        {
          unitId: sourceUnit.unitId,
          exactQuote: 'Alice',
          startCfi: sourceUnit.startCfi,
          endCfi: sourceUnit.endCfi,
          sectionIndex: sourceUnit.sectionIndex,
          positionIndex: sourceUnit.positionIndex,
          confidence: 1,
          inferred: false,
        },
      ],
    },
  ],
});

const batch = (sourceUnit: XRaySourceUnit, value: XRayEntity): XRayExtractionBatch => ({
  batchId: `batch-${sourceUnit.positionIndex}`,
  fingerprint,
  sourceUnitIds: [sourceUnit.unitId],
  minPositionIndex: sourceUnit.positionIndex,
  maxPositionIndex: sourceUnit.positionIndex,
  output: { entities: [value], relationships: [], events: [], claims: [] },
  createdAt: 1_000 + sourceUnit.positionIndex,
});

describe('XRaySnapshotService', () => {
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

  it('excludes future batches and merges repeated entities at the current bound', async () => {
    const firstUnit = unit(0, 'Alice arrived at the station.');
    const secondUnit = unit(1, 'Alice began the investigation.');
    await store.commitBatch(batch(firstUnit, entity(firstUnit, 'A traveler.')), {
      fingerprint,
      maxPositionIndex: 0,
      lastBatchId: 'batch-0',
      updatedAt: 1_000,
      version: 1,
    });
    await store.commitBatch(
      batch(secondUnit, entity(secondUnit, 'A determined investigator.', ['Al'])),
      {
        fingerprint,
        maxPositionIndex: 1,
        lastBatchId: 'batch-1',
        updatedAt: 1_001,
        version: 1,
      },
    );
    const readThrough = vi.fn(async (_bookHash: string, cfi: string) =>
      cfi === 'at-first' ? sourceSlice([firstUnit]) : sourceSlice([firstUnit, secondUnit]),
    );
    const service = new XRaySnapshotService({ readThrough }, store);

    const firstSnapshot = await service.getSnapshot(BOOK_HASH, 'at-first');
    expect(firstSnapshot.maxPositionIndex).toBe(0);
    expect(firstSnapshot.entities[0]).toMatchObject({
      name: 'Alice',
      aliases: [],
      description: 'A traveler.',
    });
    expect(firstSnapshot.entities[0]!.evidence).toHaveLength(1);

    const secondSnapshot = await service.getSnapshot(BOOK_HASH, 'at-second');
    expect(secondSnapshot.maxPositionIndex).toBe(1);
    expect(secondSnapshot.entities).toHaveLength(1);
    expect(secondSnapshot.entities[0]).toMatchObject({
      name: 'Alice',
      aliases: ['Al'],
      description: 'A determined investigator.',
    });
    expect(secondSnapshot.entities[0]!.evidence).toHaveLength(2);
    expect(secondSnapshot.entities[0]!.facts).toHaveLength(2);
  });

  it('invalidates fallback lookups when extraction adds an entity, then reuses the new cache', async () => {
    const sourceUnit = unit(0, 'Alice arrived at the station.');
    const readThrough = vi.fn().mockResolvedValue(sourceSlice([sourceUnit]));
    const listBatches = vi.spyOn(store, 'listBatches');
    const service = new XRaySnapshotService({ readThrough }, store);

    await expect(service.lookup(BOOK_HASH, 'at-first', 'Al', 'en')).resolves.toMatchObject({
      source: 'lexrank',
    });
    await store.commitBatch(batch(sourceUnit, entity(sourceUnit, 'A traveler.', ['Al'])), {
      fingerprint,
      maxPositionIndex: 0,
      lastBatchId: 'batch-0',
      updatedAt: 1_000,
      version: 1,
    });

    const extracted = await service.lookup(BOOK_HASH, 'at-first', ' Al ', 'en');
    expect(extracted).toMatchObject({
      term: 'Al',
      source: 'entity',
      maxPositionIndex: 0,
      entity: { name: 'Alice' },
    });
    expect(extracted.summary).toContain('A traveler.');

    await expect(service.lookup(BOOK_HASH, 'at-first', 'al', 'en')).resolves.toEqual(extracted);
    expect(listBatches).toHaveBeenCalledTimes(2);
  });

  it('falls back to bounded LexRank context when no extracted entity matches', async () => {
    const sourceUnit = unit(
      0,
      'The brass key opened the cellar. The key had belonged to the old caretaker.',
    );
    const service = new XRaySnapshotService(
      { readThrough: vi.fn().mockResolvedValue(sourceSlice([sourceUnit])) },
      store,
    );

    const result = await service.lookup(BOOK_HASH, 'at-first', 'brass key', 'en');

    expect(result.source).toBe('lexrank');
    expect(result.summary).toContain('brass key');
    expect(result.evidence).toEqual([
      expect.objectContaining({
        unitId: sourceUnit.unitId,
        exactQuote: expect.stringContaining('brass key'),
        positionIndex: 0,
        inferred: false,
      }),
    ]);
    expect(result.maxPositionIndex).toBe(0);
  });
});
