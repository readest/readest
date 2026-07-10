/**
 * Android wiring of the OAuth authorization-code + PKCE flow: a Chrome Custom Tab
 * + reverse-DNS custom-scheme redirect.
 *
 * Android can't use a loopback redirect (the system browser can't hand a
 * `http://127.0.0.1` back to the app). Instead we use the reverse-DNS scheme an
 * iOS-type Google client issues — `com.googleusercontent.apps.<id>:/oauthredirect`
 * — registered as a BROWSABLE deep-link intent-filter so the OS routes the
 * redirect back to the app.
 *
 * Consent opens in a CHROME CUSTOM TAB via Readest's native bridge command
 * `auth_with_custom_tab` (the same one the Supabase login uses), NOT an external
 * browser: a separate browser app backgrounds the single Tauri Activity and the
 * OS can destroy it under memory pressure, tearing down the in-flight promise +
 * redirect listener (observed on-device: first attempt fails, second succeeds). A
 * Custom Tab renders inside the host task and keeps the process at foreground
 * importance; the redirect resolves through a native field that survives a WebView
 * reload. The native command opens consent AND resolves with the redirect URL in
 * one round trip, recognising it by the reverse-DNS scheme parsed from the auth
 * URL's `redirect_uri`.
 *
 * The iOS-type client has NO secret and needs NO Android SHA-1 — Google validates
 * the redirect by string-matching the client-id-derived scheme, and PKCE is the
 * real client authentication. This holds only while App Check (iOS attestation)
 * is off — an Android device can't produce an iOS attestation, so enabling it
 * would break every user; keep it off.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
import { authWithCustomTab } from '@/app/auth/utils/nativeAuth';
import { createPkcePair } from './pkce';
import { runOAuthFlow, type OAuthClientConfig } from './oauthFlow';
import { exchangeCode, type FetchFn, type TokenSet } from './tokenEndpoint';

/**
 * Run the Android Custom-Tab OAuth flow and return the resulting tokens. Wires
 * {@link runOAuthFlow} with the Android mechanics: open consent in a Chrome
 * Custom Tab and resolve with the redirect the native bridge captures.
 */
export const runAndroidOAuth = (config: OAuthClientConfig, fetchFn: FetchFn): Promise<TokenSet> => {
  const redirectUri = config.redirectUri;

  // `auth_with_custom_tab` opens consent AND resolves with the redirect URL in a
  // single native round-trip — so it needs the auth URL, which `runOAuthFlow`
  // only hands to `openUrl`. Bridge the two with a deferred: `openUrl` supplies
  // the URL, and `awaitRedirect` (invoked first) waits for it before driving the
  // Custom Tab. The native side recognises the redirect by its reverse-DNS
  // scheme, so only the auth URL needs to cross over.
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
      const { redirectUrl } = await authWithCustomTab({ authUrl });
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
