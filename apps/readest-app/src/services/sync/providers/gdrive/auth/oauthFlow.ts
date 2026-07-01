/**
 * Provider-agnostic orchestration of the OAuth 2.0 authorization-code flow with
 * PKCE — the single place where the end-to-end sequence lives.
 *
 * The sequence (mint PKCE + state → build the auth URL → open it and capture the
 * redirect → verify target/state and pull the code → exchange for tokens) is
 * identical on every platform; only *how* the URL is opened and *how* the
 * redirect is captured differ. Those platform mechanics are injected as
 * {@link OAuthFlowDeps} so this module needs no Tauri plugins and no network,
 * which makes the security-critical glue (state/PKCE handling) unit-testable
 * headlessly while the desktop/mobile wrappers supply the real wiring.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
import { buildAuthUrl } from './pkce';
import { parseRedirect } from './parseRedirect';
import type { TokenSet } from './tokenStore';

/**
 * The OAuth client identity a platform wrapper needs to run a flow. The redirect
 * URI is *not* here because it is platform-derived from the client id (the
 * reverse-DNS scheme).
 */
export interface OAuthClientConfig {
  /** OAuth client ID registered for this app in Google Cloud. */
  clientId: string;
  /** Space-delimited OAuth scopes to request (e.g. the Drive app-file scope). */
  scope: string;
}

/**
 * Platform mechanics the flow needs, injected so the orchestration stays pure.
 * The real desktop/mobile wirings provide these from Tauri plugins; tests pass
 * fakes. Each dependency is typed precisely to what the flow calls.
 */
export interface OAuthFlowDeps {
  /** Mint a fresh PKCE verifier/challenge pair (see `pkce.ts`'s `createPkcePair`). */
  createPkcePair: () => Promise<{ verifier: string; challenge: string }>;
  /** Mint a fresh opaque anti-CSRF `state` value (e.g. `crypto.randomUUID`). */
  newState: () => string;
  /** OAuth client ID registered for this app in Google Cloud. */
  clientId: string;
  /** Open the authorization URL where the user consents (browser / deep link). */
  openUrl: (url: string) => Promise<void>;
  /** Resolve with the full redirect URL once the provider bounces back. */
  awaitRedirect: (redirectUri: string) => Promise<string>;
  /** Reverse-DNS redirect URI for this client; must match the auth request. */
  redirectUri: string;
  /** Exchange the authorization `code` (+ PKCE verifier) for tokens. */
  exchange: (args: { code: string; verifier: string; redirectUri: string }) => Promise<TokenSet>;
}

/**
 * Run the OAuth authorization-code + PKCE flow and return the resulting tokens.
 *
 * @param scope - space-delimited OAuth scopes to request (passed in, never
 *   hardcoded, so this stays provider/feature-agnostic).
 * @param deps - injected platform mechanics; see {@link OAuthFlowDeps}.
 * @returns the {@link TokenSet} from the token exchange.
 * @throws if the redirect fails the target/CSRF check, carries a provider error,
 *   or lacks a code (via `parseRedirect`), or if the exchange itself fails.
 */
export const runOAuthFlow = async (scope: string, deps: OAuthFlowDeps): Promise<TokenSet> => {
  const { challenge, verifier } = await deps.createPkcePair();
  // `state` is minted here and verified by `parseRedirect` below; this is the
  // CSRF guard proving the redirect answers *our* request, so it must be a fresh
  // unguessable value per attempt and never reused across calls.
  const state = deps.newState();

  const authUrl = buildAuthUrl({
    clientId: deps.clientId,
    redirectUri: deps.redirectUri,
    scope,
    challenge,
    state,
  });

  // Begin awaiting the redirect BEFORE opening the consent URL: opening can race
  // ahead (the user may consent and the provider may redirect before a listener
  // attached afterwards is ready), so the capture must already be armed.
  const redirectPromise = deps.awaitRedirect(deps.redirectUri);
  await deps.openUrl(authUrl);
  const redirectUrl = await redirectPromise;

  // Verifies the redirect target + state (CSRF) and extracts the code, throwing
  // with a specific reason on error/mismatch/missing-code.
  const { code } = parseRedirect(redirectUrl, state, deps.redirectUri);

  // PKCE binds this code to us via the verifier whose challenge we sent above;
  // redirectUri must match the one in the auth request exactly, so reuse it.
  return deps.exchange({ code, verifier, redirectUri: deps.redirectUri });
};
