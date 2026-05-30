import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { imageFetchHeaders } from './httpHeaders';

/**
 * Find and fetch the best icon for a clipped article — the icon that
 * lands on the synthetic cover. We prefer the page's `<link rel="apple-
 * touch-icon">` (180×180 PNG on most sites), fall back to high-res
 * `<link rel="icon">` tags, then settle for `/favicon.ico`.
 *
 * Returns `null` on any failure — the cover generator's initial-letter
 * tile takes over from there.
 */

const FETCH_TIMEOUT_MS = 6_000;
const MAX_FAVICON_BYTES = 512 * 1024;

const PREFERRED_RELS = [
  'apple-touch-icon-precomposed',
  'apple-touch-icon',
  'icon',
  'shortcut icon',
  'mask-icon',
];

const HOSTED_FALLBACK_PATHS = [
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/favicon.ico',
];

const httpFetch = (url: string, referer: string | null, init?: RequestInit): Promise<Response> => {
  if (!isTauriAppPlatform()) {
    // In the extension SW (the only non-Tauri caller today) include
    // credentials so cookie-gated favicons / author images on paywalled
    // hosts come through with the user's session.
    return globalThis.fetch(url, { credentials: 'include', ...init });
  }
  const baseHeaders = imageFetchHeaders(referer);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(baseHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return tauriFetch(url, { ...init, headers });
};

interface IconCandidate {
  url: string;
  /** Higher = more preferred. Picked from rel attribute + sizes attribute. */
  score: number;
}

function parseSizes(sizes: string | null): number {
  if (!sizes) return 0;
  if (sizes.toLowerCase() === 'any') return 1024;
  // "180x180" → 180; "32x32 16x16" → 32 (largest).
  let max = 0;
  for (const m of sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)) {
    const w = parseInt(m[1]!, 10);
    if (w > max) max = w;
  }
  return max;
}

function relScore(rel: string): number {
  const lowered = rel.toLowerCase();
  // Apple touch icons are usually 180×180 PNGs and look much better on the
  // cover than 16×16 favicons. Boost them above plain "icon".
  if (lowered.includes('apple-touch-icon-precomposed')) return 1000;
  if (lowered.includes('apple-touch-icon')) return 900;
  if (lowered.includes('mask-icon')) return 100;
  if (lowered.includes('shortcut')) return 200;
  if (lowered.includes('icon')) return 500;
  return 0;
}

/** Extract candidate icon URLs from a parsed HTML document. */
export function extractIconCandidates(doc: Document, pageUrl: string): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  for (const link of Array.from(doc.querySelectorAll('link[rel]'))) {
    const rel = link.getAttribute('rel') ?? '';
    if (!PREFERRED_RELS.some((r) => rel.toLowerCase().split(/\s+/).includes(r))) {
      continue;
    }
    const href = link.getAttribute('href');
    if (!href) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const size = parseSizes(link.getAttribute('sizes'));
    candidates.push({ url, score: relScore(rel) + size });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Fetch an author profile image (e.g. WeChat public-account avatar). Same
 * shape as `fetchFavicon` but with a bigger size cap — avatars are often
 * 200×200 PNGs that comfortably exceed the favicon ceiling.
 */
export async function fetchAuthorImage(
  url: string,
  referer: string | null,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  return fetchImage(url, referer, MAX_AUTHOR_IMAGE_BYTES);
}

async function fetchFavicon(
  url: string,
  referer: string | null,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  return fetchImage(url, referer, MAX_FAVICON_BYTES);
}

const MAX_AUTHOR_IMAGE_BYTES = 2 * 1024 * 1024;

async function fetchImage(
  url: string,
  referer: string | null,
  maxBytes: number,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await httpFetch(url, referer, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    let mime = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (!mime.startsWith('image/')) {
      // Some CDNs serve `application/octet-stream` for `/favicon.ico` even
      // when it's a valid image — infer from the URL extension instead.
      const ext = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)?.[1]?.toLowerCase();
      if (ext === 'ico') mime = 'image/x-icon';
      else if (ext === 'png') mime = 'image/png';
      else if (ext === 'svg') mime = 'image/svg+xml';
      else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
      else if (ext === 'webp') mime = 'image/webp';
      else return null;
    }
    return { bytes, mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk a parsed page document for icon `<link>` tags, fetch the highest-
 * scoring candidate that responds, and return it. Falls back to common
 * well-known paths (`/apple-touch-icon.png`, `/favicon.ico`) when no
 * `<link>` icon is declared or none of them load.
 *
 * Caller is expected to provide a parsed Document — `kind: 'page'` and
 * `kind: 'article'` both already parse the page once for Readability, so
 * this avoids a second parse.
 */
export async function fetchBestFavicon(
  doc: Document,
  pageUrl: string,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const candidates = extractIconCandidates(doc, pageUrl);

  // Always check the well-known fallback paths last — some sites omit the
  // <link> tag but still host /apple-touch-icon.png.
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = '';
  }
  if (origin) {
    for (const path of HOSTED_FALLBACK_PATHS) {
      candidates.push({ url: `${origin}${path}`, score: -1 });
    }
  }

  // De-dupe so a `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
  // doesn't compete with the same URL added as a hosted fallback.
  const seen = new Set<string>();
  const ordered = candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  for (const candidate of ordered) {
    const result = await fetchFavicon(candidate.url, pageUrl);
    if (result) return result;
  }
  return null;
}
