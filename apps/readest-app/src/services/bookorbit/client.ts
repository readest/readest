// HTTP client for a BookOrbit server's audiobook API.
//
// Mirrors the platform fetch-selector idiom the OPDS and ABS clients use
// (window.fetch on web, the Tauri HTTP plugin on native, self-signed certs
// accepted, webview Origin suppressed — see #5698/#5765) rather than owning a
// second copy of it.
//
// Note what this client canNOT do: hand a URL to a media element. BookOrbit
// serves its audio with `Cross-Origin-Resource-Policy: same-origin` and no
// CORS headers, so the browser refuses to load it cross-origin whatever
// credentials are attached — which is why `fetchAsset` exists and both the
// player and read-along narration play BookOrbit audio from blobs.
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { withOriginSuppressed } from '@/app/opds/utils/opdsReq';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeCustomHeaders } from '@/utils/customHeaders';
import type { BookOrbitSettings } from '@/types/settings';
import { isSupportedManifest } from './manifest';
import type { BookOrbitManifest } from './manifest';

/** Body of `PUT /api/v1/audiobooks/:id/playback-state`, validated server-side. */
export interface BookOrbitPlaybackStateWrite {
  assetId: string;
  positionMs: number;
  /** ISO-8601, strict. */
  capturedAt: string;
  /** Idempotency key; a retried write must reuse it. */
  operationId: string;
  /** Revision this write is based on — the server rejects a stale one. */
  baseRevision: number;
  /** Ties the position to a manifest, so it cannot outlive the book's files. */
  manifestRevision: string;
}

export interface BookOrbitPlaybackState {
  assetId?: string;
  positionMs?: number;
  revision?: number;
  updatedAt?: string;
}

/**
 * The server this client talks to. Deliberately the settings row the KOReader
 * sync integration already fills in (`settings.bookorbit`) rather than a new
 * server type: the user configures one BookOrbit, and audiobook streaming
 * should not ask them to enter the same host and credentials twice.
 */
export type BookOrbitTarget = Pick<
  BookOrbitSettings,
  'serverUrl' | 'username' | 'password' | 'customHeaders'
> & {
  /** Short-lived bearer token, cached between requests by the caller. */
  accessToken?: string;
};

/** Raised when the server speaks a manifest schema this build does not know. */
export class UnsupportedManifestError extends Error {
  constructor(schema: unknown, version: unknown) {
    super(`unsupported BookOrbit manifest: ${String(schema)} v${String(version)}`);
    this.name = 'UnsupportedManifestError';
  }
}

export class BookOrbitAuthError extends Error {
  constructor() {
    super('BookOrbit authentication failed');
    this.name = 'BookOrbitAuthError';
  }
}

type TokenPatch = { accessToken: string };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}

const boFetch = (url: string, init: RequestOptions = {}): Promise<Response> => {
  const doFetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  return doFetch(url, {
    method: init.method ?? 'GET',
    headers: withOriginSuppressed(init.headers ?? {}),
    body: init.body,
    danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
  });
};

export class BookOrbitClient {
  #server: BookOrbitTarget;
  #base: string;
  #onTokensUpdated: (patch: TokenPatch) => void;
  #loginInFlight: Promise<void> | null = null;

  constructor(server: BookOrbitTarget, callbacks: { onTokensUpdated: (p: TokenPatch) => void }) {
    this.#server = { ...server };
    this.#base = server.serverUrl.replace(/\/+$/, '');
    this.#onTokensUpdated = callbacks.onTokensUpdated;
  }

  get server(): BookOrbitTarget {
    return this.#server;
  }

  /** Origin the assets live on, for the media proxy's allowlist. */
  get serverUrl(): string {
    return this.#base;
  }

  /** The cached bearer, empty until the first login. */
  get accessToken(): string {
    return this.#server.accessToken ?? '';
  }

  /**
   * Mint a fresh access token.
   *
   * Asset bytes are fetched by the media proxy, not by this client, so a token
   * expiring mid-track produces no 401 here to trigger the usual re-login: the
   * caller has to ask.
   */
  refreshAccessToken(): Promise<void> {
    return this.#login();
  }

  #fetch(path: string, init: RequestOptions = {}): Promise<Response> {
    return boFetch(`${this.#base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...normalizeCustomHeaders(this.#server.customHeaders),
        ...(this.#server.accessToken
          ? { Authorization: `Bearer ${this.#server.accessToken}` }
          : {}),
        ...init.headers,
      },
    });
  }

  /**
   * One request, retried once after re-authenticating on 401.
   *
   * BookOrbit's access token expires after 15 minutes, so a long listening
   * session WILL hit this; it is the normal path, not an error path.
   */
  async #request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    let res = await this.#fetch(path, init);
    if (res.status === 401) {
      await this.#login();
      res = await this.#fetch(path, init);
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new BookOrbitAuthError();
      throw new Error(`BookOrbit ${init.method ?? 'GET'} ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Deduped: three tracks expiring together must not trigger three logins. */
  #login(): Promise<void> {
    if (this.#loginInFlight) return this.#loginInFlight;
    this.#loginInFlight = this.#doLogin().finally(() => {
      this.#loginInFlight = null;
    });
    return this.#loginInFlight;
  }

  async #doLogin(): Promise<void> {
    const { username, password } = this.#server;
    if (!username && !password) throw new BookOrbitAuthError();

    const res = await boFetch(`${this.#base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new BookOrbitAuthError();

    const { accessToken } = (await res.json()) as { accessToken?: string };
    if (!accessToken) throw new BookOrbitAuthError();

    this.#server.accessToken = accessToken;
    // The store owns the durable copy: a token refreshed here has to reach the
    // next session, and any other client reading the row.
    this.#onTokensUpdated({ accessToken });
  }

  async getManifest(bookId: number): Promise<BookOrbitManifest> {
    const manifest = await this.#request<unknown>(`/api/v1/audiobooks/${bookId}/manifest`);
    if (!isSupportedManifest(manifest)) {
      const m = manifest as { schema?: unknown; schemaVersion?: unknown } | null;
      throw new UnsupportedManifestError(m?.schema, m?.schemaVersion);
    }
    return manifest;
  }

  getPlaybackState(bookId: number): Promise<BookOrbitPlaybackState> {
    return this.#request<BookOrbitPlaybackState>(`/api/v1/audiobooks/${bookId}/playback-state`);
  }

  putPlaybackState(bookId: number, state: BookOrbitPlaybackStateWrite): Promise<unknown> {
    return this.#request(`/api/v1/audiobooks/${bookId}/playback-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  }

  /**
   * An asset's bytes, fetched through the platform client.
   *
   * Must not be a browser `fetch` from page context: BookOrbit sends
   * `Cross-Origin-Resource-Policy: same-origin` on this route, so a webview
   * refuses it cross-origin. The Tauri HTTP client is not bound by that.
   */
  async fetchAsset(contentPath: string): Promise<Response> {
    let res = await this.#fetch(contentPath);
    if (res.status === 401) {
      await this.#login();
      res = await this.#fetch(contentPath);
    }
    return res;
  }
}
