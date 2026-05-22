import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { imageFetchHeaders } from './httpHeaders';
import type { EpubImage } from './types';

// On Tauri we go through the Rust HTTP client (no browser-CORS); on web
// we use the native fetch — the bundler is only ever invoked from a
// CORS-free caller there (the browser extension's service worker, which
// has broad `host_permissions`). In the non-Tauri path we set
// `credentials: 'include'` so the browser sends the user's cookies for
// paywalled / member-only CDN hosts — without that, an authenticated
// Substack image returns a placeholder. In Tauri we also fold in the
// full image-fetch header set (UA + Sec-Ch-Ua + Sec-Fetch-* + Referer)
// so CDNs that gate images on the browser shape — NYT, WSJ, paywalled
// CDNs — cooperate.
const httpFetch = (url: string, referer: string | null, init?: RequestInit): Promise<Response> => {
  if (!isTauriAppPlatform()) {
    return globalThis.fetch(url, { credentials: 'include', ...init });
  }
  const baseHeaders = imageFetchHeaders(referer);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(baseHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return tauriFetch(url, { ...init, headers });
};

/** Per-asset limits picked to keep clipped articles light. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_CONCURRENCY = 4;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** Attributes that aren't useful in the bundled EPUB. Removed AFTER the URL
 *  has been picked — `srcset` and the `data-*` variants can be the source. */
const STRIP_ATTRS = [
  'loading',
  'decoding',
  'fetchpriority',
  'crossorigin',
  'srcset',
  'data-src',
  'data-original',
  'data-lazy',
  'data-actualsrc',
  'data-srcset',
];

/**
 * Pick the highest-resolution candidate from a `srcset` value. Medium,
 * Substack, NYT and other modern publishers set `src` to a ~60px LQIP
 * placeholder for lazy-loading and put the real image — along with its
 * other responsive variants — in `srcset` with width (`Nw`) or density
 * (`Nx`) descriptors. Picking the largest variant gives the EPUB
 * full-quality images, not blurry placeholders.
 */
function pickLargestFromSrcset(srcset: string): string | null {
  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const entry of srcset.split(',')) {
    const parts = entry.trim().split(/\s+/);
    let url = parts[0] || '';
    if (!url) continue;
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:/i.test(url) && !url.startsWith('/')) continue;
    // No descriptor → score 1 (treat as 1x). Width descriptors (`1280w`)
    // and density descriptors (`2x`) sort naturally on the numeric prefix.
    let score = 1;
    const desc = parts[1];
    if (desc) {
      const m = desc.match(/^(\d+(?:\.\d+)?)([wx])$/i);
      if (m) score = parseFloat(m[1]!);
    }
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl;
}

/**
 * Resolve an `<img>` to a fetchable URL, preferring high-resolution
 * variants in `srcset` over what `src` likely contains (a tiny
 * placeholder on lazy-loading sites). Falls back through the common
 * `data-*` lazy-load attribute conventions before giving up.
 */
function pickImgUrl(img: Element): string | null {
  // Prefer srcset — most likely the real, high-res image.
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const picked = pickLargestFromSrcset(srcset);
    if (picked) return picked;
  }
  const dataSrcset = img.getAttribute('data-srcset');
  if (dataSrcset) {
    const picked = pickLargestFromSrcset(dataSrcset);
    if (picked) return picked;
  }
  // Lazy-load `data-*` attributes (older lazy-loaders / non-srcset CMSes).
  const lazy =
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy') ||
    img.getAttribute('data-actualsrc');
  if (lazy && lazy.trim()) return lazy;
  // Fall back to `src` last — on a lazy-loading site this is the LQIP,
  // but on a vanilla site it's the only thing set.
  const direct = img.getAttribute('src');
  if (direct && direct.trim()) return direct;
  return null;
}

/** Resolve a `<picture>`/`<source>` to its highest-resolution image URL.
 *  Takes the first `<source>` that yields a usable URL — `<picture>`
 *  authors order sources by preference, with the largest variant inside
 *  each source's srcset. */
