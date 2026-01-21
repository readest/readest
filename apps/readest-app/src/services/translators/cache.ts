import { TranslationCache } from './types';

const DB_NAME = 'TranslationCache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

interface CacheEntry {
  key: string;
  translation: string;
  timestamp: number;
  provider: string;
  sourceLang: string;
  targetLang: string;
  originalText: string;
}

const memoryCache: TranslationCache = {};
const memoryTimestamps: Record<string, number> = {};

const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn('IndexedDB not supported. Using in-memory cache only.');
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event);
      reject(new Error('Could not open IndexedDB'));
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('provider', 'provider', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

export const loadCacheFromDB = async (
  options: {
    maxAge?: number;
    maxEntries?: number;
    onlyLoadProviders?: string[];
    onlyLoadLanguages?: { source?: string[]; target?: string[] };
  } = {},
): Promise<void> => {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    let request: IDBRequest;
    if (options.onlyLoadProviders && options.onlyLoadProviders.length > 0) {
      const providerPromises = options.onlyLoadProviders.map((provider) => {
        return new Promise<CacheEntry[]>((resolve) => {
          const providerIndex = store.index('provider');
          const request = providerIndex.getAll(provider);

          request.onsuccess = () => {
            resolve(request.result);
          };

          request.onerror = () => {
            resolve([]);
          };
        });
      });

      const allEntries = (await Promise.all(providerPromises)).flat();
      processLoadedEntries(allEntries, options);
    } else {
      request = store.getAll();

      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        processLoadedEntries(entries, options);
      };

      request.onerror = (event) => {
        console.error('Error loading cache from IndexedDB:', event);
      };
    }

    transaction.oncomplete = () => {
      db.close();
    };
  } catch (error) {
    console.error('Failed to load cache from IndexedDB:', error);
  }
};

const processLoadedEntries = (
  entries: CacheEntry[],
  options: {
    maxAge?: number;
    maxEntries?: number;
    onlyLoadLanguages?: { source?: string[]; target?: string[] };
  },
): void => {
  let filteredEntries = entries;

  if (options.maxAge) {
    const cutoff = Date.now() - options.maxAge;
    filteredEntries = filteredEntries.filter((entry) => entry.timestamp >= cutoff);
  }

  if (options.onlyLoadLanguages) {
    if (options.onlyLoadLanguages.source && options.onlyLoadLanguages.source.length > 0) {
      filteredEntries = filteredEntries.filter((entry) =>
        options.onlyLoadLanguages!.source!.includes(entry.sourceLang),
      );
    }

    if (options.onlyLoadLanguages.target && options.onlyLoadLanguages.target.length > 0) {
      filteredEntries = filteredEntries.filter((entry) =>
        options.onlyLoadLanguages!.target!.includes(entry.targetLang),
      );
    }
  }

  if (options.maxEntries && filteredEntries.length > options.maxEntries) {
    filteredEntries.sort((a, b) => b.timestamp - a.timestamp);
    filteredEntries = filteredEntries.slice(0, options.maxEntries);
  }

  filteredEntries.forEach((entry) => {
    memoryCache[entry.key] = entry.translation;
    memoryTimestamps[entry.key] = entry.timestamp;
  });

  // console.log(`Loaded ${filteredEntries.length} translations into memory cache`);
};

export const getCacheKey = (
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: string,
): string => {
  return `${provider}:${sourceLang}:${targetLang}:${text}`;
};

export const getFromCache = async (
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: string,
): Promise<string | null> => {
  if (!text?.trim()) return null;

  const key = getCacheKey(text, sourceLang, targetLang, provider);

  if (memoryCache[key]) {
    return memoryCache[key];
  }

  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        const entry = request.result as CacheEntry;
        if (entry) {
          memoryCache[key] = entry.translation;
          memoryTimestamps[key] = entry.timestamp;
          resolve(entry.translation);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        resolve(null);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
    return null;
  }
};

