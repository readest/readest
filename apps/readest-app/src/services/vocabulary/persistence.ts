import type { AppService } from '@/types/system';
import type { VocabularyEntry } from './types';

/** Lives in the Data dir next to statistics.db; tombstones included. */
export const VOCABULARY_FILENAME = 'vocabulary.json';

interface VocabularyFile {
  version: 1;
  entries: VocabularyEntry[];
}

export const parseVocabularyFile = (text: string): VocabularyEntry[] => {
  const data = JSON.parse(text) as Partial<VocabularyFile>;
  return Array.isArray(data.entries) ? data.entries : [];
};

export const serializeVocabulary = (entries: VocabularyEntry[]): string =>
  JSON.stringify({ version: 1, entries } satisfies VocabularyFile);

export const readVocabularyFile = async (appService: AppService): Promise<VocabularyEntry[]> => {
  if (!(await appService.exists(VOCABULARY_FILENAME, 'Data'))) return [];
  const text = await appService.readFile(VOCABULARY_FILENAME, 'Data', 'text');
  return parseVocabularyFile(text as string);
};

export const writeVocabularyFile = (appService: AppService, entries: VocabularyEntry[]) =>
  appService.writeFile(VOCABULARY_FILENAME, 'Data', serializeVocabulary(entries));
