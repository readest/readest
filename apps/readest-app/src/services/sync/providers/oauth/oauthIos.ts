/**
 * iOS wiring of the OAuth authorization-code + PKCE flow: an
 * `ASWebAuthenticationSession` + reverse-DNS custom-scheme redirect.
 *
 * Like Android, iOS can't use a loopback redirect, so we use the reverse-DNS
 * scheme the iOS-type Google client issues —
 * `com.googleusercontent.apps.<id>:/oauthredirect` — registered in
 * `Info-ios.plist` `CFBundleURLTypes` so the OS routes the redirect back.
 *
 * Consent opens in an `ASWebAuthenticationSession` via Readest's native bridge
 * command `auth_with_safari` (the same one the Supabase login uses). That session
 * intercepts the redirect by its `callbackURLScheme` — so unlike the desktop
 * deep-link runner, no app-wide URL listener is needed: the native command opens
 * consent AND resolves with the redirect URL in one round trip. The callback
 * scheme is the bare reverse-DNS scheme derived from the client id (no path),
 * which is exactly what `ASWebAuthenticationSession` matches on.
 *
 * The iOS-type client has NO secret — Google validates the redirect by
 * string-matching the client-id-derived scheme, and PKCE is the real client
 * authentication. This holds only while App Check (iOS attestation) is off.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
import { authWithSafari } from '@/app/auth/utils/nativeAuth';
import { createPkcePair } from './pkce';
import { runOAuthFlow, type OAuthClientConfig } from './oauthFlow';
import { exchangeCode, type FetchFn, type TokenSet } from './tokenEndpoint';

/**
 * Run the iOS `ASWebAuthenticationSession` OAuth flow and return the resulting
 * tokens. Wires {@link runOAuthFlow} with the iOS mechanics: open consent in a
 * web-auth session keyed to the reverse-DNS callback scheme and resolve with the
 * redirect the native bridge captures.
 */
export const runIosOAuth = (config: OAuthClientConfig, fetchFn: FetchFn): Promise<TokenSet> => {
  const redirectUri = config.redirectUri;
  // ASWebAuthenticationSession matches on the bare scheme (no path); pass the
  // client-id-derived reverse-DNS scheme so the native session recognises the
  // `com.googleusercontent.apps.<id>:/oauthredirect?...` bounce-back.
  const callbackScheme = config.redirectScheme;

  // `auth_with_safari` opens consent AND resolves with the redirect URL in a
  // single native round-trip — so it needs the auth URL, which `runOAuthFlow`
  // only hands to `openUrl`. Bridge the two with a deferred: `openUrl` supplies
  // the URL, and `awaitRedirect` (invoked first) waits for it before driving the
  // web-auth session.
  let provideAuthUrl!: (url: string) => void;
  const authUrlReady = new Promise<string>((resolve) => {
    provideAuthUrl = resolve;
  });

  return runOAuthFlow(config.scope, {
    createPkcePair,
    newState: () => crypto.randomUUID(),
    clientId: config.clientId,
    openUrl: async (url) => {
      provideAuthUrl(url);
    },
    awaitRedirect: async () => {
      const authUrl = await authUrlReady;
      const { redirectUrl } = await authWithSafari({ authUrl, callbackScheme });
      return redirectUrl;
    },
    redirectUri,
    authEndpoint: config.authEndpoint,
    authParams: config.authParams,
    exchange: ({ code, verifier, redirectUri: uri }) =>
      exchangeCode(
        {
          code,
          verifier,
          clientId: config.clientId,
          redirectUri: uri,
          tokenEndpoint: config.tokenEndpoint,
        },
        fetchFn,
      ),
  });
};
