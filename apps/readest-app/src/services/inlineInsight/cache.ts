const CACHE_PREFIX = 'readest.inlineInsight.v1.';
const MAX_CACHE_ENTRIES = 50;

export interface InlineInsightCacheInput {
  provider: string;
  baseUrl: string;
  model: string;
  questionDirections: string[];
  uiLanguage: string;
  selectedText: string;
  context: string;
}

interface InlineInsightCacheEntry {
  createdAt: number;
  text: string;
}

export function buildInlineInsightCacheKey(input: InlineInsightCacheInput): string {
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

export function readInlineInsightCache(key: string, ttlMinutes: number): string | null {
  const storage = getLocalStorage();
  if (!storage || ttlMinutes <= 0) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<InlineInsightCacheEntry>;
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

export function writeInlineInsightCache(key: string, text: string): void {
  const storage = getLocalStorage();
  const normalizedText = text.trim();
  if (!storage || !normalizedText) return;

  try {
    storage.setItem(
      key,
      JSON.stringify({
        createdAt: Date.now(),
        text: normalizedText,
      } satisfies InlineInsightCacheEntry),
    );
    pruneInlineInsightCache(storage);
  } catch {
    // localStorage can be unavailable or full; cache failures should not affect reading.
  }
}

export function clearInlineInsightCache(): void {
  const storage = getLocalStorage();
  if (!storage) return;

  for (const key of getInlineInsightCacheKeys(storage)) {
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

function pruneInlineInsightCache(storage: Storage): void {
  const entries = getInlineInsightCacheKeys(storage)
    .map((key) => {
      try {
        const entry = JSON.parse(storage.getItem(key) ?? '') as Partial<InlineInsightCacheEntry>;
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

function getInlineInsightCacheKeys(storage: Storage): string[] {
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
