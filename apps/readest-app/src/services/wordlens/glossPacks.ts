import { isWebAppPlatform } from '@/services/environment';
import { downloadFile } from '@/libs/storage';
import type { AppService } from '@/types/system';
import type { ProgressHandler } from '@/utils/transfer';
import { webDownload } from '@/utils/transfer';
import { GlossIndex } from './glossIndex';
import type { GlossIndexData } from './types';

export const WORDLENS_CDN_BASE = 'https://cdn.readest.com/wordlens';
const STORE_DIR = 'wordlens'; // relative dir under BaseDir 'Data'
const MANIFEST_FILE = 'manifest.json';

export interface WordLensPack {
  pair: string;
  source: string;
  target: string;
  file: string;
  bytes: number;
  sha256: string;
  entries: number;
}

export interface WordLensManifest {
  schemaVersion: number;
  packs: WordLensPack[];
}

/** Injectable byte-getter so the loader stays cross-platform AND unit-testable. */
export type BytesDownloader = (url: string, onProgress?: ProgressHandler) => Promise<ArrayBuffer>;

const storePath = (file: string) => `${STORE_DIR}/${file}`;
const sidecarPath = (file: string) => `${STORE_DIR}/${file}.sha`;

const sha256OfBytes = async (buf: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// Idempotent + cheap: a recursive create is a no-op when the dir already
// exists, so we re-run it each time rather than caching a module-level latch
// (which would go stale if the user switches the custom data-root mid-session).
const ensureStoreDir = async (appService: AppService): Promise<void> => {
  try {
    await appService.createDir(STORE_DIR, 'Data', true);
  } catch {
    /* dir already exists (some platforms throw instead of no-op) */
  }
};

// Type of the (injectable) Rust-backed downloader, matching libs/storage's
// `downloadFile`. Injected so the temp-file path can be unit-tested.
type DownloadFileFn = (params: {
  appService: AppService;
  dst: string;
  cfp: string;
  url: string;
  onProgress?: ProgressHandler;
  singleThreaded?: boolean;
}) => Promise<unknown>;

/**
 * Download `url` through the Rust downloader into an absolute temp path under
 * 'Data', read the bytes back, then delete the temp file. Both the download
 * destination and the read/delete use the SAME absolute path (resolved via
 * `resolveFilePath(rel, 'Data')` and addressed with base 'None'), mirroring
 * the OPDS auto-download idiom in `services/opds/autoDownload.ts`. Routing
 * through Rust (rather than a webview fetch) avoids cross-origin/CORS concerns
 * on the webview — CSP itself is fine, since tauri.conf's connect-src
 * whitelists https://*.readest.com.
 */
export const downloadViaTempFile = async (
  appService: AppService,
  downloadFileFn: DownloadFileFn,
  url: string,
  onProgress?: ProgressHandler,
): Promise<ArrayBuffer> => {
  await ensureStoreDir(appService);
  const ids = new Uint32Array(1);
  crypto.getRandomValues(ids);
  const tmpRel = `${STORE_DIR}/.dl-${ids[0]!.toString(36)}.tmp`;
  const dst = await appService.resolveFilePath(tmpRel, 'Data'); // ABSOLUTE path under Data
  await downloadFileFn({ appService, dst, cfp: dst, url, onProgress, singleThreaded: true });
  try {
    return (await appService.readFile(dst, 'None', 'binary')) as ArrayBuffer;
  } finally {
    try {
      await appService.deleteFile(dst, 'None');
    } catch {
      /* best-effort temp cleanup */
    }
  }
};

// Default cross-platform downloader. On web a plain fetch to the CDN works and
// gives streaming progress; on Tauri we route through the Rust download path to
// avoid cross-origin/CORS concerns on the webview (CSP is fine — tauri.conf's
// connect-src whitelists https://*.readest.com), writing to a temp file and
// reading the bytes back for hashing.
export const defaultDownloader = async (
  appService: AppService,
  url: string,
  onProgress?: ProgressHandler,
): Promise<ArrayBuffer> => {
  if (isWebAppPlatform()) {
    const { blob } = await webDownload(url, onProgress);
    return await blob.arrayBuffer();
  }
  return downloadViaTempFile(appService, downloadFile, url, onProgress);
};

const getDownloader =
  (appService: AppService, override?: BytesDownloader): BytesDownloader =>
  (url, onProgress) =>
    override ? override(url, onProgress) : defaultDownloader(appService, url, onProgress);

export const resolvePack = (
  manifest: WordLensManifest | null,
  source: string,
  hint: string,
): WordLensPack | null =>
  manifest?.packs.find((p) => p.source === source && p.target === hint) ?? null;

/** The `target` codes the manifest offers for `source` (for the hint selector). */
export const listAvailableTargets = (manifest: WordLensManifest | null, source: string): string[] =>
  manifest?.packs.filter((p) => p.source === source).map((p) => p.target) ?? [];

// In-session memoized manifest (one network attempt per session unless forced).
let manifestPromise: Promise<WordLensManifest | null> | null = null;

// Module-level lazy cache: one resolved GlossIndex per pair per session.
const indexCache = new Map<string, Promise<GlossIndex | null>>();

const readPersistedManifest = async (appService: AppService): Promise<WordLensManifest | null> => {
  try {
    if (!(await appService.exists(storePath(MANIFEST_FILE), 'Data'))) return null;
    const text = (await appService.readFile(storePath(MANIFEST_FILE), 'Data', 'text')) as string;
    return JSON.parse(text) as WordLensManifest;
  } catch {
    return null;
  }
};

export const fetchManifest = async (
  appService: AppService,
  opts?: { download?: BytesDownloader; force?: boolean },
): Promise<WordLensManifest | null> => {
  if (manifestPromise && !opts?.force) return manifestPromise;
  const download = getDownloader(appService, opts?.download);
  manifestPromise = (async () => {
    try {
      const bytes = await download(`${WORDLENS_CDN_BASE}/${MANIFEST_FILE}`);
      const text = new TextDecoder().decode(bytes);
      const manifest = JSON.parse(text) as WordLensManifest;
      await ensureStoreDir(appService);
      await appService.writeFile(storePath(MANIFEST_FILE), 'Data', text);
      return manifest;
    } catch (err) {
      console.warn('[wordlens] manifest fetch failed; trying persisted copy', err);
      return readPersistedManifest(appService);
    }
  })();
  return manifestPromise;
};

// Single-flight per pair: collapse concurrent ensurePack calls for the same file.
const ensureFlights = new Map<string, Promise<string | null>>();

const ensurePackUncached = async (
  appService: AppService,
  pack: WordLensPack,
  opts?: { onProgress?: ProgressHandler; download?: BytesDownloader; allowDownload?: boolean },
): Promise<string | null> => {
  const dst = storePath(pack.file);
  const sidecar = sidecarPath(pack.file);

  // Reuse a present local file whose recorded sha matches the manifest's.
  if ((await appService.exists(dst, 'Data')) && (await appService.exists(sidecar, 'Data'))) {
    const recorded = (await appService.readFile(sidecar, 'Data', 'text')) as string;
    if (recorded === pack.sha256) return dst;
  }

  // Reader path with auto-download off: never hit the network for an uncached
  // pack. The settings panel passes allowDownload:true for explicit downloads.
  if (opts?.allowDownload === false) return null;

  const download = getDownloader(appService, opts?.download);
  const url = `${WORDLENS_CDN_BASE}/${pack.file}?v=${pack.sha256.slice(0, 8)}`;
  let bytes: ArrayBuffer;
  try {
    bytes = await download(url, opts?.onProgress);
  } catch (err) {
    console.warn('[wordlens] pack download failed', pack.pair, err);
    return null;
  }

  const actual = await sha256OfBytes(bytes);
  if (actual !== pack.sha256) {
    console.warn('[wordlens] pack sha mismatch; discarding', pack.pair, {
      actual,
      expected: pack.sha256,
    });
    return null;
  }

  await ensureStoreDir(appService);
  // Store as decoded text (like the manifest) so readFile(..., 'text') returns a
  // string on every platform. The web appService keeps an ArrayBuffer verbatim and
  // does NOT decode it for a 'text' read, which made JSON.parse choke on
  // "[object ArrayBuffer]". Re-encoding valid UTF-8 JSON is byte-identical.
  await appService.writeFile(dst, 'Data', new TextDecoder().decode(bytes));
  await appService.writeFile(sidecar, 'Data', pack.sha256);
  return dst;
};

export const ensurePack = async (
  appService: AppService,
  pack: WordLensPack,
  opts?: { onProgress?: ProgressHandler; download?: BytesDownloader; allowDownload?: boolean },
): Promise<string | null> => {
  const existing = ensureFlights.get(pack.pair);
  if (existing) return existing;
  const flight = ensurePackUncached(appService, pack, opts).finally(() => {
    ensureFlights.delete(pack.pair);
  });
  ensureFlights.set(pack.pair, flight);
  return flight;
};

/**
 * Resolve the pack for (source → hint) and report whether it's already in
 * local 'Data' (file + matching-sha sidecar present). Returns null when the
 * manifest has no pack for the pair. For the settings sub-page's size/state UI.
 */
export const getPackStatus = async (
  appService: AppService,
  source: string,
  hint: string,
  opts?: { download?: BytesDownloader },
): Promise<{ pack: WordLensPack; downloaded: boolean } | null> => {
  const manifest = await fetchManifest(appService, { download: opts?.download });
  const pack = resolvePack(manifest, source, hint);
  if (!pack) return null;
  const dst = storePath(pack.file);
  const sidecar = sidecarPath(pack.file);
  let downloaded = false;
  try {
    if ((await appService.exists(dst, 'Data')) && (await appService.exists(sidecar, 'Data'))) {
      const recorded = (await appService.readFile(sidecar, 'Data', 'text')) as string;
      downloaded = recorded === pack.sha256;
    }
  } catch {
    downloaded = false;
  }
  return { pack, downloaded };
};

/**
 * Delete a downloaded pack's file + its `.sha` sidecar from 'Data' (ignoring
 * not-found), and evict the in-session GlossIndex memo so a later re-enable
 * reloads from a fresh download.
 */
export const deletePack = async (appService: AppService, pack: WordLensPack): Promise<void> => {
  for (const path of [storePath(pack.file), sidecarPath(pack.file)]) {
    try {
      await appService.deleteFile(path, 'Data');
    } catch {
      /* best-effort: ignore not-found */
    }
  }
  indexCache.delete(`${pack.source}-${pack.target}`);
};

export const loadGlossIndex = async (
  appService: AppService,
  source: string,
  hint: string,
  opts?: { onProgress?: ProgressHandler; download?: BytesDownloader; allowDownload?: boolean },
): Promise<GlossIndex | null> => {
  const key = `${source}-${hint}`;
  const existing = indexCache.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const manifest = await fetchManifest(appService, { download: opts?.download });
      const pack = resolvePack(manifest, source, hint);
      if (!pack) return null;
      const path = await ensurePack(appService, pack, {
        onProgress: opts?.onProgress,
        download: opts?.download,
        allowDownload: opts?.allowDownload,
      });
      if (!path) return null;
      // Tolerate a non-decoding 'text' read (web stores ArrayBuffer verbatim) so an
      // already-cached pack from before the write-as-text fix still loads.
      const raw = await appService.readFile(path, 'Data', 'text');
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      return GlossIndex.fromData(JSON.parse(text) as GlossIndexData);
    } catch (err) {
      console.warn('[wordlens] loadGlossIndex failed', key, err);
      return null;
    }
  })();
  indexCache.set(key, promise);
  // Don't memoize a failed/skipped resolve: with auto-download off an uncached
  // pack yields null, and we want a later refresh (auto-download re-enabled, or
  // a just-finished manual download) to retry instead of serving the cached null.
  promise.then((index) => {
    if (!index && indexCache.get(key) === promise) indexCache.delete(key);
  });
  return promise;
};