function pickPictureUrl(picture: Element): string | null {
  for (const source of picture.querySelectorAll('source')) {
    const srcset = source.getAttribute('srcset');
    if (srcset) {
      const picked = pickLargestFromSrcset(srcset);
      if (picked) return picked;
    }
    const src = source.getAttribute('src');
    if (src) return src;
  }
  const fallback = picture.querySelector('img');
  return fallback ? pickImgUrl(fallback) : null;
}

function dropElement(el: Element): void {
  el.parentNode?.removeChild(el);
}

/** Hex-encode a `Uint8Array`. ~10× faster than `Array.prototype.map(toString(16))`. */
function hex(bytes: Uint8Array, max = 16): string {
  const out = new Array<string>(max);
  for (let i = 0; i < max && i < bytes.length; i++) {
    out[i] = bytes[i]!.toString(16).padStart(2, '0');
  }
  return out.join('');
}

async function sha256(bytes: ArrayBuffer): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return new Uint8Array(digest);
}

function extFromMime(mime: string, fallbackUrl: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (MIME_TO_EXT[base]) return MIME_TO_EXT[base]!;
  const m = fallbackUrl.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m ? m[1]!.toLowerCase() : 'bin';
}

function mimeFromContentType(contentType: string | null, url: string): string {
  if (contentType) {
    const base = contentType.split(';')[0]!.trim().toLowerCase();
    if (base.startsWith('image/')) return base;
  }
  // Fall back to the URL extension — some CDNs return `application/octet-stream`.
  const m = url.match(/\.(jpe?g|png|gif|webp|svg|avif|bmp)(?:\?|#|$)/i);
  if (m) {
    const e = m[1]!.toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'svg') return 'image/svg+xml';
    return `image/${e}`;
  }
  return 'application/octet-stream';
}

interface FetchedAsset {
  url: string;
  path: string;
  bytes: ArrayBuffer;
  mime: string;
}

async function fetchAsset(url: string, referer: string | null): Promise<FetchedAsset | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await httpFetch(url, referer, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    if (bytes.byteLength > MAX_ASSET_BYTES) return null;
    const mime = mimeFromContentType(res.headers.get('content-type'), url);
    if (!mime.startsWith('image/')) return null;
    const digest = await sha256(bytes);
    const ext = extFromMime(mime, url);
    const path = `images/${hex(digest, 16)}.${ext}`;
    return { url, path, bytes, mime };
  } finally {
    clearTimeout(timer);
  }
}

export interface BundleAssetsResult {
  /** Rewritten HTML with `<img src>` pointing at the inlined paths. */
  html: string;
  /** Image resources to embed in the EPUB. */
  images: EpubImage[];
  /** Number of references that could not be fetched (404, timeout, oversize). */
  missing: number;
}

/**
 * Walk an extracted-article HTML fragment, fetch every referenced image under
 * the page's own session (cookies, real UA — only safe to call from a context
 * with CORS bypassed, i.e. Tauri webview or browser-extension content script),
 * and return a rewritten HTML fragment plus the inlined image resources.
 *
 * Honours lazy-load attribute conventions (`data-src`, `data-original`,
 * `data-srcset`, `srcset`). Drops `<iframe>`/`<video>`/`<audio>`/`<embed>`/
 * `<object>` entirely. Keeps inline `<svg>` as-is. A failed fetch becomes an
 * alt-text placeholder so the EPUB still builds.
 */
