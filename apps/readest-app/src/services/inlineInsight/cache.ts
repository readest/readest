import type { InlineInsightChatMessage } from './logging';
import type { InlineInsightProvider, InlineInsightSettings } from './types';

const CACHE_PREFIX = 'readest.inlineInsight.v1.';
const MAX_CACHE_ENTRIES = 200;

export class InlineInsightCacheInput {
  constructor(
    settings: InlineInsightSettings,
    readonly messages: InlineInsightChatMessage[],
  ) {
    this.provider = settings.provider;
    this.model = settings.model;
    this.chatUrl = settings.chatUrl;
  }

  readonly provider: InlineInsightProvider;
  readonly model: string;
  readonly chatUrl: string;

  buildKey(): string {
    // Hash the request identity so repeated lookups can reuse results without leaking raw
    // book text into storage keys.
    return `${CACHE_PREFIX}${hashString(
      JSON.stringify([this.provider, this.chatUrl, this.model, this.messages]),
    )}`;
  }
}

export function readInlineInsightCache(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const value = storage.getItem(key);
    if (typeof value !== 'string') return null;
    if (!value.trim()) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writeInlineInsightCache(key: string, text: string): void {
  const storage = getLocalStorage();
  const normalizedText = text.trim();
  if (!storage || !normalizedText) return;

  try {
    storage.setItem(key, normalizedText);
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
  const keys = getInlineInsightCacheKeys(storage);
  const overflowCount = keys.length - MAX_CACHE_ENTRIES;
  if (overflowCount <= 0) return;

  for (const key of keys.slice(0, overflowCount)) {
    storage.removeItem(key);
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
