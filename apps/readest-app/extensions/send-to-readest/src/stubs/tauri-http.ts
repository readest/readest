/**
 * Stub for `@tauri-apps/plugin-http` used inside the extension build. The
 * conversion modules import `tauriFetch` from this package but only invoke
 * it inside `isTauriAppPlatform()` branches — and our environment stub
 * makes that always false, so this function is never actually called at
 * runtime in the extension.
 *
 * We still need a real export so webpack can resolve the module. Throwing
 * if it's somehow reached keeps the bug obvious instead of letting a
 * silent no-op corrupt an EPUB.
 */
export const fetch = (): Promise<Response> => {
  throw new Error('Tauri fetch is not available in the browser extension');
};
