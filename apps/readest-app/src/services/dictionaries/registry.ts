import type { DictionaryProvider, DictionarySettings, ImportedDictionary } from './types';

interface RegistryArgs {
  settings: DictionarySettings;
  dictionaries: ImportedDictionary[];
  fs?: unknown;
}

export const getEnabledProviders = (_args: RegistryArgs): DictionaryProvider[] => {
  return [];
};

export const isSystemDictionaryEnabled = (_settings: DictionarySettings): boolean => {
  return false;
};

export const evictProvider = (_id: string): void => {};

export const __resetRegistryForTests = (): void => {};
