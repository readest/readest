const CACHE_PREFIX = 'readest.smartAsk.v1.';
const MAX_CACHE_ENTRIES = 50;

export interface SmartAskCacheInput {
  provider: string;
  baseUrl: string;
  model: string;
  questionDirections: string[];
  uiLanguage: string;
  selectedText: string;
  context: string;
}

interface SmartAskCacheEntry {
  createdAt: number;
  text: string;
}

export function buildSmartAskCacheKey(input: SmartAskCacheInput): string {
  return `${CACHE_PREFIX}${hashString(
    JSON.stringify([
      input.provider,
      input.baseUrl,
      input.model,
      input.questionDirections,
      input.uiLanguage,
      input.selectedText,
      input.context,
    ]),
  )}`;
}

export function readSmartAskCache(key: string, ttlMinutes: number): string | null {
  const storage = getLocalStorage();
  if (!storage || ttlMinutes <= 0) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<SmartAskCacheEntry>;
    if (typeof entry.createdAt !== 'number' || typeof entry.text !== 'string') return null;
    if (!entry.text.trim()) {
      storage.removeItem(key);
      return null;
    }

    const ttlMs = ttlMinutes * 60 * 1000;
    if (Date.now() - entry.createdAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return entry.text;
  } catch {
    return null;
  }
}

export function writeSmartAskCache(key: string, text: string): void {
  const storage = getLocalStorage();
  const normalizedText = text.trim();
  if (!storage || !normalizedText) return;

  try {
    storage.setItem(
      key,
      JSON.stringify({ createdAt: Date.now(), text: normalizedText } satisfies SmartAskCacheEntry),
    );
    pruneSmartAskCache(storage);
  } catch {
    // localStorage can be unavailable or full; cache failures should not affect reading.
  }
}

export function clearSmartAskCache(): void {
  const storage = getLocalStorage();
  if (!storage) return;

  for (const key of getSmartAskCacheKeys(storage)) {
    storage.removeItem(key);
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function pruneSmartAskCache(storage: Storage): void {
  const entries = getSmartAskCacheKeys(storage)
    .map((key) => {
      try {
        const entry = JSON.parse(storage.getItem(key) ?? '') as Partial<SmartAskCacheEntry>;
        return { key, createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0 };
      } catch {
        return { key, createdAt: 0 };
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  for (const entry of entries.slice(MAX_CACHE_ENTRIES)) {
    storage.removeItem(entry.key);
  }
}

function getSmartAskCacheKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
