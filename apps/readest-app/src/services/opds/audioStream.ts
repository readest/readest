// Turning OPDS audio links into something an <audio> element can actually play.
//
// Audio NEVER goes through Readest's own proxy, unlike the feed and the
// download paths. An audiobook is hundreds of megabytes of somebody's private,
// self-hosted library; relaying that through Readest's servers would put real
// bandwidth cost on a shared deployment and route personal media through a
// third party the user never asked to involve. A feed is a few KB of metadata
// and the tradeoff there is different.
//
// That leaves the media element's own constraint: it fetches by URL and cannot
// attach an Authorization header. So:
//
//   no credentials  -> the catalog URL directly, on every platform. Media
//                      elements load cross-origin without CORS, so the browser
//                      (or WebView) issues its own Range requests straight to
//                      the origin and seeking is instant.
//   credentials, native -> the URL is not playable as-is, but Tauri's HTTP
//                      client is not bound by CORS, so the file is fetched with
//                      the auth header and played from a blob. Correct, though
//                      the whole file lands before playback.
//   credentials, web -> not possible. A cross-origin fetch needs CORS the
//                      catalog almost never sends, and the element cannot
//                      authenticate. Callers surface this rather than falling
//                      back to the proxy; see canStreamOpdsAudio.
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  createBasicAuth,
  needsProxy,
  probeAuth,
  withOriginSuppressed,
} from '@/app/opds/utils/opdsReq';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { normalizeCustomHeaders } from '@/utils/customHeaders';
import { parseMp3Duration } from '@/utils/mp3Duration';
import type { CustomHeaders } from '@/utils/customHeaders';

export interface OpdsAudioAuth {
  authHeader: string | null;
  customHeaders: CustomHeaders;
  /** The catalog was saved with credentials, whatever the probe made of them. */
  hasCredentials: boolean;
}

/** Resolve the catalog's credentials once, for every track in a session. */
export const resolveOpdsAudioAuth = async (
  catalogId: string,
  probeUrl: string,
): Promise<OpdsAudioAuth> => {
  const settings = useSettingsStore.getState().settings;
  const catalog = settings.opdsCatalogs?.find((c) => c.id === catalogId);
  const username = catalog?.username || '';
  const password = catalog?.password || '';
  const customHeaders = normalizeCustomHeaders(catalog?.customHeaders);

  // Whether the catalog was saved WITH credentials is what decides the playback
  // path -- never whether the probe happened to succeed. `probeAuth` returns
  // null when only one half of the pair is stored, and throws outright if the
  // HEAD fails. Letting either downgrade us to an unauthenticated request is
  // what made the server answer 401 and the WebView pop its own Basic-auth
  // dialog, asking for the credentials the user already gave us (#6224).
  const hasCredentials = !!(username || password);
  if (!hasCredentials) {
    return { authHeader: null, customHeaders, hasCredentials: false };
  }

  let authHeader: string | null = null;
  try {
    authHeader = await probeAuth(probeUrl, username, password, needsProxy(probeUrl), customHeaders);
  } catch {
    // The probe is an optimisation for servers that want Digest; Basic is the
    // right answer for everything else and costs nothing to assume.
    authHeader = null;
  }
  return {
    authHeader: authHeader ?? createBasicAuth(username, password),
    customHeaders,
    hasCredentials: true,
  };
};

/** True when the catalog needs credentials the media element cannot supply. */
export const needsAudioAuth = (auth: OpdsAudioAuth): boolean =>
  !!auth.hasCredentials || !!auth.authHeader || Object.keys(auth.customHeaders).length > 0;

/**
 * True when the URL can go straight to a media element, which is also the only
 * case that gets real Range streaming. An authenticated catalog cannot.
 */
export const canStreamOpdsAudio = (auth: OpdsAudioAuth): boolean => !needsAudioAuth(auth);

/**
 * Why an authenticated catalog cannot be played here, or null when it can.
 * Web has no route left once the proxy is off the table; native still does.
 */
export const opdsAudioBlocker = (href: string, auth: OpdsAudioAuth): 'web-auth' | null =>
  needsAudioAuth(auth) && needsProxy(href) ? 'web-auth' : null;

/** The URL to give the media element: always the catalog's own. */
export const buildOpdsAudioUrl = (href: string): string => href;

