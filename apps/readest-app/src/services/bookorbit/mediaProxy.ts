// Streaming BookOrbit audio through the loopback media proxy.
//
// The proxy (see services/audiobook/mediaProxy and src-tauri/src/media_proxy.rs)
// is a real `http://127.0.0.1:<port>/<secret>` origin, which is what makes it
// the right transport here. BookOrbit serves its audio with
// `Cross-Origin-Resource-Policy: same-origin`, and under CEF a custom URI
// scheme cannot serve a range that starts anywhere but byte 0 (Chromium
// 40739128) -- so neither a direct URL nor a scheme of our own can stream and
// seek. The proxy fetches upstream in Rust, where CORP does not apply, and
// Chromium treats the loopback URL as ordinary network traffic, so `Range`
// works and only the part being listened to is fetched.
//
// The bearer lives proxy-side, keyed by origin: it never enters the URL a
// media element is given, and refreshing it leaves that URL valid.
import { getMediaProxyBase } from '@/services/audiobook/mediaProxy';
import { proxiedMediaUrl } from '@/services/audiobook/mediaProxy';
import { BookOrbitClient } from './client';
import { createBookOrbitClient } from './createClient';

/**
 * How often the registered bearer is replaced.
 *
 * BookOrbit's access token lasts 15 minutes, and the bytes are fetched by the
 * proxy rather than by the client, so an expiring token produces no 401 the
 * client could react to -- only a track that stops mid-chapter.
 */
export const PROXY_REFRESH_MS = 10 * 60 * 1000;

const originOf = (serverUrl: string): string | null => {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return null;
  }
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Re-register the origin with a freshly minted token. */
const refresh = async (): Promise<void> => {
  const client = createBookOrbitClient();
  const origin = client && originOf(client.serverUrl);
  if (!client || !origin) return;
  try {
    await client.refreshAccessToken();
    await getMediaProxyBase({ origin, authorization: `Bearer ${client.accessToken}` });
  } catch {
    // A server that is briefly unreachable keeps the token it has; the next
    // tick tries again.
  }
};

/**
 * A function turning an asset's server-relative path into a streamable URL, or
 * null where the proxy is unavailable (the web build, iOS, a proxy that failed
 * to start) and the caller must fall back to fetching whole tracks.
 */
export const openBookOrbitMediaProxy = async (
  client: BookOrbitClient,
): Promise<((contentPath: string) => string) | null> => {
  const origin = originOf(client.serverUrl);
  if (!origin) return null;
  // Narration resolves tracks from a client that has issued no API call yet,
  // so there may be no bearer to register.
  if (!client.accessToken) {
    try {
      await client.refreshAccessToken();
    } catch {
      return null;
    }
  }
  const base = await getMediaProxyBase({
    origin,
    authorization: `Bearer ${client.accessToken}`,
  });
  if (!base) return null;

  // Kept for the life of the process rather than per session: a media element
  // can request bytes long after the track was loaded, and the timer is one
  // login every ten minutes against the user's own server.
  if (!refreshTimer) refreshTimer = setInterval(() => void refresh(), PROXY_REFRESH_MS);
  return (contentPath: string) => proxiedMediaUrl(base, `${origin}${contentPath}`);
};
