// Loopback media proxy for streaming audiobook tracks on native platforms.
//
// The ABS API client fetches through the Tauri HTTP plugin with invalid
// certificates accepted, so a self-hosted server behind a self-signed HTTPS
// proxy connects and syncs fine. The WebView's <audio> element enforces the
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
import { isTauriAppPlatform } from '@/services/environment';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getOSPlatform } from '@/utils/misc';

/**
 * The `scheme://host:port` origins of every live Audiobookshelf server, from
 * the in-memory store AND persisted settings - the same two sources
 * `findABSServerById` resolves a book's server from. The player route can open
 * before the store is hydrated from settings, so reading only the store would
 * leave the allowlist empty and the proxy would refuse the very track the user
 * just opened.
 */
const absServerOrigins = (): string[] => {
  const stored = useABSServerStore.getState().servers;
  const persisted = useSettingsStore.getState().settings?.absServers ?? [];
  const origins = new Set<string>();
  for (const server of [...stored, ...persisted]) {
    if (server.deletedAt) continue;
    try {
      origins.add(new URL(server.url).origin);
    } catch {
      // A malformed stored URL simply isn't allowlisted.
    }
  }
  return [...origins];
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
  if (!isTauriAppPlatform() || getOSPlatform() === 'ios') return null;
  try {
    const origins = absServerOrigins();
    if (grant) origins.push(grant.origin);
    const auth = grant?.authorization ? { [grant.origin]: grant.authorization } : undefined;
    return await invoke<string>('get_media_proxy_base', { origins, auth });
  } catch (error) {
    console.warn('[ABS] media proxy unavailable, streaming tracks directly:', error);
    return null;
  }
};

/** The proxied form of an absolute track URL (token query included). */
export const proxiedMediaUrl = (base: string, upstreamUrl: string): string =>
  `${base}/media?u=${encodeURIComponent(upstreamUrl)}`;
