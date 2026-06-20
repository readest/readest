import { describe, it, expect, vi } from 'vitest';
import { selectBackend, type RetrievalBackend } from '@/services/ai/adapters/retrievalBackend';
import { ReedySourceStore } from '@/services/ai/adapters/reedySourceStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';
import type { RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';

const fakeLegacy: RetrievalBackend = {
  kind: 'legacy-idb',
  isIndexed: vi.fn(async () => true),
  indexBook: vi.fn(async () => {}),
  clearBook: vi.fn(async () => {}),
};

const fakeReedy: RetrievalBackend = {
  kind: 'reedy',
  isIndexed: vi.fn(async () => true),
  indexBook: vi.fn(async () => {}),
  clearBook: vi.fn(async () => {}),
};

function settingsWith(reedyEnabled: boolean): AISettings {
  return { ...DEFAULT_AI_SETTINGS, enabled: true, reedy: { enabled: reedyEnabled } };
}

describe('selectBackend', () => {
  it('returns Reedy when reedy.enabled=true and isTauri=true and a reedy backend is provided', () => {
    const out = selectBackend({
      settings: settingsWith(true),
      isTauri: true,
      legacy: fakeLegacy,
      reedy: fakeReedy,
    });
    expect(out.kind).toBe('reedy');
  });

  it('falls back to Legacy on web (isTauri=false) even when reedy.enabled=true', () => {
    const out = selectBackend({
      settings: settingsWith(true),
      isTauri: false,
      legacy: fakeLegacy,
      reedy: fakeReedy,
    });
    expect(out.kind).toBe('legacy-idb');
  });

  it('falls back to Legacy when reedy.enabled=false even on Tauri', () => {
    const out = selectBackend({
      settings: settingsWith(false),
      isTauri: true,
      legacy: fakeLegacy,
      reedy: fakeReedy,
    });
    expect(out.kind).toBe('legacy-idb');
  });

  it('falls back to Legacy when reedy backend is missing (constructor failed)', () => {
    const out = selectBackend({
      settings: settingsWith(true),
      isTauri: true,
      legacy: fakeLegacy,
      reedy: null,
    });
    expect(out.kind).toBe('legacy-idb');
  });

  it('treats missing reedy settings field as disabled', () => {
    const out = selectBackend({
      settings: { ...DEFAULT_AI_SETTINGS, enabled: true, reedy: undefined },
      isTauri: true,
      legacy: fakeLegacy,
      reedy: fakeReedy,
    });
    expect(out.kind).toBe('legacy-idb');
  });
});

describe('ReedySourceStore', () => {
  function chunk(id: string, text: string): RetrievedChunk {
    return {
      id,
      bookHash: 'bk1',
      cfi: `epubcfi(${id})`,
      endCfi: `epubcfi(${id}-end)`,
      sectionIndex: 0,
      chapterTitle: 'Ch1',
      text,
      positionIndex: 0,
      score: 0.5,
    };
  }

  it('get returns empty array for an unknown turnId (no throw)', () => {
    const store = new ReedySourceStore();
    expect(store.get('missing')).toEqual([]);
  });

  it('replace overwrites; get returns the new snapshot', () => {
    const store = new ReedySourceStore();
    store.replace('t1', [chunk('a', 'one')]);
    store.replace('t1', [chunk('b', 'two')]);
    const out = store.get('t1');
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('b');
  });

  it('append merges, dedup by id, preserves insertion order', () => {
    const store = new ReedySourceStore();
    store.append('t1', [chunk('a', 'A'), chunk('b', 'B')]);
    store.append('t1', [chunk('b', 'B-again'), chunk('c', 'C')]);
    const out = store.get('t1');
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // dedup keeps the FIRST occurrence (preserves rank from the first call)
    expect(out[1]!.text).toBe('B');
  });

  it('subscribe is invoked on replace/append; unsubscribe stops notifications', () => {
    const store = new ReedySourceStore();
    const calls: RetrievedChunk[][] = [];
    const off = store.subscribe('t1', (snapshot) => calls.push(snapshot));

    store.replace('t1', [chunk('a', 'A')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((c) => c.id)).toEqual(['a']);

    store.append('t1', [chunk('b', 'B')]);
    expect(calls).toHaveLength(2);

    off();
    store.append('t1', [chunk('c', 'C')]);
    expect(calls).toHaveLength(2);
  });

  it('clear drops every turn and stops notifications', () => {
    const store = new ReedySourceStore();
    const listener = vi.fn();
    store.subscribe('t1', listener);
    store.replace('t1', [chunk('a', 'A')]);
    expect(listener).toHaveBeenCalledTimes(1);

    store.clear();
    expect(store.get('t1')).toEqual([]);

    store.replace('t1', [chunk('b', 'B')]);
    // After clear() subscription is gone — listener not invoked.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('turns are independent — replacing t1 does not affect t2', () => {
    const store = new ReedySourceStore();
    store.replace('t1', [chunk('a', 'A')]);
    store.replace('t2', [chunk('b', 'B'), chunk('c', 'C')]);
    expect(store.get('t1')).toHaveLength(1);
    expect(store.get('t2')).toHaveLength(2);
  });
});
