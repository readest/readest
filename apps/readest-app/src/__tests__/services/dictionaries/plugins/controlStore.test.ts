import { afterEach, describe, expect, test, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DictionaryPluginControlStore } from '@/services/dictionaries/plugins/controlStore';
import type { DatabaseService } from '@/types/database';

describe('DictionaryPluginControlStore', () => {
  let db: DatabaseService | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  test('admits one mutation lease and allows takeover after release or expiry', async () => {
    let now = 1_000;
    db = await NodeDatabaseService.open(':memory:');
    const store = new DictionaryPluginControlStore(db, {
      now: () => now,
      createId: () => `id-${now}`,
      deleteDatabase: vi.fn(async () => undefined),
    });
    await store.initialize();

    const lease = await store.acquireLease('dict-1', 'build', 100);
    await expect(store.acquireLease('dict-1', 'remove', 100)).rejects.toThrow(/busy/i);
    await store.releaseLease(lease);
    await expect(store.acquireLease('dict-1', 'build', 100)).resolves.toMatchObject({
      dictionaryId: 'dict-1',
    });

    now = 2_000;
    await expect(store.acquireLease('dict-1', 'build', 100)).resolves.toMatchObject({
      dictionaryId: 'dict-1',
    });
  });

  test('renews a live lease and collects staging indexes after the lease expires', async () => {
    let now = 1_000;
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    const store = new DictionaryPluginControlStore(db, {
      now: () => now,
      createId: () => 'owner-1',
      deleteDatabase,
    });
    await store.initialize();

    const lease = await store.acquireLease('dict-1', 'build', 100);
    await store.stageGeneration(lease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    now = 1_090;
    await expect(store.renewLease(lease, 100)).resolves.toMatchObject({ expiresAt: 1_190 });

    now = 1_150;
    await store.cleanupTombstones();
    expect(await store.getGeneration('dict-1', 'build-1')).toBeDefined();
    expect(deleteDatabase).not.toHaveBeenCalled();

    now = 1_200;
    await store.cleanupTombstones();
    expect(deleteDatabase).toHaveBeenCalledWith('index-1.db');
    expect(await store.getGeneration('dict-1', 'build-1')).toBeUndefined();
  });

  test('atomically swaps generations and retires the previous index only after health', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    let id = 0;
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => `owner-${++id}`,
      deleteDatabase,
    });
    await store.initialize();

    const firstLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(firstLease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    await store.activateGeneration(firstLease, 'build-1');
    await store.releaseLease(firstLease);
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({
      buildId: 'build-1',
      databasePath: 'index-1.db',
      state: 'active',
    });

    const secondLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(secondLease, 'readest.yomitan', 'build-2', 'index-2.db', 1);
    await store.activateGeneration(secondLease, 'build-2');
    await store.releaseLease(secondLease);
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({ buildId: 'build-2' });
    expect(deleteDatabase).not.toHaveBeenCalled();

    await store.markGenerationHealthy('dict-1', 'build-2');
    expect(deleteDatabase).toHaveBeenCalledWith('index-1.db');
    expect(await store.getGeneration('dict-1', 'build-1')).toBeUndefined();
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({ state: 'healthy' });
  });

  test('rolls an unhealthy activation back to its retained predecessor', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    let id = 0;
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => `owner-${++id}`,
      deleteDatabase,
    });
    await store.initialize();

    for (const [buildId, path] of [
      ['build-1', 'index-1.db'],
      ['build-2', 'index-2.db'],
    ] as const) {
      const lease = await store.acquireLease('dict-1', 'build');
      await store.stageGeneration(lease, 'readest.yomitan', buildId, path, 1);
      await store.activateGeneration(lease, buildId);
      await store.releaseLease(lease);
      if (buildId === 'build-1') await store.markGenerationHealthy('dict-1', buildId);
    }

    await store.rollbackUnhealthyGeneration('dict-1', 'build-2');
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({ buildId: 'build-1' });
    expect(deleteDatabase).toHaveBeenCalledWith('index-2.db');
  });

  test('does not discard a generation after a newer build retains it for rollback', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    let id = 0;
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => `owner-${++id}`,
      deleteDatabase,
    });
    await store.initialize();

    const firstLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(firstLease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    await store.activateGeneration(firstLease, 'build-1');
    await store.releaseLease(firstLease);
    await store.markGenerationHealthy('dict-1', 'build-1');

    const secondLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(secondLease, 'readest.yomitan', 'build-2', 'index-2.db', 1);
    await store.activateGeneration(secondLease, 'build-2');
    await store.releaseLease(secondLease);

    await store.discardFailedGeneration('dict-1', 'build-1', 'active');

    expect(await store.getGeneration('dict-1', 'build-1')).toMatchObject({ state: 'previous' });
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({ buildId: 'build-2' });
    expect(deleteDatabase).not.toHaveBeenCalledWith('index-1.db');

    await store.rollbackUnhealthyGeneration('dict-1', 'build-2');
    expect(await store.getActiveGeneration('dict-1')).toMatchObject({ buildId: 'build-1' });
    expect(deleteDatabase).toHaveBeenCalledWith('index-2.db');
  });

  test.each([
    [
      'roll back',
      (store: DictionaryPluginControlStore) =>
        store.rollbackUnhealthyGeneration('dict-1', 'build-2'),
    ],
    [
      'discard',
      (store: DictionaryPluginControlStore) =>
        store.discardFailedGeneration('dict-1', 'build-2', 'active'),
    ],
  ])('does not %s a generation after another verifier marks it healthy', async (_label, mutate) => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    let id = 0;
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => `owner-${++id}`,
      deleteDatabase,
    });
    await store.initialize();

    const firstLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(firstLease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    await store.activateGeneration(firstLease, 'build-1');
    await store.releaseLease(firstLease);
    await store.markGenerationHealthy('dict-1', 'build-1');

    const secondLease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(secondLease, 'readest.yomitan', 'build-2', 'index-2.db', 1);
    await store.activateGeneration(secondLease, 'build-2');
    await store.releaseLease(secondLease);
    await store.markGenerationHealthy('dict-1', 'build-2');
    deleteDatabase.mockClear();

    await mutate(store);

    expect(await store.getActiveGeneration('dict-1')).toMatchObject({
      buildId: 'build-2',
      state: 'healthy',
    });
    expect(await store.getGeneration('dict-1', 'build-2')).toMatchObject({ state: 'healthy' });
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  test('discards a broken healthy generation when that is the caller snapshot', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => 'owner-1',
      deleteDatabase,
    });
    await store.initialize();

    const lease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(lease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    await store.activateGeneration(lease, 'build-1');
    await store.releaseLease(lease);
    await store.markGenerationHealthy('dict-1', 'build-1');

    await store.discardFailedGeneration('dict-1', 'build-1', 'healthy');

    expect(await store.getActiveGeneration('dict-1')).toBeUndefined();
    expect(await store.getGeneration('dict-1', 'build-1')).toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalledWith('index-1.db');
  });

  test('removes an unhealthy first activation when there is no rollback target', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async () => undefined);
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => 'owner-1',
      deleteDatabase,
    });
    await store.initialize();

    const lease = await store.acquireLease('dict-1', 'build');
    await store.stageGeneration(lease, 'readest.yomitan', 'build-1', 'index-1.db', 1);
    await store.activateGeneration(lease, 'build-1');
    await store.releaseLease(lease);

    await store.rollbackUnhealthyGeneration('dict-1', 'build-1');

    expect(await store.getActiveGeneration('dict-1')).toBeUndefined();
    expect(await store.getGeneration('dict-1', 'build-1')).toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalledWith('index-1.db');
  });

  test('tombstones and removes every derived index when a dictionary is deleted', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const deleteDatabase = vi.fn(async (path: string) => {
      if (path === 'index-busy.db') throw new Error('database is busy');
    });
    let id = 0;
    const store = new DictionaryPluginControlStore(db, {
      now: () => 1_000,
      createId: () => `owner-${++id}`,
      deleteDatabase,
    });
    await store.initialize();

    for (const [buildId, path] of [
      ['build-active', 'index-active.db'],
      ['build-busy', 'index-busy.db'],
    ] as const) {
      const lease = await store.acquireLease('dict-1', 'build');
      await store.stageGeneration(lease, 'readest.yomitan', buildId, path, 1);
      if (buildId === 'build-active') await store.activateGeneration(lease, buildId);
      await store.releaseLease(lease);
    }

    await store.removeDictionary('dict-1');

    expect(deleteDatabase).toHaveBeenCalledWith('index-active.db');
    expect(deleteDatabase).toHaveBeenCalledWith('index-busy.db');
    expect(await store.getActiveGeneration('dict-1')).toBeUndefined();
    expect(await store.getGeneration('dict-1', 'build-active')).toBeUndefined();
    expect(await store.getGeneration('dict-1', 'build-busy')).toMatchObject({
      state: 'tombstoned',
    });

    deleteDatabase.mockResolvedValue(undefined);
    await store.cleanupTombstones();
    expect(await store.getGeneration('dict-1', 'build-busy')).toBeUndefined();
  });
});
