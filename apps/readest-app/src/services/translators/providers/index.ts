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
