/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers for Google's OAuth 2.0
 * authorization-code flow, plus the matching authorization-URL builder.
 *
 * Readest ships as a distributed native app (desktop + mobile). Such public
 * clients cannot keep a client secret confidential, so the flow uses PKCE
 * instead: each authorization attempt mints a fresh random `verifier`, sends
 * only its SHA-256 `challenge` to the authorization endpoint, and later proves
 * possession of the original `verifier` at the token endpoint. This binds the
 * authorization code to this client and defeats code-interception attacks.
 *
 * Pure functions only — no network, no platform APIs beyond Web Crypto.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */

/**
 * Number of random bytes drawn for the code verifier. RFC 7636 §4.1 requires the
 * verifier to be 43-128 characters of the unreserved set; 64 bytes base64url-
 * encode to 86 characters, comfortably inside the window at high entropy.
 */
const VERIFIER_RANDOM_BYTES = 64;

/** Digest algorithm for the PKCE challenge; the only secure option per RFC 7636. */
const CHALLENGE_DIGEST_ALGORITHM = 'SHA-256';

/** Google's OAuth 2.0 authorization endpoint (the page where the user consents). */
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** OAuth query-parameter names sent to {@link GOOGLE_AUTH_ENDPOINT}. */
const AUTH_PARAM = {
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  responseType: 'response_type',
  scope: 'scope',
  codeChallenge: 'code_challenge',
  codeChallengeMethod: 'code_challenge_method',
  state: 'state',
  accessType: 'access_type',
  prompt: 'prompt',
} as const;

/** We run the authorization-code flow, so the endpoint must return a `code`. */
const RESPONSE_TYPE_CODE = 'code';

/** Tells Google the challenge is the SHA-256 (S256) transform, not plaintext. */
const CODE_CHALLENGE_METHOD_S256 = 'S256';

/**
 * `offline` makes Google issue a refresh token alongside the access token, so
 * the app can keep syncing after the short-lived access token expires without
 * sending the user back through consent.
 */
const ACCESS_TYPE_OFFLINE = 'offline';

/**
 * `consent` forces the consent screen every time. Google only returns a refresh
 * token on the *first* consent for a given client unless re-consent is forced,
 * so this guarantees `access_type=offline` actually yields a refresh token.
 */
const PROMPT_CONSENT = 'consent';

/** A cryptographically random PKCE verifier and its derived S256 challenge. */
export interface PkcePair {
  /** High-entropy secret kept by the client and replayed at the token endpoint. */
  verifier: string;
  /** Base64url(SHA-256(verifier)), the public value sent to the auth endpoint. */
  challenge: string;
}

/** Inputs needed to assemble the Google authorization URL. */
export interface AuthUrlParams {
  /** OAuth client ID registered for this app in Google Cloud. */
  clientId: string;
  /** Where Google redirects after consent (the reverse-DNS scheme). */
  redirectUri: string;
  /** Space-delimited OAuth scopes (e.g. the Drive app-file scope). */
  scope: string;
  /** The PKCE `code_challenge` produced by {@link createPkcePair}. */
  challenge: string;
  /** Opaque anti-CSRF value echoed back by Google for the caller to verify. */
  state: string;
}

/**
 * Encode raw bytes as base64url **without padding**, per RFC 7636 §A. PKCE
 * values travel in URLs, so `+`→`-`, `/`→`_`, and trailing `=` removed.
 */
const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Derive the PKCE `code_challenge` from a verifier (RFC 7636 §4.6: the S256
 * transform is `base64url(SHA-256(ASCII(verifier)))`).
 *
 * Exported so the exact transform is testable against the spec's known-answer
 * vector — the most common PKCE bug is hashing the raw verifier bytes instead
 * of the ASCII octets of the verifier string, which a random-input test cannot
 * catch.
 */
export const computeChallenge = async (verifier: string): Promise<string> => {
  const verifierBytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest(CHALLENGE_DIGEST_ALGORITHM, verifierBytes);
  return base64UrlEncode(new Uint8Array(digest));
};

/**
 * Create a fresh PKCE verifier/challenge pair. The verifier is base64url-encoded
 * random bytes, which keeps it inside the RFC 7636 unreserved-character set and
 * length window by construction.
 */
export const createPkcePair = async (): Promise<PkcePair> => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(VERIFIER_RANDOM_BYTES));
  const verifier = base64UrlEncode(randomBytes);
  const challenge = await computeChallenge(verifier);
  return { verifier, challenge };
};

/**
 * Build the Google authorization URL the user is sent to in order to grant
 * access. The caller opens this URL and later exchanges the returned `code` plus
 * the PKCE `verifier` for tokens.
 */
export const buildAuthUrl = ({
  clientId,
  redirectUri,
  scope,
  challenge,
  state,
}: AuthUrlParams): string => {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  const params = url.searchParams;
  params.set(AUTH_PARAM.clientId, clientId);
  params.set(AUTH_PARAM.redirectUri, redirectUri);
  params.set(AUTH_PARAM.responseType, RESPONSE_TYPE_CODE);
  params.set(AUTH_PARAM.scope, scope);
  params.set(AUTH_PARAM.codeChallenge, challenge);
  params.set(AUTH_PARAM.codeChallengeMethod, CODE_CHALLENGE_METHOD_S256);
  params.set(AUTH_PARAM.state, state);
  params.set(AUTH_PARAM.accessType, ACCESS_TYPE_OFFLINE);
  params.set(AUTH_PARAM.prompt, PROMPT_CONSENT);
  return url.toString();
};
