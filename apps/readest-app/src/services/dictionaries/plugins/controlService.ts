import type { AppService } from '@/types/system';
import { DictionaryPluginControlStore } from './controlStore';

let stores = new WeakMap<AppService, Promise<DictionaryPluginControlStore>>();

export const getDictionaryPluginControlStore = (
  appService: AppService,
): Promise<DictionaryPluginControlStore> => {
  const cached = stores.get(appService);
  if (cached) return cached;
  const created = (async () => {
    const db = await appService.openDatabase(
      'dictionary-plugin-control',
      'dictionary-plugin-control.sqlite3',
      'Dictionaries',
    );
    try {
      const store = new DictionaryPluginControlStore(db, {
        deleteDatabase: (path) => appService.deleteDatabase(path, 'Dictionaries'),
      });
      await store.initialize();
      await store.cleanupTombstones();
      return store;
    } catch (error) {
      await db.close().catch(() => undefined);
      throw error;
    }
  })();
  stores.set(appService, created);
  void created.catch(() => {
    if (stores.get(appService) === created) stores.delete(appService);
  });
  return created;
};

export const __resetDictionaryPluginControlStoresForTests = (): void => {
  stores = new WeakMap();
};
