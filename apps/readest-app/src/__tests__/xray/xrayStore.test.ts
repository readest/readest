import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { XRayStore } from '@/services/ai/xray/storage/XRayStore';
import type {
  XRayBookFingerprint,
  XRayBookState,
  XRayExtractionBatch,
  XRayLookupCacheRow,
} from '@/services/ai/xray/types';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';

const fingerprint: XRayBookFingerprint = {
  bookHash: 'book-a',
  contentHash: 'content-a',
};

const makeBatch = (
  batchId: string,
  minPositionIndex: number,
  maxPositionIndex: number,
  batchFingerprint = fingerprint,
): XRayExtractionBatch => ({
  batchId,
  fingerprint: batchFingerprint,
  sourceUnitIds: [`unit-'${batchId}`],
  minPositionIndex,
  maxPositionIndex,
  output: { entities: [], relationships: [], events: [], claims: [] },
  createdAt: maxPositionIndex * 100,
});

const makeState = (
  maxPositionIndex: number,
  lastBatchId: string,
  updatedAt: number,
  stateFingerprint = fingerprint,
): XRayBookState => ({
  fingerprint: stateFingerprint,
  maxPositionIndex,
  lastBatchId,
  updatedAt,
  version: 1,
});

describe('XRayStore', () => {
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

  it('creates its local schema with empty book state', async () => {
    const tables = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'xray_%'
       ORDER BY name`,
    );

    expect(tables.map(({ name }) => name)).toEqual(['xray_batches', 'xray_books', 'xray_lookups']);
    await expect(store.getState('missing-book')).resolves.toBeNull();
  });

  it('commits batches with the cursor and filters them by the spoiler bound', async () => {
    const first = makeBatch('batch-1', 0, 9);
    const second = makeBatch('batch-2', 10, 19);
    await store.commitBatch(first, makeState(9, first.batchId, 1_000));

    const committedState = makeState(19, second.batchId, 2_000);
    await store.commitBatch(second, committedState);

    await expect(store.getState(fingerprint.bookHash)).resolves.toEqual(committedState);
    await expect(store.listBatches(fingerprint.bookHash, 9)).resolves.toEqual([first]);
    await expect(store.listBatches(fingerprint.bookHash, 19)).resolves.toEqual([first, second]);
  });

  it('makes duplicate commits idempotent without regressing the cursor', async () => {
    const batch = makeBatch('batch-1', 0, 9);
    const committedState = makeState(9, batch.batchId, 1_000);
    await store.commitBatch(batch, committedState);
    const later = makeBatch('batch-2', 10, 19);
    const laterState = makeState(19, later.batchId, 2_000);
    await store.commitBatch(later, laterState);

    await expect(store.commitBatch(batch, committedState)).resolves.toBeUndefined();
    await expect(store.getState(fingerprint.bookHash)).resolves.toEqual(laterState);
    await expect(store.listBatches(fingerprint.bookHash, 19)).resolves.toEqual([batch, later]);
  });

  it('persists state metadata when a batch commit keeps the same cursor', async () => {
    const batch = makeBatch('batch-1', 0, 9);
    const committedState = makeState(9, batch.batchId, 1_000);
    await store.commitBatch(batch, committedState);
    const refreshedState: XRayBookState = {
      ...committedState,
      pendingPositionIndex: 10,
      updatedAt: 2_000,
      error: 'retry pending',
    };

    await store.commitBatch(batch, refreshedState);

    await expect(store.getState(fingerprint.bookHash)).resolves.toEqual(refreshedState);
  });

  it('does not let a stale generation replace the current state', async () => {
    const first = makeBatch('batch-1', 0, 9);
    await store.commitBatch(first, makeState(9, first.batchId, 1_000));

    const nextFingerprint = { ...fingerprint, contentHash: 'content-b' };
    await store.clearBook(fingerprint.bookHash);
    const next = makeBatch('batch-next', 0, 9, nextFingerprint);
    const nextState = makeState(9, next.batchId, 3_000, nextFingerprint);
    await store.commitBatch(next, nextState);
    const staleState = makeState(9, first.batchId, 4_000);
    await store.commitBatch(first, staleState);
    await store.saveState(staleState);

    await expect(store.getState(fingerprint.bookHash)).resolves.toEqual(nextState);
  });

  it('clears one book without affecting another and round-trips lookup cache entries', async () => {
    const otherFingerprint: XRayBookFingerprint = {
      bookHash: 'book-b',
      contentHash: 'content-b',
    };
    const firstBookBatch = makeBatch('shared-batch-id', 0, 9);
    const otherBookBatch = makeBatch('shared-batch-id', 0, 9, otherFingerprint);
    await store.commitBatch(firstBookBatch, makeState(9, firstBookBatch.batchId, 1_000));
    await store.commitBatch(
      otherBookBatch,
      makeState(9, otherBookBatch.batchId, 1_000, otherFingerprint),
    );

    const lookup: XRayLookupCacheRow = {
      key: "term:o'brien",
      bookHash: fingerprint.bookHash,
      maxPositionIndex: 9,
      fingerprint,
      result: {
        term: "O'Brien",
        summary: 'A cached summary',
        evidence: [],
        source: 'lexrank',
        maxPositionIndex: 9,
      },
    };
    await store.saveLookup(lookup);
    await expect(
      store.getLookup(lookup.key, lookup.bookHash, lookup.maxPositionIndex, lookup.fingerprint),
    ).resolves.toEqual(lookup.result);

    await store.clearBook(fingerprint.bookHash);

    await expect(store.getState(fingerprint.bookHash)).resolves.toBeNull();
    await expect(store.listBatches(fingerprint.bookHash, 9)).resolves.toEqual([]);
    await expect(
      store.getLookup(lookup.key, lookup.bookHash, lookup.maxPositionIndex, lookup.fingerprint),
    ).resolves.toBeNull();
    await expect(store.listBatches(otherFingerprint.bookHash, 9)).resolves.toEqual([
      otherBookBatch,
    ]);
  });
});
