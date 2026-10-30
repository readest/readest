// Loopback media proxy for streaming audiobook tracks on native platforms.
//
// The ABS API client fetches through the Tauri HTTP plugin with invalid
// certificates accepted for a server the user opted in, so a self-hosted
// server behind a self-signed HTTPS proxy connects and syncs fine. The WebView's <audio> element enforces the
// platform's TLS trust instead and aborts the track request before a single
// byte leaves the device: the server logs the playback session but never a
// file request, and the player shows "Playback interrupted" (#6216). Routing
// the element at a Rust-side loopback proxy that fetches upstream with the
// same lenient client makes playback behave like the API calls that got the
// book into the library in the first place.
//
// The proxy is started lazily by the `get_media_proxy_base` command, which
// returns its base (`http://127.0.0.1:<port>/<per-launch secret>`). The command
// only reaches the configured Audiobookshelf origins passed to it, so a leaked
// secret cannot make it an open relay; the origins are re-sent on every call so
// a server added mid-session becomes reachable without restarting the proxy.

import { invoke } from '@tauri-apps/api/core';
import { stat } from '@tauri-apps/plugin-fs';
import { getInitializedAppService, isTauriAppPlatform } from '@/services/environment';
import { useABSServerStore } from '@/store/absServerStore';
import type { ABSServer } from '@/types/audiobookshelf';
import { useSettingsStore } from '@/store/settingsStore';
import { allowsSelfSignedCert } from '@/utils/tls';

/**
 * The `scheme://host:port` origins of every live Audiobookshelf server, from
 * the in-memory store AND persisted settings - the same two sources
 * `findABSServerById` resolves a book's server from. The player route can open
 * before the store is hydrated from settings, so reading only the store would
 * leave the allowlist empty and the proxy would refuse the very track the user
 * just opened. `strict` lists the origins a server verifies certificates for;
 * a server's store copy wins over a possibly stale persisted one.
 */
const absServerOrigins = (): { origins: Set<string>; strict: Set<string> } => {
  const stored = useABSServerStore.getState().servers;
  const persisted = useSettingsStore.getState().settings?.absServers ?? [];
  const liveUrl = (server: ABSServer): URL | null => {
    if (server.deletedAt) return null;
    try {
      return new URL(server.url);
    } catch {
      // A malformed stored URL simply isn't allowlisted.
      return null;
    }
  };
  const origins = new Set<string>();
  const strict = new Set<string>();
  const add = (url: URL, server: ABSServer) => {
    origins.add(url.origin);
    if (!allowsSelfSignedCert(server)) strict.add(url.origin);
  };
  const storedUrls = new Set<string>();
  for (const server of stored) {
    const url = liveUrl(server);
    if (!url) continue;
    storedUrls.add(url.href);
    add(url, server);
  }
  for (const server of persisted) {
    const url = liveUrl(server);
    if (url && !storedUrls.has(url.href)) add(url, server);
  }
  return { origins, strict };
};

/** The BookOrbit server's origin when the user verifies its certificate. */
const strictBookOrbitOrigin = (): string | null => {
  const bookorbit = useSettingsStore.getState().settings?.bookorbit;
  if (!bookorbit?.serverUrl || !bookorbit.password || allowsSelfSignedCert(bookorbit)) return null;
  try {
    return new URL(bookorbit.serverUrl).origin;
  } catch {
    return null;
  }
};

/** A server the proxy may reach that is not an Audiobookshelf instance. */
export interface MediaProxyGrant {
  /** `scheme://host:port` of the upstream server. */
  origin: string;
  /**
   * `Authorization` header to send there, for a server that authenticates by
   * header rather than by a token in the URL. Held proxy-side, so it never
   * reaches the DOM and a refreshed token leaves the track URL untouched.
   */
  authorization?: string;
  /** The server accepts a self-signed certificate (see `allowsSelfSignedCert`). */
  allowSelfSignedCert?: boolean;
}

/**
 * Base URL of the loopback media proxy, or null where the direct URL is the
 * right one: the web (fetch and media share one TLS policy, nothing to
 * bridge), iOS (its AVPlayer clocks - NativeAudiobookClock and the narration
 * player - take the direct URL), and a proxy that failed to start. Callers
 * then stream directly, as before.
 *
 * `grant` adds one more origin for this call, for a source that is not
 * Audiobookshelf. The allowlist is merged on every call, so granting again
 * with a fresh credential replaces the one it supersedes.
 */
export const getMediaProxyBase = async (grant?: MediaProxyGrant): Promise<string | null> => {
  if (!isTauriAppPlatform() || getInitializedAppService()?.isIOSApp) return null;
  try {
    // A certificate belongs to the origin, so servers sharing one share its
    // policy: an origin any of them verifies is verified for all of them, in
    // every call, so one server's opt-in never loosens another's.
    const { origins, strict } = absServerOrigins();
    const bookOrbitStrict = strictBookOrbitOrigin();
    if (bookOrbitStrict) strict.add(bookOrbitStrict);
    if (grant) {
      origins.add(grant.origin);
      if (!allowsSelfSignedCert(grant)) strict.add(grant.origin);
    }
    const selfSigned = [...origins].filter((origin) => !strict.has(origin));
    const auth = grant?.authorization ? { [grant.origin]: grant.authorization } : undefined;
    return await invoke<string>('get_media_proxy_base', {
      origins: [...origins],
      auth,
      selfSigned,
    });
  } catch (error) {
    console.warn('[ABS] media proxy unavailable, streaming tracks directly:', error);
    return null;
  }
};

/** The proxied form of an absolute track URL (token query included). */
export const proxiedMediaUrl = (base: string, upstreamUrl: string): string =>
  `${base}/media?u=${encodeURIComponent(upstreamUrl)}`;

/**
 * A loopback URL serving bytes [start, end) of a local file, with `Range`
 * support, so a media element can stream and seek audio stored inside a book
 * without the file being read into the WebView first. Null where there is no
 * proxy (see getMediaProxyBase) or the file is outside the asset scope.
 */
export const getMediaFileUrl = async (
  path: string,
  start: number,
  end: number,
  contentType: string,
): Promise<string | null> => {
  if (!isTauriAppPlatform() || getInitializedAppService()?.isIOSApp) return null;
  try {
    return await invoke<string>('get_media_file_url', { path, start, end, contentType });
  } catch (error) {
    console.warn('media proxy cannot serve the book file:', error);
    return null;
  }
};

/**
 * getMediaFileUrl for a whole local audio file. On desktop the asset protocol
 * answers a range request with at most 1,000 KiB, and macOS WebKit gives up on
 * a recording whose index is bigger than that: a long M4B reports "The
 * operation is not supported" and stays silent (#6848).
 */
export const getLocalMediaUrl = async (
  path: string,
  contentType: string,
): Promise<string | null> => {
  const size = await stat(path).then(
    (info) => info.size,
    () => null,
  );
  return size === null ? null : await getMediaFileUrl(path, 0, size, contentType);
};
