/**
 * DICT (dictd) provider.
 *
 * Wraps {@link DictReader} for the popup. Renders entries as plain text
 * with newlines preserved — DICT bodies are nearly always plain text per
 * RFC 2229; HTML is rare and the few HTML-bearing dicts in the wild use
 * `MIME` indicators outside the v1 scope.
 */
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { DictionaryFileOpener } from './starDictProvider';
import { DictReader } from '../dictReader';

const renderEntry = (container: HTMLElement, word: string, text: string): void => {
  const h1 = document.createElement('h1');
  h1.textContent = word;
  h1.className = 'text-lg font-bold';
  container.appendChild(h1);

  const pre = document.createElement('pre');
  pre.textContent = text;
  pre.className = 'mt-2 whitespace-pre-wrap break-words text-sm font-sans';
  container.appendChild(pre);
};

export interface CreateDictProviderArgs {
  dict: ImportedDictionary;
  fs: DictionaryFileOpener;
  /** Localized label override; defaults to the bundle name. */
  label?: string;
}

export const createDictProvider = ({
  dict,
  fs,
  label,
}: CreateDictProviderArgs): DictionaryProvider => {
  let reader: DictReader | null = null;
  let initPromise: Promise<DictReader> | null = null;
  let initError: Error | null = null;

  const initOnce = async (): Promise<DictReader> => {
    if (reader) return reader;
    if (initError) throw initError;
    if (!initPromise) {
      initPromise = (async () => {
        if (!dict.files.index || !dict.files.dict) {
          throw new Error('DICT bundle is missing required files');
        }
        const [indexFile, dictFile] = await Promise.all([
          fs.openFile(`${dict.bundleDir}/${dict.files.index}`, 'Dictionaries'),
          fs.openFile(`${dict.bundleDir}/${dict.files.dict}`, 'Dictionaries'),
        ]);

        const r = new DictReader();
        await r.load({ index: indexFile, dict: dictFile });
        reader = r;
        return r;
      })().catch((err) => {
        initError = err instanceof Error ? err : new Error(String(err));
        initPromise = null;
        throw initError;
      });
    }
    return initPromise;
  };

  return {
    id: dict.id,
    kind: 'dict',
    label: label ?? dict.name,
    async lookup(word, ctx) {
      let r: DictReader;
      try {
        r = await initOnce();
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          message: `Failed to load dictionary: ${(err as Error).message}`,
        };
      }
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };

      try {
        const entry = await r.lookup(word);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!entry) return { ok: false, reason: 'empty' };

        const text = await r.readText(entry);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!text) return { ok: false, reason: 'empty' };
        renderEntry(ctx.container, entry.word, text);
        return {
          ok: true,
          headword: entry.word,
          sourceLabel: r.info.label || dict.name,
        };
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          message: (err as Error).message,
        };
      }
    },
  };
};
