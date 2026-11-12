import '@/i18n/i18n';
import i18n from 'i18next';
import { useCallback, useSyncExternalStore } from 'react';

export type TranslationFunc = (key: string, options?: Record<string, number | string>) => string;

// One translation state for the app, not react-i18next's hook in every component: that hook
// re-reads its options, builds a fixed t and checks the namespace on each render, and its t is
// per component, so plain strings were looked up again by every component that mounted. Opening a
// book mounts hundreds of them, and on an e-ink reader (Readest Lite, QuickJS) the lookups showed.
// Plain strings are kept per language: a language change or newly loaded translations start over.
let generation = 0;
let plainStrings = new Map<string, string>();
const listeners = new Set<() => void>();
const startOver = () => {
  generation++;
  plainStrings = new Map();
  for (const listener of listeners) listener();
};
i18n.on('languageChanged', startOver);
i18n.on('loaded', startOver);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getGeneration = () => generation;

export const useTranslation = (namespace: string = 'translation') => {
  // A new translation function per generation, so callers that depend on it update.
  const current = useSyncExternalStore(subscribe, getGeneration, getGeneration);
  return useCallback(
    (key: string, options?: Record<string, unknown>) => {
      if (options) return i18n.t(key, { ns: namespace, defaultValue: key, ...options });
      const id = `${namespace}:${key}`;
      let value = plainStrings.get(id);
      if (value === undefined) {
        plainStrings.set(id, (value = i18n.t(key, { ns: namespace, defaultValue: key })));
      }
      return value;
    },
    [current, namespace],
  );
};
