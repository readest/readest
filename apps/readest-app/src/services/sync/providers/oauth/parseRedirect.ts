/**
 * Parse the OAuth redirect Google sends back after the consent screen and pull
 * out the authorization `code`, with redirect-target and CSRF protection.
 *
 * The authorization-code flow returns its result as query parameters on a
 * custom-scheme deep link
 * (`com.googleusercontent.apps.<id>:/oauthredirect?code=...&state=...`). Every
 * platform funnels that URL through this single pure helper — no network, no
 * platform APIs — so the security-critical checks live in exactly one place.
 *
 * The PKCE `state` value minted in `pkce.ts`'s `buildAuthUrl` is echoed back here
 * unchanged; comparing it to the value we generated is the CSRF guard that proves
 * this redirect answers *our* authorization request and was not injected by an
 * attacker.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */

/** Redirect query-parameter names Google returns. */
const REDIRECT_PARAM = {
  code: 'code',
  state: 'state',
  error: 'error',
} as const;

/** The authorization `code` extracted from a successful redirect. */
export interface RedirectResult {
  /** Short-lived authorization code to exchange for tokens at the token endpoint. */
  code: string;
}

/**
 * Extract the authorization `code` from an OAuth redirect URL, verifying the URL
 * targets our exact redirect URI and that the returned `state` matches the one
 * we sent.
 *
 * @param redirectUrl - the full redirect URL captured from the deep-link intent.
 * @param expectedState - the `state` we generated for this authorization attempt
 *   (see `buildAuthUrl`); the redirect's `state` must equal it.
 * @param expectedRedirectUri - the exact reverse-DNS redirect URI we requested;
 *   the redirect's scheme + path must match it. Defense-in-depth on top of the
 *   ingress scheme filter so a scheme-prefix-but-wrong-path URL cannot slip in.
 * @returns the authorization `code` on success.
 * @throws if the URL is not our redirect target, the provider reported an error,
 *   the `state` fails the CSRF check, or no `code` is present — each with a
 *   message naming which check failed.
 */
export const parseRedirect = (
  redirectUrl: string,
  expectedState: string,
  expectedRedirectUri: string,
): RedirectResult => {
  const url = new URL(redirectUrl);
  const expected = new URL(expectedRedirectUri);

  // Target guard: the redirect must be aimed at the exact scheme + path we
  // registered. A custom-scheme URL parses with `protocol` = the scheme (incl.
  // trailing ':') and `pathname` = the part after it. Anything else is not our
  // redirect, so reject before reading any of its params.
  if (url.protocol !== expected.protocol || url.pathname !== expected.pathname) {
    throw new Error(
      `OAuth redirect target mismatch: expected "${expected.protocol}${expected.pathname}", ` +
        `got "${url.protocol}${url.pathname}"`,
    );
  }

  const params = url.searchParams;

  // Error-first: when the user denies consent (or Google aborts), the redirect
  // carries an `error` param and no `code`. Surfacing the provider's reason is
  // the most actionable signal, so it must win over the CSRF/missing-code checks.
  const error = params.get(REDIRECT_PARAM.error);
  if (error) {
    throw new Error(`OAuth redirect returned an error: ${error}`);
  }

  // CSRF guard: the redirect must echo back the exact `state` we generated for
  // this attempt; a mismatch means it does not answer our request.
  const state = params.get(REDIRECT_PARAM.state);
  if (state !== expectedState) {
    throw new Error(
      `OAuth redirect state mismatch (CSRF guard): expected "${expectedState}", got "${state}"`,
    );
  }

  // A redirect with no `code` is unusable — there is nothing to exchange for
  // tokens — so fail loudly instead of returning an empty code.
  const code = params.get(REDIRECT_PARAM.code);
  if (!code) {
    throw new Error('OAuth redirect is missing the authorization code');
  }

  return { code };
};
