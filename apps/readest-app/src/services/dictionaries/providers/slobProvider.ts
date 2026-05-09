/**
 * Slob (Aard 2) provider.
 *
 * Wraps {@link SlobReader} for the popup. Renders entries based on their
 * content type:
 *   - `text/html*` → set as `innerHTML` (Wikipedia/Wiktionary slobs)
 *   - `text/plain` → wrapped `<pre>` with newlines preserved
 *   - everything else → flagged as unsupported (e.g. CSS/JS resources, which
 *     belong to the slob's bundled stylesheet, not lookup results)
 *
 * Slob refs starting with `~/` are bundled resource paths (CSS/JS used by
 * the dictionary's own templates). They are not user-visible headwords and
 * are filtered before binary search hits them.
 */
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { DictionaryFileOpener } from './starDictProvider';
import { SlobReader } from '../slobReader';

const renderEntry = (
  container: HTMLElement,
  word: string,
  contentType: string,
  data: Uint8Array,
): { ok: true } | { ok: false; reason: 'empty' | 'unsupported'; message?: string } => {
  if (data.length === 0) return { ok: false, reason: 'empty' };

  const ct = contentType.split(';', 1)[0]!.trim().toLowerCase();
  const text = new TextDecoder('utf-8').decode(data);

  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    const h1 = document.createElement('h1');
    h1.textContent = word;
    h1.className = 'text-lg font-bold';
    container.appendChild(h1);
    const div = document.createElement('div');
    // Strip <link rel="stylesheet"> tags pointing at slob-internal CSS;
    // they 404 because we don't expose the bundled CSS as URLs in the popup.
    div.innerHTML = text.replace(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi, '');
    div.className = 'mt-2 text-sm';
    container.appendChild(div);
    return { ok: true };
  }
  if (ct === 'text/plain' || ct === '') {
    const h1 = document.createElement('h1');
    h1.textContent = word;
    h1.className = 'text-lg font-bold';
    container.appendChild(h1);
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.className = 'mt-2 whitespace-pre-wrap break-words text-sm font-sans';
    container.appendChild(pre);
    return { ok: true };
  }
  return {
    ok: false,
    reason: 'unsupported',
    message: `Slob content type "${ct}" is not supported`,
  };
};

export interface CreateSlobProviderArgs {
  dict: ImportedDictionary;
  fs: DictionaryFileOpener;
  /** Localized label override; defaults to the bundle name. */
  label?: string;
}

export const createSlobProvider = ({
  dict,
  fs,
  label,
}: CreateSlobProviderArgs): DictionaryProvider => {
  let reader: SlobReader | null = null;
  let initPromise: Promise<SlobReader> | null = null;
  let initError: Error | null = null;

  const initOnce = async (): Promise<SlobReader> => {
    if (reader) return reader;
    if (initError) throw initError;
    if (!initPromise) {
      initPromise = (async () => {
        if (!dict.files.slob) {
          throw new Error('Slob bundle is missing the .slob file');
        }
        const slobFile = await fs.openFile(`${dict.bundleDir}/${dict.files.slob}`, 'Dictionaries');
        const r = new SlobReader();
        await r.load({ slob: slobFile });
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
    kind: 'slob',
    label: label ?? dict.name,
    async lookup(word, ctx) {
      let r: SlobReader;
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
        // Bundled resources (CSS/JS) live under refs starting with `~/`.
        // We don't expose them as lookup hits.
        if (word.startsWith('~/')) return { ok: false, reason: 'empty' };

        const ref = await r.findRef(word);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!ref) return { ok: false, reason: 'empty' };
        if (ref.key.startsWith('~/')) return { ok: false, reason: 'empty' };

        const blob = await r.readBlob(ref);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        const outcome = renderEntry(ctx.container, ref.key, blob.contentType, blob.data);
        if (!outcome.ok) return outcome;
        return {
          ok: true,
          headword: ref.key,
          sourceLabel: r.header.tags['label']?.replace(/\0+$/u, '') || dict.name,
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
