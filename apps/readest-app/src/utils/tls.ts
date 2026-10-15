/**
 * Per-server opt-in for self-signed or mismatched TLS certificates on native
 * requests (KOSync, BookOrbit, OPDS, Audiobookshelf). Servers added since the
 * option existed store an explicit choice, off by default. A server saved
 * before it has no value and keeps the lenient behavior it shipped with, so an
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
