/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers for an OAuth 2.0
 * authorization-code flow, plus the matching authorization-URL builder. The
 * authorization endpoint and any extra query params are provider-specific and
 * supplied by the caller (see {@link AuthUrlParams}).
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

/** A cryptographically random PKCE verifier and its derived S256 challenge. */
export interface PkcePair {
  /** High-entropy secret kept by the client and replayed at the token endpoint. */
  verifier: string;
  /** Base64url(SHA-256(verifier)), the public value sent to the auth endpoint. */
  challenge: string;
}

/** Inputs needed to assemble the authorization URL. */
export interface AuthUrlParams {
  /** OAuth client ID registered for this app with the provider. */
  clientId: string;
  /** Where the provider redirects after consent (the reverse-DNS scheme). */
  redirectUri: string;
  /** Space-delimited OAuth scopes (e.g. the Drive app-file scope). */
  scope: string;
  /** The PKCE `code_challenge` produced by {@link createPkcePair}. */
  challenge: string;
  /** Opaque anti-CSRF value echoed back by the provider for the caller to verify. */
  state: string;
  /** Authorization endpoint (provider-specific: Google / Microsoft). */
  authEndpoint: string;
  /** Extra provider-specific query params (e.g. Google access_type/prompt). */
  extraParams?: Record<string, string>;
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
 * Build the authorization URL the user is sent to in order to grant access. The
 * caller opens this URL and later exchanges the returned `code` plus the PKCE
 * `verifier` for tokens. `authEndpoint` and `extraParams` are provider-specific
 * (e.g. Google's `access_type`/`prompt`), so every provider builds its own URL
 * from the same PKCE + state shape.
 */
export const buildAuthUrl = ({
  clientId,
  redirectUri,
  scope,
  challenge,
  state,
  authEndpoint,
  extraParams,
}: AuthUrlParams): string => {
  const url = new URL(authEndpoint);
  const params = url.searchParams;
  params.set('client_id', clientId);
  params.set('redirect_uri', redirectUri);
  params.set('response_type', 'code');
  params.set('scope', scope);
  params.set('code_challenge', challenge);
  params.set('code_challenge_method', 'S256');
  params.set('state', state);
  for (const [k, v] of Object.entries(extraParams ?? {})) params.set(k, v);
  return url.toString();
};
