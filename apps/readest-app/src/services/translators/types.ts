import { TranslatorName } from './providers';

export interface TranslationProvider {
  name: string;
  label: string;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache?: boolean,
  ) => Promise<string[]>;
}

export interface TranslationCache {
  [key: string]: string;
}

export interface UseTranslatorOptions {
  provider?: TranslatorName;
  sourceLang?: string;
  targetLang?: string;
  enablePolishing?: boolean;
}
