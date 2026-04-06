import { TranslationProvider } from '../types';
import { deeplProvider } from './deepl';
import { azureProvider } from './azure';
import { googleProvider } from './google';
import { yandexProvider } from './yandex';

function createTranslator<T extends string>(
  name: T,
  implementation: TranslationProvider,
): TranslationProvider & { name: T } {
  if (name !== implementation.name) {
    throw Error(
      `Translator name "${name}" does not match implementation name "${implementation.name}"`,
    );
  }
  return implementation as TranslationProvider & { name: T };
}

const deeplTranslator = createTranslator('deepl', deeplProvider);
const azureTranslator = createTranslator('azure', azureProvider);
const googleTranslator = createTranslator('google', googleProvider);
const yandexTranslator = createTranslator('yandex', yandexProvider);

const availableTranslators = [
  deeplTranslator,
  azureTranslator,
  googleTranslator,
  yandexTranslator,
  // Add more translators here
];

export type TranslatorName = (typeof availableTranslators)[number]['name'];

export const getTranslator = (name: TranslatorName): TranslationProvider | undefined => {
  return availableTranslators.find((translator) => translator.name === name);
};

export const getTranslators = (): TranslationProvider[] => {
  return availableTranslators;
};

/**
 * Single source of truth for "can this provider actually be used right now?".
 * Used by auto-selection / fallback logic in `useTranslator`, the settings
 * panel, and the translator popup. Disabled providers (e.g. temporarily down
 * upstream services) are still returned from `getTranslators()` so the UI can
 * render them greyed out, but this predicate excludes them so they can never
 * be chosen or fallen back to.
 */
export const isTranslatorAvailable = (
  translator: TranslationProvider,
  hasToken: boolean,
): boolean => {
  if (translator.disabled) return false;
  if (translator.quotaExceeded) return false;
  if (translator.authRequired && !hasToken) return false;
  return true;
};

/**
 * Builds the user-facing dropdown label for a provider, appending a short
 * status suffix when the provider is unavailable. Kept next to
 * `isTranslatorAvailable` so the two stay in sync when a new unavailability
 * reason is added. The `_` translation function is passed in so this module
 * stays free of React imports.
 */
export const getTranslatorDisplayLabel = (
  translator: TranslationProvider,
  hasToken: boolean,
  _: (key: string) => string,
): string => {
  if (translator.disabled) {
    return `${translator.label} (${_('Unavailable')})`;
  }
  if (translator.authRequired && !hasToken) {
    return `${translator.label} (${_('Login Required')})`;
  }
  if (translator.quotaExceeded) {
    return `${translator.label} (${_('Quota Exceeded')})`;
  }
  return translator.label;
};
