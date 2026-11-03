import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pullVocabulary,
  pushVocabulary,
  syncVocabulary,
  type VocabularyCursor,
  type VocabularySyncDeps,
} from '@/services/vocabulary/vocabularySync';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { VocabularyRow } from '@/services/vocabulary/wire';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';

const row = (
  key: string,
  updatedAt: string,
  patch: Partial<VocabularyRow> = {},
): VocabularyRow => ({
  id: `en:${key}`,
  lang: 'en',
  word_key: key,
  word: key,
  state: 'learning',
  hint: null,
  occurrences: [],
  created_at: 1,
  modified_at: 1,
  deleted_at: null,
  updated_at: updatedAt,
  ...patch,
});

const makeDeps = (patch: Partial<VocabularySyncDeps> = {}) => {
  let cursor: VocabularyCursor | null = null;
  const deps: VocabularySyncDeps = {
    userId: 'u1',
    pageSize: 2,
    pull: vi.fn(async () => []),
    push: vi.fn(async (rows: VocabularyRow[]) => ({
      rows: rows.map((r) => ({ ...r, updated_at: 't' })),
      rejected: [],
    })),
    getCursor: () => cursor,
    setCursor: (c) => {
      cursor = c;
    },
    ...patch,
  };
  return deps;
};

beforeEach(() => {
  useVocabularyStore.setState({ entries: {}, loaded: true, loadedCount: 1, version: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pullVocabulary', () => {
  it('pages until a short page, applies rows and keeps the last row as the cursor', async () => {
    const pages = [
      [row('a', '2026-11-03T00:00:01.000Z'), row('b', '2026-11-03T00:00:02.000Z')],
      [row('c', '2026-11-03T00:00:02.000Z')],
    ];
    const deps = makeDeps({ pull: vi.fn(async () => pages.shift() ?? []) });
    await pullVocabulary(deps);

    expect(deps.pull).toHaveBeenNthCalledWith(1, null, 2);
    expect(deps.pull).toHaveBeenNthCalledWith(2, { ts: '2026-11-03T00:00:02.000Z', id: 'en:b' }, 2);
    expect(deps.pull).toHaveBeenCalledTimes(2);
    expect(Object.keys(useVocabularyStore.getState().entries).sort()).toEqual([
      'en:a',
      'en:b',
      'en:c',
    ]);
    expect(deps.getCursor()).toEqual({ userId: 'u1', ts: '2026-11-03T00:00:02.000Z', id: 'en:c' });
  });

  it('writes the pulled words to the data file before moving the cursor', async () => {
    const files: Record<string, string> = {};
    const appService = {
      exists: vi.fn(async () => false),
      writeFile: vi.fn(async (path: string, _base: string, content: string) => {
        files[path] = content;
      }),
    } as unknown as AppService;
    await useVocabularyStore.getState().load(appService);
    const onDisk: string[][] = [];
    const deps = makeDeps({
      pull: vi.fn(async () => [row('a', '2026-11-03T00:00:01.000Z')]),
      setCursor: () => {
        const saved = files['vocabulary.json'];
        onDisk.push(saved ? JSON.parse(saved).entries.map((e: { id: string }) => e.id) : []);
      },
    });
    await pullVocabulary(deps);
    expect(onDisk).toEqual([['en:a']]);
  });

  it('re-reads the last minute before the saved cursor, for writes committed late', async () => {
    const deps = makeDeps();
    deps.setCursor({ userId: 'u1', ts: '2026-11-03T00:10:00.000Z', id: 'en:z' });
    await pullVocabulary(deps);
    expect(deps.pull).toHaveBeenCalledWith({ ts: '2026-11-03T00:09:00.000Z', id: '' }, 2);
    // Nothing new: the saved cursor stays, even against an older row in the overlap.
    const overlap = makeDeps({
      pull: vi.fn(async () => [row('y', '2026-11-03T00:09:30.000+00:00')]),
    });
    overlap.setCursor({ userId: 'u1', ts: '2026-11-03T00:10:00.000Z', id: 'en:z' });
    await pullVocabulary(overlap);
    expect(overlap.getCursor()!.ts).toBe('2026-11-03T00:10:00.000Z');
    expect(deps.getCursor()).toEqual({ userId: 'u1', ts: '2026-11-03T00:10:00.000Z', id: 'en:z' });
  });

  it('pulls from the start when the local file had no words (lost or unreadable)', async () => {
    useVocabularyStore.setState({ loadedCount: 0 });
    const deps = makeDeps();
    deps.setCursor({ userId: 'u1', ts: '2026-11-03T00:10:00.000Z', id: 'en:z' });
    await pullVocabulary(deps);
    expect(deps.pull).toHaveBeenCalledWith(null, 2);
  });

  it('trusts the cursor again once a full pull has filled the list', async () => {
    useVocabularyStore.setState({ loadedCount: 0 });
    const deps = makeDeps({ pull: vi.fn(async () => [row('a', '2026-11-03T00:00:01.000Z')]) });
    await pullVocabulary(deps);
    vi.mocked(deps.pull).mockResolvedValue([]);
    await pullVocabulary(deps);
    // Back to the saved cursor (less the one-minute overlap), not from the start.
    expect(deps.pull).toHaveBeenLastCalledWith({ ts: '2026-11-02T23:59:01.000Z', id: '' }, 2);
  });

  it("ignores another account's cursor", async () => {
    const deps = makeDeps();
    deps.setCursor({ userId: 'someone-else', ts: '2026-11-03T00:10:00.000Z', id: 'en:z' });
    await pullVocabulary(deps);
    expect(deps.pull).toHaveBeenCalledWith(null, 2);
  });
});

describe('pushVocabulary', () => {
  it('sends only dirty entries, in chunks, and clears dirty after', async () => {
    const s = useVocabularyStore.getState();
    for (const w of ['a', 'b', 'c']) s.ensureEntry(w, 'en');
    useVocabularyStore.setState((st) => ({
      entries: {
        ...st.entries,
        'en:d': { ...st.entries['en:a']!, id: 'en:d', key: 'd', dirty: false },
      },
    }));
    const deps = makeDeps({ pushChunk: 2 });
    await pushVocabulary(deps);

    const pushed = vi.mocked(deps.push).mock.calls.map((c) => c[0].map((r) => r.id));
    expect(pushed).toEqual([['en:a', 'en:b'], ['en:c']]);
    expect(Object.values(useVocabularyStore.getState().entries).some((e) => e.dirty)).toBe(false);
  });

  it('keeps an entry dirty when it changes while its push is in flight', async () => {
    const s = useVocabularyStore.getState();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const id = s.ensureEntry('run', 'en');
    const deps = makeDeps({
      push: vi.fn(async (rows: VocabularyRow[]) => {
        vi.setSystemTime(2000);
        useVocabularyStore.getState().setState(id, 'mastered');
        return { rows, rejected: [] };
      }),
    });
    await pushVocabulary(deps);
    const e = useVocabularyStore.getState().entries[id]!;
    expect(e.state).toBe('mastered');
    expect(e.dirty).toBe(true);
  });
});

describe('syncVocabulary', () => {
  it('runs once more when a sync is asked for while one is running', async () => {
    useSettingsStore.setState({ settings: { syncCategories: {} } as unknown as SystemSettings });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps = makeDeps({
      pull: vi.fn(async () => {
        await gate;
        return [];
      }),
    });
    const first = syncVocabulary(async () => deps);
    // A change made mid-sync: the debounced sync arrives while the first runs.
    useVocabularyStore.getState().ensureEntry('late', 'en');
    const second = syncVocabulary(async () => deps);
    release();
    await Promise.all([first, second]);
    expect(deps.pull).toHaveBeenCalledTimes(2);
    const pushed = vi.mocked(deps.push).mock.calls.flatMap(([rows]) => rows.map((r) => r.id));
    expect(pushed).toContain('en:late');
  });

  it('still pulls when the push fails', async () => {
    useSettingsStore.setState({ settings: { syncCategories: {} } as unknown as SystemSettings });
    useVocabularyStore.getState().ensureEntry('run', 'en');
    const deps = makeDeps({ push: vi.fn(async () => Promise.reject(new Error('500'))) });
    await syncVocabulary(async () => deps);
    expect(deps.pull).toHaveBeenCalled();
  });

  it('clears dirty on rows the server rejected so they stop blocking pushes', async () => {
    const s = useVocabularyStore.getState();
    s.ensureEntry('run', 'en');
    const deps = makeDeps({
      push: vi.fn(async () => ({ rows: [], rejected: ['en:run'] })),
    });
    await pushVocabulary(deps);
    expect(useVocabularyStore.getState().entries['en:run']!.dirty).toBeFalsy();
  });

  it('does nothing when the Vocabulary sync category is off', async () => {
    useSettingsStore.setState({
      settings: { syncCategories: { vocabulary: false } } as unknown as SystemSettings,
    });
    const deps = makeDeps();
    useVocabularyStore.getState().ensureEntry('run', 'en');
    await syncVocabulary(async () => deps);
    expect(deps.pull).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });
});
