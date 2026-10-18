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

/** Tauri HTTP plugin options for a request to a server with this choice. */
export const tlsFetchOptions = (allowSelfSigned: boolean) =>
  allowSelfSigned ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } } : {};
