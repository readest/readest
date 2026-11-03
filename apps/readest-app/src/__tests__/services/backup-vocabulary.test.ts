import { describe, expect, it, vi } from 'vitest';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import { VOCABULARY_FILENAME } from '@/services/vocabulary/persistence';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import type { AppService } from '@/types/system';

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

describe('vocabulary in backups', () => {
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
