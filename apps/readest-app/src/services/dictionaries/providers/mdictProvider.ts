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
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';
import { getDictStyles } from '@/utils/style';
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

// Match real URL schemes (`http:`, `data:`, `blob:`, `file:`, …) and the
// protocol-relative `//host/...` form. A bare leading `/` is NOT skipped:
// MDX entries often reference resources via paths like `/images/foo.png`,
// which are intra-MDD relative paths (not document-absolute), so the
// resolver should still try them via `mdd.locateBytes`.
const IMG_SRC_PROTOCOL_RX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SOUND_HREF_RX = /^sound:\/\//i;
// `entry://word` is the canonical MDict cross-reference. `bword://word` is an
// alias used by some Babylon-derived dictionaries; both should re-look-up the
// target headword in the popup.
const ENTRY_HREF_RX = /^(?:entry|bword):\/\//i;

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
      // Try the path as-is first; if the MDD doesn't have it, retry with
      // a single leading `/` stripped (some MDX bundles emit
      // `/images/foo.png` while the MDD stores `images/foo.png`).
      const candidates = src.startsWith('/') ? [src, src.slice(1)] : [src];
      for (const mdd of mdds) {
        for (const key of candidates) {
          try {
            const located = await mdd.locateBytes(key);
            if (signal.aborted) return;
            if (located.data) {
              const blob = new Blob([new Uint8Array(located.data)]);
              const url = URL.createObjectURL(blob);
              trackedUrls.push(url);
              img.setAttribute('src', url);
              return;
            }
          } catch (err) {
            console.warn('mdd.locateBytes failed for', key, err);
          }
        }
      }
    }),
  );
}

/**
 * Wire MDict-specific URL schemes inside the rendered HTML:
 *
 * - `sound://path.ext`  — audio resource in the companion `.mdd`. Click looks
 *   up the bytes via `MDD.locateBytes` (auto-normalized; raw path works) and
 *   plays them through an `Audio` element. The first successful lookup caches
 *   the blob URL on the anchor for subsequent clicks; URLs are tracked for
 *   revocation in `dispose()`. `.spx` (Speex) is short-circuited with a toast
 *   since no major browser decodes it.
 * - `entry://word` / `bword://word`  — cross-reference to another headword in
 *   the same dictionary. Click forwards to `ctx.onNavigate(word)`, which the
 *   shell turns into a re-lookup. URL-encoded targets (e.g. `entry://word%20here`)
 *   are decoded before forwarding.
 *
 * Other schemes (`http(s)://`, `file://`, etc.) bubble up and are handled by
 * the surrounding shell's container click delegation.
 */
/**
 * Resolve any `<link rel="stylesheet" href="X.css">` references in the
 * rendered MDX body against the companion `.mdd` bundle(s). Returns the CSS
 * text for each successfully-located stylesheet (ready to be injected as an
 * inline `<style>` inside the card's shadow root). The original `<link>`
 * elements are removed from the body so the browser doesn't try to fetch
 * them via the network.
 */
async function resolveMddStylesheets(
  body: HTMLElement,
  mdds: MDDInstance[],
  signal: AbortSignal,
): Promise<string[]> {
  const links = Array.from(body.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'));
  const out: string[] = [];
  for (const link of links) {
    const href = link.getAttribute('href');
    link.remove();
    if (!href || !mdds.length) continue;
    for (const mdd of mdds) {
      try {
        const located = await mdd.locateBytes(href);
        if (signal.aborted) return out;
        if (located.data) {
          out.push(new TextDecoder('utf-8').decode(located.data));
          break;
        }
      } catch (err) {
        console.warn('mdd.locateBytes failed for stylesheet', href, err);
      }
    }
  }
  return out;
}

/**
 * Rewrite `url(path)` references in a stylesheet's text against the
 * companion `.mdd` bundle(s). Each non-protocol path is resolved to bytes
 * via `MDD.locateBytes` and replaced with a blob URL. Absolute URLs
 * (`http(s)://`, `data:`, `blob:`, leading `/`) are left untouched.
 *
 * Without this rewrite, relative urls inside an inlined `<style>` resolve
 * against the document base — which has no idea how to fetch the dict's
 * sound icon / background image / `@font-face` source from the MDD.
 */
const CSS_URL_RX = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\)/g;
async function resolveCssUrls(
  cssText: string,
  mdds: MDDInstance[],
  signal: AbortSignal,
  trackedUrls: string[],
): Promise<string> {
  if (!mdds.length || !cssText.includes('url(')) return cssText;

  const paths = new Set<string>();
  for (const m of cssText.matchAll(CSS_URL_RX)) {
    const path = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!path) continue;
    if (IMG_SRC_PROTOCOL_RX.test(path)) continue;
    paths.add(path);
  }
  if (paths.size === 0) return cssText;

  const resolved = new Map<string, string>();
  await Promise.all(
    Array.from(paths).map(async (path) => {
      for (const mdd of mdds) {
        if (signal.aborted) return;
        try {
          const located = await mdd.locateBytes(path);
          if (signal.aborted) return;
          if (located.data) {
            const blob = new Blob([new Uint8Array(located.data)]);
            const url = URL.createObjectURL(blob);
            trackedUrls.push(url);
            resolved.set(path, url);
            return;
          }
        } catch (err) {
          console.warn('mdd.locateBytes failed for css url', path, err);
        }
      }
    }),
  );

  return cssText.replace(CSS_URL_RX, (match, dq, sq, unq) => {
    const path = ((dq ?? sq ?? unq ?? '') as string).trim();
    const url = resolved.get(path);
    return url ? `url("${url}")` : match;
  });
}

