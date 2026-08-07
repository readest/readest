import { TranslatorName } from './providers';

export interface TranslationProvider {
  name: string;
  label: string;
  authRequired?: boolean;
  quotaExceeded?: boolean;
  /**
   * The upstream API carries inline HTML through translation, repositioning
   * tags onto the semantically matching words in the target language. When set,
   * the reader sends a paragraph's inline markup instead of its bare text so
   * italics/bold/font-size runs survive (#1582); otherwise it sends plain text.
   * Set this only for providers actually verified against the live API — a
   * provider that echoes tags positionally would scramble the formatting.
   */
  preservesMarkup?: boolean;
  /**
   * Marks a provider as temporarily unavailable. Disabled providers are
   * filtered out of `getTranslators()` / `getTranslator()`, so the UI never
   * lists them and the fallback logic in `useTranslator` skips over them.
   * Flip back to `false` (or delete the field) once the provider is healthy
   * again — no other code changes required.
   */
  disabled?: boolean;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache?: boolean,
    signal?: AbortSignal,
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
  enablePreprocessing?: boolean;
}

export const ErrorCodes = {
  UNAUTHORIZED: 'Unauthorized',
  DEEPL_API_ERROR: 'DeepL API Error',
  DAILY_QUOTA_EXCEEDED: 'Daily Quota Exceeded',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
};