/** Whole-file fetch for the BlobAudioClock fallback (authenticated native). */
export const fetchOpdsAudioBlob = async (
  href: string,
  auth: OpdsAudioAuth,
  mimeType: string,
): Promise<Blob> => {
  const headers = withOriginSuppressed({
    'User-Agent': READEST_OPDS_USER_AGENT,
    ...auth.customHeaders,
    ...(auth.authHeader ? { Authorization: auth.authHeader } : {}),
  });
  const doFetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const res = await doFetch(href, {
    headers,
    danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
  });
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
  return new Blob([await res.arrayBuffer()], { type: mimeType });
};

/** How long to wait for one file's metadata before giving up on it. */
const PROBE_TIMEOUT_MS = 20000;

/** Enough of an MP3 to carry the ID3 tag, first frame header and Xing tag. */
const HEAD_PROBE_BYTES = 16384;

/**
 * Duration read from the file's own header, or NaN when that isn't possible.
 *
 * This is what keeps a multi-track audiobook from downloading in full before
 * the first second plays: the media-element probe below has to fetch whole
 * files on a server that ignores Range, so a 12-part book cost 284 MB just to
 * build its timeline. Every field needed is in the first few KB (#6224).
 *
 * Bails rather than buffering whenever it cannot bound what it reads -- a
 * server that ignores our Range and hands back a whole 30 MB track is exactly
 * the case this exists to avoid.
 */
export const probeAudioDurationFromHead = async (
  url: string,
  auth: OpdsAudioAuth,
): Promise<number> => {
  const controller = new AbortController();
  try {
    const headers = withOriginSuppressed({
      'User-Agent': READEST_OPDS_USER_AGENT,
      ...auth.customHeaders,
      ...(auth.authHeader ? { Authorization: auth.authHeader } : {}),
      Range: `bytes=0-${HEAD_PROBE_BYTES - 1}`,
    });
    const doFetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const res = await doFetch(url, {
      headers,
      signal: controller.signal,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
    if (!res.ok) return NaN;

    // `Content-Range: bytes 0-16383/31255480` carries the real total; a server
    // that ignored the range reports it in Content-Length instead.
    const contentRange = res.headers.get('Content-Range');
    const total = contentRange
      ? Number(contentRange.split('/')[1])
      : Number(res.headers.get('Content-Length'));

    const body = res.body as ReadableStream<Uint8Array> | null;
    let head: Uint8Array;
    if (body?.getReader) {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let read = 0;
      while (read < HEAD_PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        read += value.length;
      }
      // Stop the transfer: without this a 200 response keeps streaming the
      // whole file even though we have what we need.
      controller.abort();
      head = new Uint8Array(read);
      let at = 0;
      for (const c of chunks) {
        head.set(c, at);
        at += c.length;
      }
    } else if (res.status === 206) {
      head = new Uint8Array(await res.arrayBuffer());
    } else {
      // No stream to stop and no range honoured: reading the body here would
      // pull the entire track, which is the cost we are avoiding.
      controller.abort();
      return NaN;
    }

    return parseMp3Duration(head, total);
  } catch {
    return NaN;
  }
};

/**
 * Read a track's duration by loading only its metadata.
 *
 * This is the piece OPDS cannot tell us, and the reason the proxy relays Range:
 * with range support the element fetches just the header, so probing an
 * 18-file audiobook costs a few KB. Against a server that ignores Range it
 * still works, but pays for the whole file -- hence the timeout and the
 * per-track NaN that buildOpdsAudioTracks knows how to drop.
 */
export const probeAudioDuration = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load(); // cancel any in-flight request
      resolve(value);
    };
    const timer = setTimeout(() => finish(NaN), PROBE_TIMEOUT_MS);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => finish(audio.duration));
    audio.addEventListener('error', () => finish(NaN));
    audio.src = url;
  });

/**
 * Probe every track. Sequential on purpose: a parallel probe of a many-file
 * audiobook opens one connection per file, which on a server without Range
 * means downloading the entire book at once.
 */
export const probeAudioDurations = async (
  urls: string[],
  sources?: { href: string; auth: OpdsAudioAuth }[],
): Promise<number[]> => {
  const durations: number[] = [];
  for (let i = 0; i < urls.length; i++) {
    // Cheap path first: a few KB off the catalog rather than the whole track.
    const source = sources?.[i];
    const fromHead = source ? await probeAudioDurationFromHead(source.href, source.auth) : NaN;
    durations.push(
      Number.isFinite(fromHead) && fromHead > 0 ? fromHead : await probeAudioDuration(urls[i]!),
    );
  }
  return durations;
};