export const storeInCache = async (
  text: string,
  translation: string,
  sourceLang: string,
  targetLang: string,
  provider: string,
): Promise<void> => {
  if (!text?.trim() || !translation) return;

  const key = getCacheKey(text, sourceLang, targetLang, provider);
  const timestamp = Date.now();

  memoryCache[key] = translation;
  memoryTimestamps[key] = timestamp;

  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const entry: CacheEntry = {
      key,
      translation,
      timestamp,
      provider,
      sourceLang,
      targetLang,
      originalText: text,
    };

    store.put(entry);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Error storing in IndexedDB:', event);
        reject(new Error('Failed to store in IndexedDB'));
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
  }
};

export interface CacheFilterOptions {
  provider?: string;
  maxAge?: number;
}

export const clearCache = async (filter?: CacheFilterOptions): Promise<number> => {
  let deletedCount = 0;

  if (!filter) {
    const count = Object.keys(memoryCache).length;
    Object.keys(memoryCache).forEach((key) => {
      delete memoryCache[key];
      delete memoryTimestamps[key];
    });
    deletedCount = count;
  } else {
    const keysToDelete: string[] = [];

    Object.keys(memoryCache).forEach((key) => {
      let shouldDelete = true;

      if (filter.provider) {
        const parts = key.split(':');
        const provider = parts[0];

        if (filter.provider && provider !== filter.provider) {
          shouldDelete = false;
        }
      }

      if (shouldDelete && filter.maxAge && memoryTimestamps[key]) {
        const timestamp = memoryTimestamps[key];
        if (Date.now() - timestamp < filter.maxAge) {
          shouldDelete = false;
        }
      }

      if (shouldDelete) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => {
      delete memoryCache[key];
      delete memoryTimestamps[key];
    });

    deletedCount = keysToDelete.length;
  }

  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    if (!filter) {
      store.clear();
    } else {
      const request = store.getAll();

      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        const filteredEntries = entries.filter((entry) => {
          if (filter.provider && entry.provider !== filter.provider) {
            return false;
          }

          if (filter.maxAge && Date.now() - entry.timestamp >= filter.maxAge) {
            return true;
          }

          return true;
        });

        filteredEntries.forEach((entry) => {
          store.delete(entry.key);
        });
      };
    }

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        db.close();
        resolve(deletedCount);
      };

      transaction.onerror = () => {
        db.close();
        resolve(deletedCount);
      };
    });
  } catch (error) {
    console.error('Error clearing IndexedDB cache:', error);
    return deletedCount;
  }
};

export const getCacheStats = async (
  includeDB: boolean = false,
): Promise<{
  memoryCacheEntries: number;
  memoryCacheSizeInBytes: number;
  dbCacheEntries?: number;
  dbCacheSizeInBytes?: number;
  totalEntries?: number;
  totalSizeInBytes?: number;
}> => {
  const memoryCacheEntries = Object.keys(memoryCache).length;

  let memoryCacheSizeInBytes = 0;
  for (const key in memoryCache) {
    memoryCacheSizeInBytes += key.length;

    const value = memoryCache[key] || '';
    memoryCacheSizeInBytes += value.length;
  }

  if (!includeDB) {
    return { memoryCacheEntries, memoryCacheSizeInBytes };
  }

  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();

    return new Promise((resolve) => {
      countRequest.onsuccess = () => {
        const dbCacheEntries = countRequest.result;

        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const entries = getAllRequest.result as CacheEntry[];

          let dbCacheSizeInBytes = 0;
          entries.forEach((entry) => {
            const entryString = JSON.stringify(entry);
            dbCacheSizeInBytes += entryString.length;
          });

          const totalEntries =
            memoryCacheEntries + dbCacheEntries - Math.min(memoryCacheEntries, dbCacheEntries);

          const totalSizeInBytes = memoryCacheSizeInBytes + dbCacheSizeInBytes;

          resolve({
            memoryCacheEntries,
            memoryCacheSizeInBytes,
            dbCacheEntries,
            dbCacheSizeInBytes,
            totalEntries,
            totalSizeInBytes,
          });
        };
      };

      transaction.oncomplete = () => {
        db.close();
      };

      transaction.onerror = () => {
        db.close();
        resolve({
          memoryCacheEntries,
          memoryCacheSizeInBytes,
        });
      };
    });
  } catch (error) {
    console.error('Error getting IndexedDB stats:', error);
    return { memoryCacheEntries, memoryCacheSizeInBytes };
  }
};

