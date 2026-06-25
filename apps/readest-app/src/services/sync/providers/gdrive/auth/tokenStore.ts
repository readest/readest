/**
 * Google OAuth 2.0 token endpoint operations for the PKCE authorization-code
 * flow: exchanging an authorization `code` for tokens, and later refreshing the
 * short-lived access token.
 *
 * Readest's official Google client is the iOS application type, which has NO
 * client secret — neither request sends one. The authorization code is instead
 * bound to this client by replaying the PKCE `code_verifier` (see `pkce.ts`).
 *
 * The request/parse logic is pure given an injected `fetch`, which keeps it
 * testable without a network and platform-agnostic.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */

/** Google's OAuth 2.0 token endpoint (exchanges/refreshes tokens). */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Renew the access token this many seconds *before* its real expiry. Google
 * reports the lifetime via `expires_in`; trimming the usable lifetime by a small
 * margin guarantees the token is comfortably valid for the duration of any
 * single request we make with it, despite client/Google clock skew.
 */
export const TOKEN_EXPIRY_SAFETY_MARGIN_SEC = 60;

/** Milliseconds per second — `expires_in` is in seconds, `expiresAt` in ms. */
const MS_PER_SEC = 1000;

/** Token-request form field names. */
const TOKEN_PARAM = {
  grantType: 'grant_type',
  code: 'code',
  codeVerifier: 'code_verifier',
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  refreshToken: 'refresh_token',
} as const;

/** OAuth grant types this module uses at the token endpoint. */
const GRANT_TYPE = {
  authorizationCode: 'authorization_code',
  refreshToken: 'refresh_token',
} as const;

/** The token endpoint expects a URL-encoded form body, not JSON. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const CONTENT_TYPE_HEADER = 'Content-Type';
const HTTP_POST = 'POST';

/**
 * Injected fetch implementation. Typed narrowly to exactly what this module
 * needs so callers can pass the platform's `fetch` (or a stub in tests).
 */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** A set of tokens with the access token's expiry resolved to absolute time. */
export interface TokenSet {
  /** Short-lived bearer token used to authorize Google API calls. */
  accessToken: string;
  /** Long-lived token used to mint new access tokens; absent on refresh. */
  refreshToken?: string;
  /** Absolute expiry as epoch milliseconds, already adjusted for the margin. */
  expiresAt: number;
}

/** Inputs for {@link exchangeCode}. */
export interface ExchangeCodeParams {
  /** Authorization code Google returned to the redirect URI. */
  code: string;
  /** PKCE verifier whose challenge was sent to the authorization endpoint. */
  verifier: string;
  /** OAuth client ID registered for this app in Google Cloud. */
  clientId: string;
  /** Redirect URI used in the authorization request; must match exactly. */
  redirectUri: string;
}

/** Inputs for {@link refreshAccessToken}. */
export interface RefreshTokenParams {
  /** Refresh token obtained from a prior {@link exchangeCode}. */
  refreshToken: string;
  /** OAuth client ID registered for this app in Google Cloud. */
  clientId: string;
}

/**
 * Raw JSON shape Google's token endpoint returns on success. Modeled explicitly
 * (rather than `any`) so the mapping into {@link TokenSet} is type-checked.
 */
interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  /** Access-token lifetime in seconds from the moment of issue. */
  expires_in: number;
}

/** Which token-endpoint call is being made; used only for error labelling. */
type TokenOperation = 'exchange' | 'refresh';

/**
 * Best-effort read of Google's error payload so a thrown error can name the
 * cause. The token endpoint returns `{ error, error_description }` on failure
 * (e.g. `invalid_grant`, `redirect_uri_mismatch`) — the most useful signal when
 * debugging the live flow. Reading the body can itself fail, so any problem
 * collapses to no detail rather than masking the original HTTP error.
 */
const readErrorDetail = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    const parts = [body.error, body.error_description].filter(Boolean);
    return parts.length > 0 ? `: ${parts.join(' — ')}` : '';
  } catch {
    return '';
  }
};

/**
 * POST a form body to the token endpoint, parse the JSON, and map it into a
 * {@link TokenSet}. Shared by both operations so the request/parse/error logic
 * lives in exactly one place.
 */
const requestTokens = async (
  params: URLSearchParams,
  operation: TokenOperation,
  fetchFn: FetchFn,
): Promise<TokenSet> => {
  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: HTTP_POST,
    headers: { [CONTENT_TYPE_HEADER]: FORM_CONTENT_TYPE },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`Google token ${operation} failed with HTTP ${res.status}${detail}`);
  }

  const data = (await res.json()) as TokenEndpointResponse;
  // Clamp so an unusually short-lived token (expires_in <= margin) is never
  // assigned an expiry in the past, which would mark a just-issued token as
  // already expired and trigger a needless immediate refresh.
  const usableLifetimeSec = Math.max(0, data.expires_in - TOKEN_EXPIRY_SAFETY_MARGIN_SEC);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + usableLifetimeSec * MS_PER_SEC,
  };
};

/**
 * Exchange an authorization `code` (plus the PKCE `verifier`) for an access and
 * refresh token. PKCE binds the code to this client; no client secret is sent
 * (Readest's client is the iOS application type, which has none).
 */
export const exchangeCode = (
  { code, verifier, clientId, redirectUri }: ExchangeCodeParams,
  fetchFn: FetchFn,
): Promise<TokenSet> => {
  const params = new URLSearchParams();
  params.set(TOKEN_PARAM.grantType, GRANT_TYPE.authorizationCode);
  params.set(TOKEN_PARAM.code, code);
  params.set(TOKEN_PARAM.codeVerifier, verifier);
  params.set(TOKEN_PARAM.clientId, clientId);
  params.set(TOKEN_PARAM.redirectUri, redirectUri);
  return requestTokens(params, 'exchange', fetchFn);
};

/**
 * Trade a refresh token for a fresh access token once the previous one nears
 * expiry. Google does not return a new refresh token here, so the caller keeps
 * the existing one.
 */
export const refreshAccessToken = (
  { refreshToken, clientId }: RefreshTokenParams,
  fetchFn: FetchFn,
): Promise<TokenSet> => {
  const params = new URLSearchParams();
  params.set(TOKEN_PARAM.grantType, GRANT_TYPE.refreshToken);
  params.set(TOKEN_PARAM.refreshToken, refreshToken);
  params.set(TOKEN_PARAM.clientId, clientId);
  return requestTokens(params, 'refresh', fetchFn);
};
