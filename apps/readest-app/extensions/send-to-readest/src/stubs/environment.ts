/**
 * Stub for `@/services/environment` used inside the extension build. The
 * conversion modules only consume `isTauriAppPlatform` from this module —
 * the extension is never Tauri, so it always returns `false`, which routes
 * `assetBundler`/`faviconFetcher` through `globalThis.fetch` (CORS-free in
 * the SW thanks to `host_permissions: ["<all_urls>"]`).
 *
 * Other exports from the real `environment.ts` (web-platform checks, base
 * URLs, CLI flags) are never reached from the conversion code path, so we
 * intentionally don't reproduce them here — the smaller the stub, the
 * smaller the bundle.
 */
export const isTauriAppPlatform = (): boolean => false;