export const pruneCache = async (
  options: {
    maxAge?: number;
    maxEntries?: number;
    maxSizeInBytes?: number;
    dryRun?: boolean;
  } = {},
): Promise<number> => {
  const { maxAge, maxEntries, maxSizeInBytes, dryRun = false } = options;

  if (!maxAge && !maxEntries && !maxSizeInBytes) {
    return 0;
  }

  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, dryRun ? 'readonly' : 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getAllRequest = store.getAll();

    return new Promise((resolve) => {
      getAllRequest.onsuccess = () => {
        const entries = getAllRequest.result as CacheEntry[];
        const entriesToPrune: CacheEntry[] = [];

        if (maxAge) {
          const cutoffTime = Date.now() - maxAge;
          const agedEntries = entries.filter((entry) => entry.timestamp < cutoffTime);
          entriesToPrune.push(...agedEntries);
        }

        if (maxEntries && entries.length > maxEntries) {
          const sortedEntries = [...entries].sort((a, b) => a.timestamp - b.timestamp);
          const excessEntries = sortedEntries.slice(0, entries.length - maxEntries);

          const prunedKeys = new Set(entriesToPrune.map((e) => e.key));
          excessEntries.forEach((entry) => {
            if (!prunedKeys.has(entry.key)) {
              entriesToPrune.push(entry);
            }
          });
        }

        if (maxSizeInBytes) {
          let currentSize = 0;
          entries.forEach((entry) => {
            const entryString = JSON.stringify(entry);
            currentSize += entryString.length;
          });

          if (currentSize > maxSizeInBytes) {
            const remainingEntries = entries
              .filter((entry) => !entriesToPrune.some((e) => e.key === entry.key))
              .sort((a, b) => a.timestamp - b.timestamp);

            let sizeToRemove = currentSize - maxSizeInBytes;
            const prunedKeys = new Set(entriesToPrune.map((e) => e.key));

            for (const entry of remainingEntries) {
              if (sizeToRemove <= 0) break;

              if (!prunedKeys.has(entry.key)) {
                const entryString = JSON.stringify(entry);
                const entrySize = entryString.length * 2;

                entriesToPrune.push(entry);
                prunedKeys.add(entry.key);
                sizeToRemove -= entrySize;
              }
            }
          }
        }

        const pruneCount = entriesToPrune.length;

        if (!dryRun && pruneCount > 0) {
          entriesToPrune.forEach((entry) => {
            store.delete(entry.key);

            delete memoryCache[entry.key];
            delete memoryTimestamps[entry.key];
          });
        }

        resolve(pruneCount);
      };

      getAllRequest.onerror = () => {
        resolve(0);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Error pruning cache:', error);
    return 0;
  }
};

export const initCache = async (
  options: {
    preload?: boolean;
    preloadOptions?: {
      maxAge?: number;
      maxEntries?: number;
      onlyLoadProviders?: string[];
      onlyLoadLanguages?: { source?: string[]; target?: string[] };
    };
    autoPrune?: boolean;
    pruneInterval?: number;
    pruneOptions?: {
      maxAge?: number;
      maxEntries?: number;
      maxSizeInBytes?: number;
    };
  } = {},
): Promise<() => void> => {
  const {
    preload = true,
    preloadOptions = {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      maxEntries: 10000,
    },
    autoPrune = true,
    pruneInterval = 60 * 60 * 1000,
    pruneOptions = {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      maxEntries: 100000,
      maxSizeInBytes: 10 * 1024 * 1024,
    },
  } = options;

  if (preload) {
    await loadCacheFromDB(preloadOptions);
  }

  let intervalId: number | null = null;

  if (autoPrune) {
    await pruneCache(pruneOptions);

    intervalId = window.setInterval(async () => {
      await pruneCache(pruneOptions);
    }, pruneInterval);
  }

  return () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
  };
};

let cleanupFunction: (() => void) | null = null;

if (typeof window !== 'undefined') {
  initCache().then((cleanup) => {
    cleanupFunction = cleanup;
  });

  window.addEventListener('beforeunload', () => {
    if (cleanupFunction) {
      cleanupFunction();
    }
  });
}
