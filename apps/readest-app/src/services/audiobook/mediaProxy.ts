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
// The proxy is started lazily by the `get_media_proxy_base` command and its
// base (`http://127.0.0.1:<port>/<per-launch secret>`) cached for the session.

import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

let basePromise: Promise<string | null> | null = null;

/**
 * Base URL of the loopback media proxy, or null where the direct URL is the
 * right one: the web (fetch and media share one TLS policy, nothing to
 * bridge), iOS (its AVPlayer clocks - NativeAudiobookClock and the narration
 * player - take the direct URL), and a proxy that failed to start. Callers
 * then stream directly, as before.
 */
export const getMediaProxyBase = (): Promise<string | null> => {
  if (!isTauriAppPlatform() || getOSPlatform() === 'ios') return Promise.resolve(null);
  if (!basePromise) {
    basePromise = invoke<string>('get_media_proxy_base').catch((error: unknown) => {
      console.warn('[ABS] media proxy unavailable, streaming tracks directly:', error);
      basePromise = null;
      return null;
    });
  }
  return basePromise;
};

/** The proxied form of an absolute track URL (token query included). */
export const proxiedMediaUrl = (base: string, upstreamUrl: string): string =>
  `${base}/media?u=${encodeURIComponent(upstreamUrl)}`;
