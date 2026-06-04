import { TranslationProvider } from '../types';

export type TranslatorName = string;

const availableTranslators: TranslationProvider[] = [];

export const getTranslator = (_name: TranslatorName): TranslationProvider | undefined => {
  return undefined;
};

export const getTranslators = (): TranslationProvider[] => {
  return availableTranslators;
};

export const isTranslatorAvailable = (
  _translator: TranslationProvider,
  _hasToken: boolean,
): boolean => {
  return false;
};

export const getTranslatorDisplayLabel = (
  translator: TranslationProvider,
  _hasToken: boolean,
  _translate: (key: string) => string,
): string => {
  return translator.label;
};
