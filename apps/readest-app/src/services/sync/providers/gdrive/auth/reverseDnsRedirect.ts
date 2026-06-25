/**
 * The reverse-DNS OAuth redirect shared by every platform's runner.
 *
 * Readest uses ONE iOS-type Google client (no secret, no SHA-1) on every
 * platform, whose only Google-accepted redirect is the reverse-DNS "iOS URL
 * scheme" — {@link GOOGLE_OAUTH_REDIRECT_SCHEME_PREFIX} followed by the client
 * id's identifier part. Both the desktop deep-link runner and the Android
 * Custom-Tab runner derive the exact same redirect from the client id here, so
 * the auth request, the token exchange, and the registered intent-filter /
 * desktop scheme stay byte-for-byte in agreement.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */

/**
 * Scheme prefix of Google's reverse-DNS "iOS URL scheme". The redirect scheme is
 * this followed by the client id's identifier part. Exported so the deep-link
 * ingress filter detects and skips OAuth redirect URLs without restating the
 * literal.
 */
export const GOOGLE_OAUTH_REDIRECT_SCHEME_PREFIX = 'com.googleusercontent.apps.';

/** Suffix every Google OAuth client id ends with; stripped to form the scheme. */
const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/** Path the redirect targets after the reverse-DNS scheme (a SINGLE slash). */
const OAUTH_REDIRECT_PATH = ':/oauthredirect';

/**
 * Derive the reverse-DNS redirect SCHEME from a Google OAuth client id.
 *
 * Google issues an iOS-type client the scheme
 * {@link GOOGLE_OAUTH_REDIRECT_SCHEME_PREFIX}`<X>`, where `<X>` is the client id
 * minus its `.apps.googleusercontent.com` suffix. This is the bare scheme (no
 * path) — what an OS intent-filter / registry key registers. Lower-cased
 * because OS scheme matching is case-sensitive and lowercase.
 */
export const deriveReverseDnsRedirectScheme = (clientId: string): string => {
  const identifier = clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)
    ? clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length)
    : clientId;
  return `${GOOGLE_OAUTH_REDIRECT_SCHEME_PREFIX}${identifier.toLowerCase()}`;
};

/**
 * Derive the full reverse-DNS redirect URI from a Google OAuth client id: the
 * {@link deriveReverseDnsRedirectScheme} scheme followed by `:/oauthredirect`
 * (a SINGLE slash). Deriving it — rather than hardcoding one builder's value —
 * keeps the auth request, the token exchange, and the registered redirect in
 * byte-for-byte agreement.
 */
export const deriveReverseDnsRedirectUri = (clientId: string): string =>
  `${deriveReverseDnsRedirectScheme(clientId)}${OAUTH_REDIRECT_PATH}`;

/**
 * Whether an OS-delivered URL is *this* client's reverse-DNS OAuth redirect.
 *
 * Used by the desktop deep-link runner and the deep-link ingress filter to pick
 * our redirect out of the stream of URLs the OS can hand the app (book files,
 * other deep links). Matched case-insensitively because Windows can relaunch the
 * app with a differently-cased scheme in argv than was registered; the trailing
 * `:` is required so a scheme that is a prefix of a longer one cannot false-match.
 */
export const matchesReverseDnsRedirect = (url: string, scheme: string): boolean =>
  url.toLowerCase().startsWith(`${scheme.toLowerCase()}:`);
