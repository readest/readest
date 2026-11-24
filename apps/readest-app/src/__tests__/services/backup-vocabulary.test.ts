// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import { VOCABULARY_FILENAME } from '@/services/vocabulary/persistence';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import type { AppService, BaseDir } from '@/types/system';
import { useVocabularyStore } from '@/store/vocabularyStore';

vi.mock('@/utils/zip', async () => {
  const { configure } = await import('@zip.js/zip.js');
  return {
    configureZip: async () => configure({ useWebWorkers: false, useCompressionStream: false }),
  };
});

const entry = (key: string, patch: Partial<VocabularyEntry> = {}): VocabularyEntry => ({
  id: `en:${key}`,
  lang: 'en',
  key,
  word: key,
  state: 'none',
  occurrences: [],
  createdAt: 1,
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

const makeAppService = (entries: VocabularyEntry[]) => {
  const files: Record<string, string> = {
    [VOCABULARY_FILENAME]: JSON.stringify({ version: 1, entries }),
  };
  const appService = {
    loadLibraryBooks: async () => [],
    saveLibraryBooks: async () => {},
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => [],
    exists: async (path: string) => path in files,
    readFile: async (path: string) => files[path]!,
    writeFile: async (path: string, _base: string, content: string) => {
      files[path] = content;
    },
  } as unknown as AppService;
  return { appService, files };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  useVocabularyStore.setState({ entries: {}, loaded: false, loadedCount: 0, version: 0 });
});

describe('vocabulary in backups', () => {
  it('includes a word saved moments ago that is still waiting for the delayed save', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no stats'));
    const source = makeAppService([]);
    await useVocabularyStore.getState().load(source.appService);
    useVocabularyStore.getState().ensureEntry('fresh', 'en');
    const zip = await createBackupZip(source.appService);

    useVocabularyStore.setState({ entries: {}, loaded: false, loadedCount: 0, version: 0 });
    const target = makeAppService([]);
    await restoreFromBackupZip(target.appService, new Blob([zip]));
    const restored: VocabularyEntry[] = JSON.parse(target.files[VOCABULARY_FILENAME]!).entries;
    expect(restored.map((e) => e.id)).toContain('en:fresh');
  });

  it('keeps restored words when an earlier save finishes during the restore', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no stats'));
    const source = makeAppService([entry('cryptic', { state: 'mastered', modifiedAt: 50 })]);
    const zip = await createBackupZip(source.appService);

    const target = makeAppService([]);
    const write = target.appService.writeFile.bind(target.appService);
    let release: (() => void) | null = null;
    target.appService.writeFile = ((path: string, base: BaseDir, content: string) => {
      if (release) return write(path, base, content);
      // The delayed save of a word looked up just before restoring stalls.
      return new Promise<void>((resolve) => {
        release = () => void write(path, base, content).then(resolve);
      });
    }) as AppService['writeFile'];
    await useVocabularyStore.getState().load(target.appService);
    useVocabularyStore.getState().ensureEntry('local', 'en');
    await wait(600);
    expect(release).not.toBeNull();

    // Release the stalled save only once the restore is waiting on it.
    const flush = vi.spyOn(useVocabularyStore.getState(), 'flush');
    const restoring = restoreFromBackupZip(target.appService, new Blob([zip]));
    try {
      await vi.waitFor(() => expect(flush).toHaveBeenCalled());
    } finally {
      // Never leave the shared write chain stalled for later tests.
      release!();
    }
    await restoring;
    await wait(10);
    const ids = JSON.parse(target.files[VOCABULARY_FILENAME]!).entries.map(
      (e: VocabularyEntry) => e.id,
    );
    expect(ids).toEqual(expect.arrayContaining(['en:cryptic', 'en:local']));
  });

  it('restores backed-up words merged with the ones already on the device', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no stats'));
    const source = makeAppService([
      entry('cryptic', { state: 'mastered', modifiedAt: 50 }),
      entry('run', { occurrences: [{ sentence: 'Run.', at: 5 }] }),
    ]);
    const zip = await createBackupZip(source.appService);

    const target = makeAppService([entry('run', { occurrences: [{ sentence: 'Ran.', at: 9 }] })]);
    await restoreFromBackupZip(target.appService, new Blob([zip]));

    const restored: VocabularyEntry[] = JSON.parse(target.files[VOCABULARY_FILENAME]!).entries;
    const byId = Object.fromEntries(restored.map((e) => [e.id, e]));
    expect(byId['en:cryptic']).toMatchObject({ state: 'mastered', dirty: true });
    expect(byId['en:run']!.occurrences.map((o) => o.sentence)).toEqual(['Ran.', 'Run.']);
    expect(byId['en:run']!.dirty).toBe(true);
  });
});
