// @vitest-environment node
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
const occurrenceEntry = (key: string) => ({
  id: `en:${key}`,
  lang: 'en',
  key,
  word: key,
  state: 'none' as const,
  occurrences: [occurrence('Saved.', 1)],
  createdAt: 1,
  modifiedAt: 0,
  deletedAt: null,
});

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
    // A lookup never outranks an explicit edit made on another device.
    expect(e.modifiedAt).toBe(0);
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

  it('keeps a Learning mark made elsewhere when this device first looks the word up', () => {
    vi.setSystemTime(9000);
    const s = useVocabularyStore.getState();
    s.recordLookup({ word: 'serendipity', lang: 'en', occurrence: occurrence('B.', 9000) });
    s.applyRemote([
      {
        id: 'en:serendipity',
        lang: 'en',
        key: 'serendipity',
        word: 'serendipity',
        state: 'learning',
        hint: '意外',
        occurrences: [occurrence('A.', 100)],
        createdAt: 50,
        modifiedAt: 500,
        deletedAt: null,
      },
    ]);
    const e = useVocabularyStore.getState().entries['en:serendipity']!;
    expect(e).toMatchObject({ state: 'learning', hint: '意外' });
    expect(e.occurrences.map((o) => o.sentence)).toEqual(['B.', 'A.']);
  });

  it('does not create an entry for a selection with no letters', () => {
    expect(useVocabularyStore.getState().ensureEntry('—', 'en')).toBe('');
    expect(Object.keys(useVocabularyStore.getState().entries)).toHaveLength(0);
  });

  it('keeps an unreadable file aside instead of saving over it', async () => {
    const files: Record<string, string> = { [VOCABULARY_FILENAME]: '{"entries": [tru' };
    await useVocabularyStore.getState().load(makeAppService(files));
    expect(useVocabularyStore.getState()).toMatchObject({ loaded: true, loadedCount: 0 });
    expect(files[`${VOCABULARY_FILENAME}.bak`]).toBe('{"entries": [tru');
  });

  it('keeps unpushed changes pending when the file loads over them', async () => {
    const saved = (key: string, dirty?: boolean) => ({
      id: `en:${key}`,
      lang: 'en',
      key,
      word: key,
      state: 'learning' as const,
      occurrences: [occurrence('Old.', 100)],
      createdAt: 50,
      modifiedAt: 500,
      deletedAt: null,
      ...(dirty ? { dirty } : {}),
    });
    const files: Record<string, string> = {
      // `restored` was written dirty by a backup restore; `looked` is clean on disk.
      [VOCABULARY_FILENAME]: JSON.stringify({
        version: 1,
        entries: [saved('restored', true), saved('looked')],
      }),
    };
    const s = useVocabularyStore.getState();
    useVocabularyStore.setState({ entries: { 'en:restored': saved('restored') } });
    s.recordLookup({ word: 'looked', lang: 'en', occurrence: occurrence('New.', 900) });
    await s.load(makeAppService(files));
    const { entries } = useVocabularyStore.getState();
    expect(entries['en:restored']!.dirty).toBe(true);
    expect(entries['en:looked']!.dirty).toBe(true);
  });

  it('flush saves the newest list even while a delayed save is still writing', async () => {
    const files: Record<string, string> = {};
    let releaseFirst: (() => void) | null = null;
    const appService = {
      exists: vi.fn(async () => false),
      readFile: vi.fn(),
      writeFile: vi.fn((path: string, _base: string, content: string) => {
        if (!releaseFirst) {
          // The delayed save stalls; it finishes only after flush has run.
          return new Promise<void>((resolve) => {
            releaseFirst = () => {
              files[path] = content;
              resolve();
            };
          });
        }
        files[path] = content;
        return Promise.resolve();
      }),
    } as unknown as AppService;
    await useVocabularyStore.getState().load(appService);
    const s = useVocabularyStore.getState();
    s.ensureEntry('first', 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(releaseFirst).not.toBeNull();
    s.ensureEntry('second', 'en');
    const flushed = s.flush();
    releaseFirst!();
    await flushed;
    const ids = JSON.parse(files[VOCABULARY_FILENAME]!).entries.map((e: { id: string }) => e.id);
    expect(ids).toContain('en:second');
  });

  it('saves a word looked up while the file is loading, without dropping the file', async () => {
    const files: Record<string, string> = {
      [VOCABULARY_FILENAME]: JSON.stringify({
        version: 1,
        entries: [{ ...occurrenceEntry('old') }],
      }),
    };
    let finishRead: (() => void) | null = null;
    const appService = {
      exists: vi.fn(async (path: string) => path in files),
      readFile: vi.fn(
        (path: string) =>
          new Promise((resolve) => {
            finishRead = () => resolve(files[path]);
          }),
      ),
      writeFile: vi.fn(async (path: string, _base: string, content: string) => {
        files[path] = content;
      }),
    } as unknown as AppService;
    const loading = useVocabularyStore.getState().load(appService);
    await vi.advanceTimersByTimeAsync(0);
    useVocabularyStore.getState().ensureEntry('new', 'en');
    await vi.advanceTimersByTimeAsync(1000);
    finishRead!();
    await loading;
    await vi.advanceTimersByTimeAsync(1000);
    const ids = JSON.parse(files[VOCABULARY_FILENAME]!).entries.map((e: { id: string }) => e.id);
    expect(ids.sort()).toEqual(['en:new', 'en:old']);
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

  it('imports a batch of words in one change', () => {
    const before = useVocabularyStore.getState().version;
    useVocabularyStore.getState().importWords([
      { word: 'Spice', lang: 'en', state: 'learning', hint: 'a drug' },
      { word: 'sand', lang: 'en', state: 'mastered' },
    ]);
    const { entries, version } = useVocabularyStore.getState();
    expect(version).toBe(before + 1);
    expect(entries['en:spice']).toMatchObject({
      word: 'Spice',
      state: 'learning',
      hint: 'a drug',
      dirty: true,
      modifiedAt: 1000,
    });
    expect(entries['en:sand']).toMatchObject({ state: 'mastered', dirty: true, modifiedAt: 1000 });
    expect(entries['en:sand']!.hint).toBeUndefined();
  });

  it('import keeps what it is not told to change', () => {
    useVocabularyStore.setState({
      entries: { 'en:dune': { ...occurrenceEntry('dune'), state: 'learning', hint: 'mine' } },
    });
    useVocabularyStore.getState().importWords([{ word: 'dune', lang: 'en', state: 'mastered' }]);
    expect(useVocabularyStore.getState().entries['en:dune']).toMatchObject({
      state: 'mastered',
      hint: 'mine',
      occurrences: [occurrence('Saved.', 1)],
    });
  });

  it('import never lowers a word, even from a plan made before it moved up', () => {
    // Sync made the word Mastered while an import planned it as a new Learning word.
    useVocabularyStore.setState({
      entries: { 'en:dune': { ...occurrenceEntry('dune'), state: 'mastered' } },
    });
    useVocabularyStore
      .getState()
      .importWords([{ word: 'dune', lang: 'en', state: 'learning', hint: 'a desert' }]);
    expect(useVocabularyStore.getState().entries['en:dune']).toMatchObject({
      state: 'mastered',
      hint: 'a desert',
    });
  });
});
