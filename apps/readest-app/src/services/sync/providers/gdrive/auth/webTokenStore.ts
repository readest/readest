/**
 * Browser-side Google Drive token store for the web build.
 *
 * Unlike native (a refresh token in the OS keychain), the web OAuth model yields
 * only a short-lived access token and no refresh token. It lives in
 * `sessionStorage` so it survives the OAuth redirect round-trip and in-tab
 * reloads, but is dropped when the tab closes — "connected" persists across
 * sessions via the `googleDrive.enabled` settings flag, and a new session
 * re-acquires the token by reconnecting.
 */
import type { TokenSet } from './tokenStore';

/** sessionStorage key holding the serialised {@link TokenSet}. */
const WEB_TOKEN_KEY = 'gdrive_web_token';

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

/** Persist the access token (+ expiry) for this tab/session. */
export const saveWebDriveToken = (tokens: TokenSet): void => {
  getStorage()?.setItem(WEB_TOKEN_KEY, JSON.stringify(tokens));
};

/** Load the stored token, or null when absent/unparseable. */
export const loadWebDriveToken = (): TokenSet | null => {
  const raw = getStorage()?.getItem(WEB_TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
};

/** Forget the stored token (Disconnect). */
export const clearWebDriveToken = (): void => {
  getStorage()?.removeItem(WEB_TOKEN_KEY);
};

/**
 * Whether a usable (non-expired) access token is stored. Lets the settings panel
 * show a "session expired" hint + Reconnect when the web token is gone/expired
 * (the connection stays `enabled`, but the short-lived token must be re-minted).
 */
export const hasValidWebDriveToken = (now: number = Date.now()): boolean => {
  const tokens = loadWebDriveToken();
  return !!tokens && now < tokens.expiresAt;
};
