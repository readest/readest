import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { InMemoryHlcStore, LocalStorageHlcStore, HLC_LOCAL_STORAGE_KEY } from '@/libs/hlcStore';

describe('InMemoryHlcStore', () => {
  test('initial load returns null', () => {
    const store = new InMemoryHlcStore();
    expect(store.load()).toBe(null);
  });

  test('save then load roundtrips', () => {
    const store = new InMemoryHlcStore();
    store.save({ physicalMs: 1700, counter: 7 });
    expect(store.load()).toEqual({ physicalMs: 1700, counter: 7 });
  });

  test('save replaces previous snapshot', () => {
    const store = new InMemoryHlcStore();
    store.save({ physicalMs: 100, counter: 0 });
    store.save({ physicalMs: 200, counter: 5 });
    expect(store.load()).toEqual({ physicalMs: 200, counter: 5 });
  });
});

describe('LocalStorageHlcStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('initial load returns null', () => {
    expect(new LocalStorageHlcStore().load()).toBe(null);
  });

  test('save persists to localStorage under the canonical key', () => {
    new LocalStorageHlcStore().save({ physicalMs: 1700, counter: 3 });
    const raw = localStorage.getItem(HLC_LOCAL_STORAGE_KEY);
    expect(raw).not.toBe(null);
    expect(JSON.parse(raw!)).toEqual({ physicalMs: 1700, counter: 3 });
  });

  test('save then load roundtrips', () => {
    const store = new LocalStorageHlcStore();
    store.save({ physicalMs: 1700, counter: 3 });
    expect(store.load()).toEqual({ physicalMs: 1700, counter: 3 });
  });

  test('survives across instances (different store reads same key)', () => {
    new LocalStorageHlcStore().save({ physicalMs: 999, counter: 11 });
    expect(new LocalStorageHlcStore().load()).toEqual({ physicalMs: 999, counter: 11 });
  });

  test('returns null on corrupted JSON instead of throwing', () => {
    localStorage.setItem(HLC_LOCAL_STORAGE_KEY, '{not-valid-json');
    expect(new LocalStorageHlcStore().load()).toBe(null);
  });

  test('returns null when localStorage unavailable (server-side)', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage not available');
      },
    });
    try {
      expect(new LocalStorageHlcStore().load()).toBe(null);
      expect(() => new LocalStorageHlcStore().save({ physicalMs: 1, counter: 0 })).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});
