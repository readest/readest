import { afterEach, describe, expect, test, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  __resetDictionaryPluginControlStoresForTests,
  getDictionaryPluginControlStore,
} from '@/services/dictionaries/plugins/controlService';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

describe('dictionary plugin control service', () => {
  let db: DatabaseService | undefined;

  afterEach(async () => {
    __resetDictionaryPluginControlStoresForTests();
    await db?.close();
    db = undefined;
  });

  test('retries initialization after a transient database-open failure', async () => {
    db = await NodeDatabaseService.open(':memory:');
    const openDatabase = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient open failure'))
      .mockResolvedValue(db);
    const appService = {
      openDatabase,
      deleteDatabase: vi.fn(async () => undefined),
    } as unknown as AppService;

    await expect(getDictionaryPluginControlStore(appService)).rejects.toThrow(
      'transient open failure',
    );
    await expect(getDictionaryPluginControlStore(appService)).resolves.toBeDefined();
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });

  test('closes an opened database when control-store initialization fails', async () => {
    const close = vi.fn(async () => undefined);
    const brokenDb = {
      execute: vi.fn().mockRejectedValue(new Error('initialize failed')),
      close,
    } as unknown as DatabaseService;
    const appService = {
      openDatabase: vi.fn().mockResolvedValue(brokenDb),
      deleteDatabase: vi.fn(async () => undefined),
    } as unknown as AppService;

    await expect(getDictionaryPluginControlStore(appService)).rejects.toThrow('initialize failed');
    expect(close).toHaveBeenCalledOnce();
  });
});
