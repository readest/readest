/**
 * Babylon Glossary (.bgl) provider.
 *
 * Wraps {@link BglReader} for the popup. Babylon definitions are HTML
 * fragments; each matching entry (homographs share a headword) renders as a
 * headword heading plus an HTML body, following the Slob/StarDict rendering
 * conventions.
 */
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { DictionaryFileOpener } from './starDictProvider';
import { BglReader } from '../bglReader';

export interface CreateBglProviderArgs {
  dict: ImportedDictionary;
  fs: DictionaryFileOpener;
  /** Localized label override; defaults to the bundle name. */
  label?: string;
}

export const createBglProvider = ({
  dict,
  fs,
  label,
}: CreateBglProviderArgs): DictionaryProvider => {
  let reader: BglReader | null = null;
  let initPromise: Promise<BglReader> | null = null;
  let initError: Error | null = null;

  const initOnce = async (): Promise<BglReader> => {
    if (reader) return reader;
    if (initError) throw initError;
    if (!initPromise) {
      initPromise = (async () => {
        if (!dict.files.bgl) {
          throw new Error('Babylon bundle is missing the .bgl file');
        }
        const bglFile = await fs.openFile(`${dict.bundleDir}/${dict.files.bgl}`, 'Dictionaries');
        const r = new BglReader();
        await r.load({ bgl: bglFile });
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
    kind: 'bgl',
    label: label ?? dict.name,
    async lookup(word, ctx) {
      let r: BglReader;
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
        const entries = r.findEntries(word).filter((e) => e.definition);
        if (entries.length === 0) return { ok: false, reason: 'empty' };
        for (const entry of entries) {
          const h1 = document.createElement('h1');
          h1.textContent = entry.headword;
          h1.className = 'text-lg font-bold';
          ctx.container.appendChild(h1);
          const div = document.createElement('div');
          div.innerHTML = entry.definition;
          div.className = 'mt-2 text-sm';
          ctx.container.appendChild(div);
        }
        return {
          ok: true,
          headword: entries[0]!.headword,
          sourceLabel: r.metadata.title || dict.name,
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
