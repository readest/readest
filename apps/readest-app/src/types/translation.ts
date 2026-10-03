export type CustomTranslatorType = 'openai-compatible' | 'deepl';

/**
 * A user-configured translation backend. Registered alongside the built-in
 * translators as `custom:<id>`; synced as the `custom_translator` replica kind
 * with `apiKey` encrypted.
 */
export interface CustomTranslator {
  id: string;
  type: CustomTranslatorType;
  name: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1. Unused for DeepL. */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  disabled?: boolean;
  addedAt: number;
  updatedAt: number;
  deletedAt?: number;
  reincarnation?: string;
  lastSeenCipher?: Record<string, string>;
}

/**
 * A named system prompt for LLM translation. Supports the placeholders
 * {{sourceLang}}, {{targetLang}}, {{bookTitle}} and {{bookAuthor}}.
 */
export interface TranslationPrompt {
  id: string;
  name: string;
  systemPrompt: string;
  addedAt: number;
  updatedAt: number;
  deletedAt?: number;
  reincarnation?: string;
}
