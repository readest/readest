import type { ClientOptions } from '@tauri-apps/plugin-http';

/**
 * Per-server choice to accept self-signed or mismatched TLS certificates on
 * native requests (KOSync, BookOrbit, OPDS, Audiobookshelf). It is on unless
 * the user turns it off, as every server was before the option existed, so an
 * upgrade doesn't cut off a working self-hosted setup.
 */
export interface SelfSignedCertOption {
  allowSelfSignedCert?: boolean;
}

export const allowsSelfSignedCert = (server: SelfSignedCertOption): boolean =>
  server.allowSelfSignedCert !== false;

/**
 * Whether a request to `url` may accept a self-signed certificate under the
 * choice of the server or catalog at `owner.url`. The choice covers that
 * origin only, like its credentials: a link its content points at on another
 * origin is verified. Without an owner URL (a feed opened without a saved
 * catalog) the default applies to every origin.
 */
export const allowsSelfSignedCertAt = (
  owner: SelfSignedCertOption & { url?: string },
  url: string,
): boolean => {
  if (!allowsSelfSignedCert(owner)) return false;
  if (!owner.url) return true;
  try {
    return new URL(url, owner.url).origin === new URL(owner.url).origin;
  } catch {
    return false;
  }
};

/** Tauri HTTP plugin options for a request to a server with this choice. */
export const tlsFetchOptions = (allowSelfSigned: boolean) =>
  allowSelfSigned ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } } : {};

type TlsAwareFetch = (url: string, init: RequestInit & ClientOptions) => Promise<Response>;

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * Fetches `url` under a server's certificate choice. An accepted self-signed
 * certificate covers the request's own origin only, so redirects are followed
 * here hop by hop: a hop to another origin is verified and sent without
 * credentials, as the HTTP client does for any cross-host redirect.
 */
export const tlsFetch = async (
  fetch: TlsAwareFetch,
  url: string,
  init: RequestInit,
  allowSelfSigned: boolean,
): Promise<Response> => {
  if (!allowSelfSigned) return fetch(url, init);
  const start = url;
  let request = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, { ...request, ...tlsFetchOptions(true), maxRedirections: 0 });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get('Location');
    if (!location) return res;
    await res.body?.cancel();
    url = new URL(location, url).href;
    if (res.status !== 307 && res.status !== 308 && request.method !== 'HEAD') {
      request = { ...request, method: 'GET', body: undefined };
    }
    if (new URL(url).origin !== new URL(start).origin) {
      const headers = Object.fromEntries(new Headers(request.headers));
      for (const name of CREDENTIAL_HEADERS) delete headers[name];
      return fetch(url, { ...request, headers });
    }
  }
  throw new Error('Too many redirects');
};
