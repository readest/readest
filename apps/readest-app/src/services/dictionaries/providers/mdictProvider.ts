/**
 * MDict provider.
 *
 * Wraps the forked `js-mdict` `MDX` / `MDD` classes via `MDX.create(blob)` /
 * `MDD.create(blob)`. Both factories accept any `Blob` whose `slice(start,
 * end).arrayBuffer()` resolves the bytes — Readest's `NativeFile` (Tauri) and
 * `RemoteFile` (web) qualify, so initialization reads only header + key index
 * and lookups read exactly the slice they need.
 *
 * Resource resolution: when the rendered MDX HTML references images via
 * `<img src="...">`, the provider iterates the rendered DOM after insertion,
 * calls `mdd.locateBytes(key)` for each path, wraps the bytes in a Blob, and
 * replaces the `src` with `URL.createObjectURL(blob)`. The provider tracks
 * every URL it creates and revokes them in `dispose()`.
 *
 * Encrypted MDX is detected at `init()` (the constructor sets
 * `meta.encrypt`) and surfaces as `unsupported`.
 */
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { DictionaryFileOpener } from './starDictProvider';

interface MDXLookupResult {
  keyText: string;
  definition: string | null;
}

interface MDXMeta {
  encrypt?: number;
}

interface MDXHeader {
  [key: string]: unknown;
}

interface MDXInstance {
  meta: MDXMeta;
  header: MDXHeader;
  lookup(word: string): MDXLookupResult | Promise<MDXLookupResult>;
}

interface MDDInstance {
  locateBytes(
    key: string,
  ):
    | { keyText: string; data: Uint8Array | null }
    | Promise<{ keyText: string; data: Uint8Array | null }>;
}

export interface CreateMdictProviderArgs {
  dict: ImportedDictionary;
  fs: DictionaryFileOpener;
  /** Localized label override; defaults to the bundle name. */
  label?: string;
}

const IMG_SRC_PROTOCOL_RX = /^(?:[a-z]+:|data:|blob:|\/)/i;

/**
 * Resolve `<img src="path">` references in the rendered HTML by reading bytes
 * from the companion `.mdd` file(s) and substituting object URLs. Returns the
 * URLs that were created so the caller can revoke them in `dispose()`.
 */
async function resolveImageResources(
  container: HTMLElement,
  mdds: MDDInstance[],
  signal: AbortSignal,
  trackedUrls: string[],
): Promise<void> {
  if (!mdds.length) return;
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img[src]'));
  if (!imgs.length) return;

  await Promise.all(
    imgs.map(async (img) => {
      if (signal.aborted) return;
      const src = img.getAttribute('src');
      if (!src || IMG_SRC_PROTOCOL_RX.test(src)) return;
      for (const mdd of mdds) {
        try {
          const located = await mdd.locateBytes(src);
          if (signal.aborted) return;
          if (located.data) {
            const blob = new Blob([new Uint8Array(located.data)]);
            const url = URL.createObjectURL(blob);
            trackedUrls.push(url);
            img.setAttribute('src', url);
            return;
          }
        } catch (err) {
          console.warn('mdd.locateBytes failed for', src, err);
        }
      }
    }),
  );
}

export const createMdictProvider = ({
  dict,
  fs,
  label,
}: CreateMdictProviderArgs): DictionaryProvider => {
  let mdx: MDXInstance | null = null;
  let mdds: MDDInstance[] = [];
  let initPromise: Promise<void> | null = null;
  let initError: Error | null = null;
  const trackedUrls: string[] = [];

  const initOnce = async (): Promise<void> => {
    if (mdx) return;
    if (initError) throw initError;
    if (!initPromise) {
      initPromise = (async () => {
        const { MDX, MDD } = (await import('js-mdict')) as {
          MDX: { create(file: Blob): Promise<MDXInstance> };
          MDD: { create(file: Blob): Promise<MDDInstance> };
        };

        if (!dict.files.mdx) {
          throw new Error('MDict bundle is missing the .mdx file');
        }
        const mdxFile = await fs.openFile(`${dict.bundleDir}/${dict.files.mdx}`, 'Dictionaries');
        let mdxInst: MDXInstance;
        try {
          mdxInst = await MDX.create(mdxFile);
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          if (/encrypted file|user identification/i.test(message)) {
            throw Object.assign(
              new Error(
                'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.',
              ),
              { unsupported: true },
            );
          }
          throw err;
        }
        // `meta.encrypt` is a bitmap. Bit 0 (record block encryption) needs a
        // user passcode and isn't implemented by js-mdict. Bit 1 (key info
        // block) is handled transparently via the ripemd128-based mdxDecrypt
        // — those dictionaries are fully usable.
        if ((mdxInst.meta?.encrypt ?? 0) & 1) {
          throw Object.assign(
            new Error(
              'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.',
            ),
            { unsupported: true },
          );
        }
        const mddNames = dict.files.mdd ?? [];
        const mddInsts: MDDInstance[] = [];
        for (const name of mddNames) {
          try {
            const mddFile = await fs.openFile(`${dict.bundleDir}/${name}`, 'Dictionaries');
            mddInsts.push(await MDD.create(mddFile));
          } catch (err) {
            console.warn('Failed to open MDD resource bundle', name, err);
          }
        }
        mdx = mdxInst;
        mdds = mddInsts;
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
    kind: 'mdict',
    label: label ?? dict.name,
    async lookup(word, ctx) {
      try {
        await initOnce();
      } catch (err) {
        const e = err as { unsupported?: boolean; message?: string };
        if (e.unsupported) {
          return { ok: false, reason: 'unsupported', message: e.message };
        }
        return {
          ok: false,
          reason: 'error',
          message: `Failed to load dictionary: ${(err as Error).message}`,
        };
      }
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!mdx) return { ok: false, reason: 'error', message: 'MDX not initialized' };

      try {
        const result = await mdx.lookup(word);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!result.definition) return { ok: false, reason: 'empty' };

        const headword = document.createElement('h1');
        headword.textContent = result.keyText || word;
        headword.className = 'text-lg font-bold';
        ctx.container.appendChild(headword);

        const body = document.createElement('div');
        body.innerHTML = result.definition;
        body.className = 'mt-2 text-sm';
        ctx.container.appendChild(body);

        await resolveImageResources(body, mdds, ctx.signal, trackedUrls);
        return { ok: true, headword: result.keyText, sourceLabel: dict.name };
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          message: (err as Error).message,
        };
      }
    },
    dispose() {
      for (const url of trackedUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore — already revoked or ephemeral environment without object URLs
        }
      }
      trackedUrls.length = 0;
    },
  };
};