function wireMdxAnchors(
  container: HTMLElement,
  mdds: MDDInstance[],
  trackedUrls: string[],
  onNavigate: ((word: string) => void) | undefined,
): void {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of anchors) {
    const raw = anchor.getAttribute('href') ?? '';

    if (SOUND_HREF_RX.test(raw)) {
      if (!mdds.length) continue;
      const path = raw.replace(SOUND_HREF_RX, '').trim();
      if (!path) continue;
      anchor.addEventListener('click', async (e) => {
        e.preventDefault();
        // Stop bubbling so the parent card's tap-to-expand handler doesn't fire.
        e.stopPropagation();

        // Speex (`.spx`) was deprecated by Xiph in 2012 in favor of Opus and
        // is no longer decoded by any major browser. Skip the lookup + play
        // attempt entirely and surface a toast so users with MW-style
        // dictionaries understand why nothing audible happens.
        if (/\.spx$/i.test(path)) {
          eventDispatcher.dispatch('toast', {
            type: 'warning',
            timeout: 4000,
            message: _(
              "This audio can't play here — the dictionary uses an outdated format. Try one with Opus, MP3, or WAV audio.",
            ),
          });
          return;
        }

        let url = anchor.getAttribute('data-mdd-resolved');
        if (!url) {
          for (const mdd of mdds) {
            try {
              const located = await mdd.locateBytes(path);
              if (located.data) {
                const blob = new Blob([new Uint8Array(located.data)]);
                url = URL.createObjectURL(blob);
                trackedUrls.push(url);
                anchor.setAttribute('data-mdd-resolved', url);
                break;
              }
            } catch (err) {
              console.warn('mdd.locateBytes failed for sound', path, err);
            }
          }
        }
        if (!url) return;
        const audio = new Audio(url);
        audio.play().catch((err) => {
          console.warn('Sound playback failed', path, err);
        });
      });
      continue;
    }

    if (ENTRY_HREF_RX.test(raw)) {
      if (!onNavigate) continue;
      const rawTarget = raw.replace(ENTRY_HREF_RX, '');
      let target: string;
      try {
        target = decodeURIComponent(rawTarget).trim();
      } catch {
        target = rawTarget.trim();
      }
      if (!target) continue;
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onNavigate(target);
      });
    }
  }
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
  // Loose .css files imported alongside the .mdx/.mdd. Read once at init,
  // injected into every card's shadow root at lookup time.
  let looseStylesheets: string[] = [];

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
        const cssNames = dict.files.css ?? [];
        const cssTexts: string[] = [];
        // Resolve `url(...)` refs against the MDDs once at init: loose CSS
        // files are read once and re-injected on every lookup, so doing the
        // rewrite here keeps the per-lookup work minimal and the tracked
        // blob URLs stable across the provider's lifetime.
        const initSignal = new AbortController().signal;
        for (const name of cssNames) {
          try {
            const cssFile = await fs.openFile(`${dict.bundleDir}/${name}`, 'Dictionaries');
            const raw = await cssFile.text();
            const resolved = await resolveCssUrls(raw, mddInsts, initSignal, trackedUrls);
            cssTexts.push(resolved);
          } catch (err) {
            console.warn('Failed to read loose stylesheet', name, err);
          }
        }
        mdx = mdxInst;
        mdds = mddInsts;
        looseStylesheets = cssTexts;
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
        // Follow MDict `@@@LINK=<target>` content-level redirects: the
        // looked-up entry's "definition" is sometimes just the literal
        // string `@@@LINK=question` pointing at the canonical headword.
        // Capped at 5 hops so a malformed cycle can't deadlock the
        // lookup; whatever we have at the limit is rendered as-is.
        //
        // Detection is intentionally loose. Real-world variants we have seen:
        //   `@@@LINK=question`              plain
        //   `@@@LINK=question\r\n`            Windows newline
        //   `@@@LINK=question\u0000`           trailing NUL
        //   `<div>@@@LINK=question</div>`   wrapped in markup by some bundles
        // Use the DOM as a tolerant tag-stripper, then look for the prefix.
        const redirectScratch = document.createElement('div');
        const extractRedirect = (def: string | null): string | null => {
          if (!def) return null;
          redirectScratch.innerHTML = def;
          const text = (redirectScratch.textContent ?? '').trim();
          if (!text.startsWith('@@@LINK=')) return null;
          // Stop at the first whitespace / control char so trailing NULs
          // or carriage returns embedded in the redirect line are dropped.
          const target = text
            .slice('@@@LINK='.length)
            .split(/[\s\u0000]/)[0]!
            .trim();
          return target || null;
        };

        let result = await mdx.lookup(word);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        for (let hop = 0; hop < 5; hop++) {
          const target = extractRedirect(result.definition);
          if (!target) break;
          result = await mdx.lookup(target);
          if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        }
        if (!result.definition) return { ok: false, reason: 'empty' };

        // Headword stays in light DOM so the app's Tailwind classes apply.
        const headword = document.createElement('h1');
        headword.textContent = result.keyText || word;
        headword.className = 'text-lg font-bold';
        ctx.container.appendChild(headword);

        // Build the body off-DOM so resource resolution + link wiring can
        // run before we move the tree into the shadow root. Tag the body
        // with `data-dict-kind="mdict"` so app-level CSS or external
        // tooling can target dict-rendered content distinct from the host's
        // surrounding chrome.
        const body = document.createElement('div');
        body.dataset['dictKind'] = dict.kind;
        body.innerHTML = result.definition;

        await resolveImageResources(body, mdds, ctx.signal, trackedUrls);
        const rawMddStylesheets = await resolveMddStylesheets(body, mdds, ctx.signal);
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        // Rewrite any `url(...)` refs inside MDD-resident stylesheets so
        // their relative paths (e.g. `url(sound.png)`) point at blob URLs
        // backed by the MDD instead of failing against the document base.
        const mddStylesheets = await Promise.all(
          rawMddStylesheets.map((css) => resolveCssUrls(css, mdds, ctx.signal, trackedUrls)),
        );
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        wireMdxAnchors(body, mdds, trackedUrls, ctx.onNavigate);

        // Attach a shadow root to a dedicated host so the dict's CSS (loose
        // .css files imported alongside + `<link>` references resolved from
        // the MDD) is scoped to this card and cannot leak between dicts or
        // into the app's layout. Click events still bubble naturally so the
        // `sound://` / `entry://` / external-link delegation keeps working.
        const shadowHost = document.createElement('div');
        shadowHost.className = 'mt-2 text-sm';
        ctx.container.appendChild(shadowHost);
        const shadow = shadowHost.attachShadow({ mode: 'open' });
        // Baseline app-level styles first (theme-aware blend rules for
        // icons, etc.), then the dict's own loose CSS, then any
        // MDD-resident stylesheets the MDX referenced via `<link>`.
        // Cascade order matches authoring order.
        const allStylesheets = [getDictStyles(), ...looseStylesheets, ...mddStylesheets];
        for (const cssText of allStylesheets) {
          if (!cssText) continue;
          const style = document.createElement('style');
          style.textContent = cssText;
          shadow.appendChild(style);
        }
        shadow.appendChild(body);

        // Hide our auto-prepended headword when the dict's own rendering
        // already ships one with the same text. Many dicts put a large
        // styled `<h1>` at the top of every entry; others use `<h3>`,
        // `<dt>`, or a custom-tagged element (the 探春 dict uses
        // `<h3 class="entry_name">`). We match in two complementary ways:
        //   1. The body's very first element child (catches non-h1 leads).
        //   2. Any `<h1>` anywhere in the shadow (catches dicts that
        //      prefix the entry with a wrapper div before the headword,
        //      e.g. Webster's `<div class="jumpcontent">` then h1).
        const ourTitle = (headword.textContent ?? '').trim();
        if (ourTitle) {
          const matchesText = (el: Element) => (el.textContent ?? '').trim() === ourTitle;
          const firstChild = body.firstElementChild;
          const dup =
            (!!firstChild && matchesText(firstChild)) ||
            Array.from(shadow.querySelectorAll('h1')).some(matchesText);
          if (dup) headword.remove();
        }

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
