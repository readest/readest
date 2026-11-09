import '@/i18n/i18n';
import { useCallback } from 'react';
import { useTranslation as _useTranslation } from 'react-i18next';

export type TranslationFunc = (key: string, options?: Record<string, number | string>) => string;

// Plain strings by translation function: components translate the same strings on every render,
// and on an e-ink reader (Readest Lite, QuickJS) each i18next lookup is slow enough to show in a
// page turn. react-i18next hands out a new function on a language change or when the
// translations load, which starts a new cache.
const plainStrings = new WeakMap<object, Map<string, string>>();

export const useTranslation = (namespace: string = 'translation') => {
  const { t } = _useTranslation(namespace);

  return useCallback(
    (key: string, options?: Record<string, unknown>) => {
      if (options) return t(key, { defaultValue: key, ...options });
      let cache = plainStrings.get(t);
      if (!cache) plainStrings.set(t, (cache = new Map()));
      let value = cache.get(key);
      if (value === undefined) cache.set(key, (value = t(key, { defaultValue: key })));
      return value;
    },
    [t],
  );
};
