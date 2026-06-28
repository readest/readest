/**
 * Full-page redirect OAuth for the Readest **web** build (the implicit / token
 * response, `response_type=token`).
 *
 * Why redirect and not a popup or GIS: Readest web serves
 * `Cross-Origin-Opener-Policy: same-origin` (for Turso's SharedArrayBuffer), which
 * severs a popup's opener handle — so GIS / any popup OAuth reports `popup_closed`
 * instantly. A full-page redirect doesn't rely on `window.opener`, so it works
 * under that COOP. The token comes back in the URL fragment of a dedicated
 * `/gdrive-callback` route; the secretless Web client can't do a code exchange,
 * so we use the implicit token response (same `response_type=token` GIS used).
 *
 * No refresh token in this model — the access token is short-lived and the user
 * reconnects per session (a server-side token broker would be needed for
 * background refresh; out of scope here).
 */
import { TOKEN_EXPIRY_SAFETY_MARGIN_SEC, type TokenSet } from './tokenStore';

/** Google's OAuth 2.0 authorization endpoint. */
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const MS_PER_SEC = 1000;
/** Fallback lifetime if Google omits `expires_in` (access tokens are ~1h). */
const DEFAULT_TOKEN_LIFETIME_SEC = 3600;

/** sessionStorage keys for the CSRF state + post-connect return path. */
const STATE_KEY = 'gdrive_web_oauth_state';
const RETURN_KEY = 'gdrive_web_oauth_return';

/** Path of the OAuth callback route (must match the registered redirect URI). */
export const WEB_OAUTH_CALLBACK_PATH = '/gdrive-callback';

/** The redirect URI for the current origin (register this on the Web client). */
export const webDriveRedirectUri = (): string =>
  `${window.location.origin}${WEB_OAUTH_CALLBACK_PATH}`;

/**
 * Build the Google authorization URL for the implicit (token) flow. `state` is a
 * CSRF nonce validated on the callback; `include_granted_scopes` keeps any scopes
 * the user already granted to Readest.
 */
export const buildImplicitAuthUrl = ({
  clientId,
  scope,
  redirectUri,
  state,
}: {
  clientId: string;
  scope: string;
  redirectUri: string;
  state: string;
}): string => {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('include_granted_scopes', 'true');
  return url.toString();
};

export interface ImplicitRedirectResult {
  accessToken?: string;
  /** Absolute expiry (epoch ms), margin-adjusted; present only with a token. */
  expiresAt?: number;
  state?: string;
  error?: string;
}

/**
 * Parse the implicit redirect's URL fragment (`#access_token=…&state=…` or
 * `#error=…`). Returns the token + computed expiry, or the error.
 */
export const parseImplicitRedirect = (hash: string): ImplicitRedirectResult => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token') ?? undefined;
  const state = params.get('state') ?? undefined;
  const error = params.get('error') ?? undefined;
  const expiresInSec = Number(params.get('expires_in') ?? DEFAULT_TOKEN_LIFETIME_SEC);
  const lifetimeSec = Math.max(0, expiresInSec - TOKEN_EXPIRY_SAFETY_MARGIN_SEC);
  const expiresAt = accessToken ? Date.now() + lifetimeSec * MS_PER_SEC : undefined;
  return { accessToken, expiresAt, state, error };
};

/** Convenience: build a {@link TokenSet} from a successful parse, or null. */
export const tokenSetFromRedirect = (result: ImplicitRedirectResult): TokenSet | null =>
  result.accessToken && result.expiresAt
    ? { accessToken: result.accessToken, expiresAt: result.expiresAt }
    : null;

/**
 * Begin the connect: stash the CSRF state + return path, then navigate the whole
 * page to Google. The page unloads here; the token returns to the callback route.
 */
export const beginWebDriveRedirect = ({
  clientId,
  scope,
  redirectUri,
  returnPath,
}: {
  clientId: string;
  scope: string;
  redirectUri: string;
  returnPath: string;
}): void => {
  const state = crypto.randomUUID();
  window.sessionStorage.setItem(STATE_KEY, state);
  window.sessionStorage.setItem(RETURN_KEY, returnPath);
  window.location.assign(buildImplicitAuthUrl({ clientId, scope, redirectUri, state }));
};

/** Read and clear the stored CSRF state (one-shot). */
export const consumeOAuthState = (): string | null => {
  const state = window.sessionStorage.getItem(STATE_KEY);
  window.sessionStorage.removeItem(STATE_KEY);
  return state;
};

/**
 * Read and clear the stored return path. Falls back to `/`, and rejects anything
 * that isn't a same-origin absolute path (open-redirect guard).
 */
export const consumeReturnPath = (): string => {
  const path = window.sessionStorage.getItem(RETURN_KEY);
  window.sessionStorage.removeItem(RETURN_KEY);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
};
