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
