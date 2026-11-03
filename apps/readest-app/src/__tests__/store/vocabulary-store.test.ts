import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { VOCABULARY_FILENAME } from '@/services/vocabulary/persistence';
import type { AppService } from '@/types/system';

const makeAppService = (files: Record<string, string> = {}) =>
  ({
    exists: vi.fn(async (path: string) => path in files),
    readFile: vi.fn(async (path: string) => files[path]!),
    writeFile: vi.fn(async (path: string, _base: string, content: string) => {
      files[path] = content;
    }),
  }) as unknown as AppService;

const occurrence = (sentence: string, at: number) => ({ sentence, at, bookHash: 'b1' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  useVocabularyStore.setState({ entries: {}, loaded: false, version: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('vocabularyStore', () => {
  it('folds case variants of a lookup into one entry with both sentences', () => {
    const { recordLookup } = useVocabularyStore.getState();
    recordLookup({ word: 'Serendipity', lang: 'en', occurrence: occurrence('A Serendipity.', 1) });
    recordLookup({ word: 'serendipity,', lang: 'en', occurrence: occurrence('B serendipity.', 2) });
    const entries = Object.values(useVocabularyStore.getState().entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'en:serendipity',
      word: 'Serendipity',
      state: 'none',
      dirty: true,
    });
    expect(entries[0]!.occurrences.map((o) => o.sentence)).toEqual([
      'B serendipity.',
      'A Serendipity.',
    ]);
  });

  it('does not move modifiedAt on a lookup of an existing word', () => {
    const s = useVocabularyStore.getState();
    const id = s.ensureEntry('run', 'en');
    s.setState(id, 'learning');
    vi.setSystemTime(5000);
    s.recordLookup({ word: 'run', lang: 'en', occurrence: occurrence('Run.', 5000) });
    expect(useVocabularyStore.getState().entries[id]!.modifiedAt).toBe(1000);
  });

  it('exposes Learning and Mastered keys with hints per language', () => {
    const s = useVocabularyStore.getState();
    const a = s.ensureEntry('Captain', 'en');
    s.setState(a, 'learning');
    s.setHint(a, '船长');
    s.setState(s.ensureEntry('cryptic', 'en'), 'mastered');
    s.setState(s.ensureEntry('perro', 'es'), 'learning');
    const { learning, mastered } = useVocabularyStore.getState().getLearningAndMastered('en');
    expect([...learning]).toEqual([['captain', '船长']]);
    expect([...mastered]).toEqual(['cryptic']);
  });

  it('tombstones a removed word and hides it from Word Lens', () => {
    const s = useVocabularyStore.getState();
    const id = s.ensureEntry('cryptic', 'en');
    s.setState(id, 'mastered');
    vi.setSystemTime(2000);
    s.remove(id);
    const e = useVocabularyStore.getState().entries[id]!;
    expect(e).toMatchObject({ deletedAt: 2000, modifiedAt: 2000, state: 'none', dirty: true });
    expect(useVocabularyStore.getState().getLearningAndMastered('en').mastered.size).toBe(0);
  });

  it('starts a removed word afresh when it is looked up again', () => {
    const s = useVocabularyStore.getState();
    const id = s.ensureEntry('cryptic', 'en');
    s.recordLookup({ word: 'cryptic', lang: 'en', occurrence: occurrence('Old.', 500) });
    s.remove(id);
    vi.setSystemTime(3000);
    s.recordLookup({ word: 'cryptic', lang: 'en', occurrence: occurrence('New.', 3000) });
    const e = useVocabularyStore.getState().entries[id]!;
    expect(e.deletedAt).toBeNull();
    expect(e.modifiedAt).toBe(3000);
    expect(e.occurrences.map((o) => o.sentence)).toEqual(['New.']);
  });

  it('bumps version on every change', () => {
    const s = useVocabularyStore.getState();
    const before = useVocabularyStore.getState().version;
    s.setState(s.ensureEntry('x', 'en'), 'learning');
    expect(useVocabularyStore.getState().version).toBeGreaterThan(before);
  });

  it('persists to the data file and loads it back', async () => {
    const files: Record<string, string> = {};
    const appService = makeAppService(files);
    await useVocabularyStore.getState().load(appService);
    const s = useVocabularyStore.getState();
    s.setState(s.ensureEntry('cryptic', 'en'), 'mastered');
    await vi.runAllTimersAsync();
    expect(JSON.parse(files[VOCABULARY_FILENAME]!).entries).toHaveLength(1);

    useVocabularyStore.setState({ entries: {}, loaded: false, version: 0 });
    await useVocabularyStore.getState().load(appService);
    expect(useVocabularyStore.getState().entries['en:cryptic']!.state).toBe('mastered');
  });

  it('merges remote entries without marking them dirty', () => {
    const s = useVocabularyStore.getState();
    s.applyRemote([
      {
        id: 'en:run',
        lang: 'en',
        key: 'run',
        word: 'run',
        state: 'learning',
        occurrences: [],
        createdAt: 1,
        modifiedAt: 900,
        deletedAt: null,
      },
    ]);
    expect(useVocabularyStore.getState().entries['en:run']).toMatchObject({ state: 'learning' });
    expect(useVocabularyStore.getState().entries['en:run']!.dirty).toBeFalsy();
  });
});
