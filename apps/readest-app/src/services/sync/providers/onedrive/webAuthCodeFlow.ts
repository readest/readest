/**
 * Full-page redirect OAuth for OneDrive on the Readest **web** build, using the
 * authorization-code + PKCE flow (unlike gdrive's implicit flow): Microsoft's
 * SPA token endpoint is CORS-enabled, so a secretless browser client can do the
 * code exchange itself and receives a rotating refresh token. That lets the
 * shared `PersistedOAuth` refresh transparently on web too, instead of gdrive's
 * session-only access token that forces a reconnect every tab session.
 *
 * Full-page (not popup) for the same reason as gdrive: Readest web serves
 * `Cross-Origin-Opener-Policy: same-origin` (for Turso's SharedArrayBuffer),
 * which severs a popup's `window.opener` handle and breaks popup OAuth.
 *
 * The PKCE verifier, CSRF state, and post-connect return path are stashed in
 * sessionStorage before navigating away; the callback route
 * (`WEB_OAUTH_CALLBACK_PATH`) reads them back to complete the code exchange.
 */
import { buildAuthUrl, createPkcePair } from '@/services/sync/providers/oauth/pkce';
import {
  exchangeCode,
  type FetchFn,
  type TokenSet,
} from '@/services/sync/providers/oauth/tokenEndpoint';
import type { TokenPersistence } from '@/services/sync/providers/oauth/keychainTokenStore';
import {
  MICROSOFT_AUTH_ENDPOINT,
  MICROSOFT_TOKEN_ENDPOINT,
  ONEDRIVE_SCOPE,
} from './microsoftOAuthConfig';

/** sessionStorage keys for the PKCE verifier, CSRF state, and return path. */
const VERIFIER_KEY = 'onedrive_web_oauth_verifier';
const STATE_KEY = 'onedrive_web_oauth_state';
const RETURN_KEY = 'onedrive_web_oauth_return';
/** sessionStorage key holding the serialised {@link TokenSet}. */
const WEB_TOKEN_KEY = 'onedrive_web_token';

/** Path of the OAuth callback route (must match the registered redirect URI). */
export const WEB_OAUTH_CALLBACK_PATH = '/onedrive-callback';

/** The redirect URI for the current origin (register this on the Web client). */
export const oneDriveWebRedirectUri = (): string =>
  `${window.location.origin}${WEB_OAUTH_CALLBACK_PATH}`;

/**
 * Begin the connect: mint a PKCE pair + CSRF state, stash them plus the return
 * path in sessionStorage, then navigate the whole page to Microsoft. The
 * returned promise deliberately never resolves — the page unloads here, and the
 * auth code returns to the callback route instead.
 */
export const beginWebOneDriveRedirect = async ({
  clientId,
  returnPath,
}: {
  clientId: string;
  returnPath: string;
}): Promise<void> => {
  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();
  window.sessionStorage.setItem(VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(STATE_KEY, state);
  window.sessionStorage.setItem(RETURN_KEY, returnPath);
  const url = buildAuthUrl({
    clientId,
    redirectUri: oneDriveWebRedirectUri(),
    scope: ONEDRIVE_SCOPE,
    challenge,
    state,
    authEndpoint: MICROSOFT_AUTH_ENDPOINT,
    extraParams: { prompt: 'select_account' },
  });
  window.location.assign(url);
  return new Promise<void>(() => {});
};

/** Read and clear the stored CSRF state (one-shot). */
export const consumeWebOAuthState = (): string | null => {
  const state = window.sessionStorage.getItem(STATE_KEY);
  window.sessionStorage.removeItem(STATE_KEY);
  return state;
};

/** Read and clear the stored PKCE verifier (one-shot), needed for the code exchange. */
export const consumeWebPkceVerifier = (): string | null => {
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);
  window.sessionStorage.removeItem(VERIFIER_KEY);
  return verifier;
};

/**
 * Read and clear the stored return path. Falls back to `/`, and rejects
 * anything that isn't a same-origin absolute path (open-redirect guard).
 */
export const consumeReturnPath = (): string => {
  const path = window.sessionStorage.getItem(RETURN_KEY);
  window.sessionStorage.removeItem(RETURN_KEY);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
};

/** Exchange the callback's authorization code + PKCE verifier for a token set. */
export const exchangeWebAuthCode = ({
  clientId,
  code,
  verifier,
  redirectUri,
  fetchFn,
}: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchFn: FetchFn;
}): Promise<TokenSet> =>
  exchangeCode(
    { code, verifier, clientId, redirectUri, tokenEndpoint: MICROSOFT_TOKEN_ENDPOINT },
    fetchFn,
  );

/**
 * Browser-side OneDrive token store for the web build. Lives in sessionStorage
 * so it survives the OAuth redirect round-trip and in-tab reloads, but is
 * dropped when the tab closes. Mirrors gdrive's `webTokenStore.ts`.
 */
const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

/** Persist the token set (access + refresh + expiry) for this tab/session. */
export const saveWebOneDriveToken = (tokens: TokenSet): void => {
  getStorage()?.setItem(WEB_TOKEN_KEY, JSON.stringify(tokens));
};

/** Load the stored token, or null when absent/unparseable. */
export const loadWebOneDriveToken = (): TokenSet | null => {
  const raw = getStorage()?.getItem(WEB_TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
};

/** Forget the stored token (Disconnect). */
export const clearWebOneDriveToken = (): void => {
  getStorage()?.removeItem(WEB_TOKEN_KEY);
};

/** Whether a usable (non-expired) access token is stored. */
export const hasValidWebOneDriveToken = (now: number = Date.now()): boolean => {
  const tokens = loadWebOneDriveToken();
  return !!tokens && now < tokens.expiresAt;
};

/**
 * SessionStorage-backed {@link TokenPersistence} so the shared `PersistedOAuth`
 * can be reused unchanged for web auth (no separate web auth class): refreshed
 * tokens from Microsoft's CORS-enabled SPA token endpoint round-trip through
 * sessionStorage exactly like the native keychain persistence does on-device.
 */
export const webOneDriveTokenPersistence: TokenPersistence = {
  load: async () => loadWebOneDriveToken(),
  save: async (tokens: TokenSet) => saveWebOneDriveToken(tokens),
  clear: async () => clearWebOneDriveToken(),
};
