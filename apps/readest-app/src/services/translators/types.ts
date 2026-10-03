import { TranslatorName } from './providers';

export interface TranslationProvider {
  name: string;
  label: string;
  authRequired?: boolean;
  /** Needs a premium plan (custom translators). */
  premiumRequired?: boolean;
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
  /**
   * Preferred number of in-flight `translate()` calls for inline translation.
   * Batching providers raise it so enough paragraphs queue up to fill a batch.
   */
  concurrency?: number;
  /** Only works in the native apps (the endpoint sends no CORS headers). */
  requiresApp?: boolean;
  /**
   * Cache namespace for a translation. Defaults to `name`; custom LLM
   * providers fold the model and rendered prompt in so edits to either
   * yield fresh translations.
   */
  getCacheKey?: (sourceLang: string, targetLang: string, context?: TranslationContext) => string;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache?: boolean,
    signal?: AbortSignal,
    context?: TranslationContext,
  ) => Promise<string[]>;
}

/** Book-level context forwarded to providers that can use it (LLMs). */
export interface TranslationContext {
  promptId?: string;
  bookTitle?: string;
  bookAuthor?: string;
}

export interface TranslationCache {
  [key: string]: string;
}

export interface UseTranslatorOptions extends TranslationContext {
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
