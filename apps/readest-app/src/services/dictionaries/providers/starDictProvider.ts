/**
 * StarDict provider.
 *
 * Uses {@link StarDictReader} (this repo) instead of `foliate-js/dict.js`'s
 * `StarDict` class. The upstream `DictZip.read` assumes per-chunk
 * independent deflate streams (BFINAL=1 + Z_FULL_FLUSH boundaries) — but
 * many real-world `.dict.dz` files are a single continuous deflate stream
 * with the FEXTRA/RA index pointing at *uncompressed* offsets, which makes
 * per-chunk inflate fail with `unexpected EOF`. Our reader gunzips the
 * whole file once and slices by offset, which works for both variants and
 * for raw uncompressed `.dict` files.
 *
 * v1 supports only single-character `sametypesequence` ∈ {m, h, x, t}:
 *   - `m` plain text (rendered with newline preservation)
 *   - `h`/`x` HTML/XHTML (set via innerHTML)
 *   - `t` phonetic (rendered as italic)
 *
 * Multi-type sequences, synonym-only bundles, image/audio types are
 * flagged `unsupported` at import time and filtered out before this
 * provider is instantiated.
 */
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { BaseDir } from '@/types/system';
import { StarDictReader, type StarDictEntry } from '../stardictReader';

/** Subset of the file API the provider needs. Both `AppService` and `FileSystem` satisfy this. */
export interface DictionaryFileOpener {
  openFile(path: string, base: BaseDir): Promise<File>;
}

const SAFE_TYPES = new Set(['m', 'h', 'x', 't']);

const decoder = new TextDecoder('utf-8');

const renderEntry = (
  container: HTMLElement,
  word: string,
  bytes: Uint8Array,
  type: string,
  isAdditional: boolean,
): void => {
  const text = decoder.decode(bytes);

  if (!isAdditional) {
    const h1 = document.createElement('h1');
    h1.textContent = word;
    h1.className = 'text-lg font-bold';
    container.appendChild(h1);
  } else {
    const h2 = document.createElement('h2');
    h2.textContent = word;
    h2.className = 'text-base font-semibold mt-4';
    container.appendChild(h2);
  }

  if (type === 'h' || type === 'x') {
    const div = document.createElement('div');
    div.innerHTML = text;
    div.className = 'mt-2 text-sm';
    container.appendChild(div);
    return;
  }
  if (type === 't') {
    const em = document.createElement('em');
    em.textContent = text;
    em.className = 'mt-2 block text-sm italic not-eink:opacity-85';
    container.appendChild(em);
    return;
  }
  // 'm' plain — preserve newlines.
  const pre = document.createElement('pre');
  pre.textContent = text;
  pre.className = 'mt-2 whitespace-pre-wrap break-words text-sm font-sans';
  container.appendChild(pre);
};

export interface CreateStarDictProviderArgs {
  dict: ImportedDictionary;
  fs: DictionaryFileOpener;
  /** Localized label override; defaults to the bundle name. */
  label?: string;
}

/**
 * Build a StarDict provider for one imported bundle. The provider lazily
 * initializes its reader on first lookup so users with many dictionaries
 * don't pay the parse + inflate cost up front for tabs they never open.
 */
export const createStarDictProvider = ({
  dict,
  fs,
  label,
}: CreateStarDictProviderArgs): DictionaryProvider => {
  let reader: StarDictReader | null = null;
  let initPromise: Promise<StarDictReader> | null = null;
  let initError: Error | null = null;

  const initOnce = async (): Promise<StarDictReader> => {
    if (reader) return reader;
    if (initError) throw initError;
    if (!initPromise) {
      initPromise = (async () => {
        if (!dict.files.ifo || !dict.files.idx || !dict.files.dict) {
          throw new Error('StarDict bundle is missing required files');
        }
        // Open every bundle file in parallel. Sidecars are optional —
        // older imports won't have them; the reader falls back to
        // scanning the source file when they're missing.
        const [ifoFile, idxFile, dictFile, synFile, idxOffsetsFile, synOffsetsFile] =
          await Promise.all([
            fs.openFile(`${dict.bundleDir}/${dict.files.ifo}`, 'Dictionaries'),
            fs.openFile(`${dict.bundleDir}/${dict.files.idx}`, 'Dictionaries'),
            fs.openFile(`${dict.bundleDir}/${dict.files.dict}`, 'Dictionaries'),
            dict.files.syn
              ? fs.openFile(`${dict.bundleDir}/${dict.files.syn}`, 'Dictionaries')
              : Promise.resolve(undefined),
            dict.files.idxOffsets
              ? fs
                  .openFile(`${dict.bundleDir}/${dict.files.idxOffsets}`, 'Dictionaries')
                  .catch(() => undefined)
              : Promise.resolve(undefined),
            dict.files.synOffsets
              ? fs
                  .openFile(`${dict.bundleDir}/${dict.files.synOffsets}`, 'Dictionaries')
                  .catch(() => undefined)
              : Promise.resolve(undefined),
          ]);

        const r = new StarDictReader();
        await r.load({
          ifo: ifoFile,
          idx: idxFile,
          dict: dictFile,
          syn: synFile,
          idxOffsets: idxOffsetsFile,
          synOffsets: synOffsetsFile,
        });
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
    kind: 'stardict',
    label: label ?? dict.name,
    async lookup(word, ctx) {
      let r: StarDictReader;
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

      const seq = r.ifo['sametypesequence'];
      if (!seq || seq.length !== 1 || !SAFE_TYPES.has(seq)) {
        return {
          ok: false,
          reason: 'unsupported',
          message: 'StarDict format outside v1 support',
        };
      }

      try {
        let entry: StarDictEntry | undefined = await r.lookup(word);
        if (!entry) entry = await r.resolveSynonym(word);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!entry) return { ok: false, reason: 'empty' };

        const bytes = await r.read(entry);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!bytes.length) return { ok: false, reason: 'empty' };
        renderEntry(ctx.container, entry.word, bytes, seq, false);
        return { ok: true, headword: entry.word, sourceLabel: r.ifo['bookname'] || dict.name };
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
