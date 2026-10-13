import { isTauriAppPlatform } from '@/services/environment';
import type { CustomTranslator } from '@/types/translation';
import type { TranslationProvider } from '../types';
import { createDeepLTranslator } from './deepl';
import { createOpenAICompatibleTranslator } from './openaiCompatible';

export * from './constants';
export * from './prompts';

const instances = new Map<string, { updatedAt: number; provider: TranslationProvider }>();

/** Builds a fresh TranslationProvider for a (possibly unsaved) custom config. */
export const buildCustomTranslator = (config: CustomTranslator): TranslationProvider => {
  const provider: TranslationProvider =
    config.type === 'deepl'
      ? { ...createDeepLTranslator(config), requiresApp: true }
      : createOpenAICompatibleTranslator(config);
  provider.premiumRequired = true;
  // The DeepL API sends no CORS headers, so it only works through tauriFetch.
  provider.disabled = !!config.disabled || (!!provider.requiresApp && !isTauriAppPlatform());
  return provider;
};

/**
 * Registry instance for a saved config, reused until the config changes so an
 * LLM provider's pending batches survive the registry being re-read.
 */
export const createCustomTranslator = (config: CustomTranslator): TranslationProvider => {
  const cached = instances.get(config.id);
  if (cached && cached.updatedAt === config.updatedAt) return cached.provider;
  const provider = buildCustomTranslator(config);
  instances.set(config.id, { updatedAt: config.updatedAt, provider });
  return provider;
};