export async function bundleAssets(
  contentHtml: string,
  pageUrl: string,
): Promise<BundleAssetsResult> {
  const doc = new DOMParser().parseFromString(`<div id="root">${contentHtml}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return { html: contentHtml, images: [], missing: 0 };

  // Drop unrenderable / blocking media before walking.
  for (const el of Array.from(root.querySelectorAll('iframe, video, audio, embed, object'))) {
    dropElement(el);
  }

  // Pick every fetchable image URL.
  const targets: { el: Element; url: string }[] = [];
  for (const picture of Array.from(root.querySelectorAll('picture'))) {
    const url = pickPictureUrl(picture);
    if (!url) {
      dropElement(picture);
      continue;
    }
    // Flatten <picture> to a plain <img> so the rewritten HTML resolves
    // against the in-EPUB path without needing <source> entries the EPUB
    // reader probably doesn't honour.
    const img = doc.createElement('img');
    const alt = picture.querySelector('img')?.getAttribute('alt') ?? '';
    if (alt) img.setAttribute('alt', alt);
    picture.replaceWith(img);
    let abs: string;
    try {
      abs = new URL(url, pageUrl).toString();
    } catch {
      dropElement(img);
      continue;
    }
    targets.push({ el: img, url: abs });
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (targets.some((t) => t.el === img)) {
      // Already queued via <picture>. Just clean up noise attrs.
      for (const attr of STRIP_ATTRS) img.removeAttribute(attr);
      continue;
    }
    const url = pickImgUrl(img);
    // Strip noise attrs AFTER picking — srcset / data-* may be the source.
    for (const attr of STRIP_ATTRS) img.removeAttribute(attr);
    if (!url) {
      dropElement(img);
      continue;
    }
    let abs: string;
    try {
      abs = new URL(url, pageUrl).toString();
    } catch {
      dropElement(img);
      continue;
    }
    // Tiny tracking pixels: cheap to spot ahead of the fetch.
    if (img.getAttribute('width') === '1' && img.getAttribute('height') === '1') {
      dropElement(img);
      continue;
    }
    targets.push({ el: img, url: abs });
  }

  // Dedupe by URL so a hero shared by `<picture>` and `<img>` only fetches once.
  const urlToTargets = new Map<string, Element[]>();
  for (const { el, url } of targets) {
    const list = urlToTargets.get(url) ?? [];
    list.push(el);
    urlToTargets.set(url, list);
  }

  const uniqueUrls = Array.from(urlToTargets.keys());
  console.log('[clip/bundle] start', {
    unique_urls: uniqueUrls.length,
    sample: uniqueUrls.slice(0, 5),
  });
  const fetched = new Map<string, FetchedAsset>();
  let totalBytes = 0;
  let missing = 0;

  // Bounded-concurrency fetch loop. `MAX_CONCURRENCY` workers pull from a
  // shared cursor so we never hammer a single origin with N requests. Each
  // fetch owns its own timeout — see `fetchAsset`.
  let cursor = 0;
  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      const i = cursor++;
      const url = uniqueUrls[i]!;
      if (totalBytes >= MAX_TOTAL_ASSET_BYTES) {
        missing++;
        continue;
      }
      try {
        const asset = await fetchAsset(url, pageUrl);
        if (asset && totalBytes + asset.bytes.byteLength <= MAX_TOTAL_ASSET_BYTES) {
          fetched.set(url, asset);
          totalBytes += asset.bytes.byteLength;
        } else {
          missing++;
        }
      } catch (err) {
        missing++;
        console.warn('[clip/bundle] image fetch failed', {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, worker));
  console.log('[clip/bundle] done', {
    fetched: fetched.size,
    missing,
    total_bytes: totalBytes,
  });

  // Rewrite refs. Failed-fetch elements get their `src` cleared so they
  // render as the alt text placeholder.
  const images: EpubImage[] = [];
  const seenPaths = new Set<string>();
  for (const [url, els] of urlToTargets) {
    const asset = fetched.get(url);
    if (!asset) {
      for (const el of els) {
        el.removeAttribute('src');
      }
      continue;
    }
    if (!seenPaths.has(asset.path)) {
      images.push({ path: asset.path, bytes: asset.bytes, mime: asset.mime });
      seenPaths.add(asset.path);
    }
    for (const el of els) {
      el.setAttribute('src', asset.path);
    }
  }

  return { html: root.innerHTML, images, missing };
}
