import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type {
  ABSLibrary,
  ABSLibraryItem,
  ABSMediaProgress,
  ABSPlaybackSession,
  ABSServer,
} from '@/types/audiobookshelf';

const PAGE_SIZE = 100;
const ABS_DEVICE_ID_KEY = 'readest-abs-device-id';

/**
 * tauri-plugin-http appends the webview origin (`tauri://localhost`, or
 * `http://tauri.localhost` on Android/Windows) as the Origin header of every
 * request unless the caller sets one. A native client has no business
 * asserting a browser origin, and any Origin-checking middlebox in front of
 * the media server rejects the unrecognized value before authentication ever
 * happens (see #5698, fixed for OPDS in #5765). An explicit empty Origin
 * instructs the plugin (built with the `unsafe-headers` feature) to drop the
 * header entirely, matching what native clients send.
 *
 * This replicates `withOriginSuppressed` from
 * `src/app/opds/utils/opdsReq.ts` rather than importing it: that module
 * also computes `OPDS_PROXY_URL` from `getAPIBaseUrl()` at import time,
 * which would pull the OPDS proxy env-config into every ABS request path
 * for no benefit (Origin suppression only matters for native requests; web
 * requests keep the browser's real Origin so the ABS server's CORS
 * allowlist can match it).
 */
const withOriginSuppressed = (headers: Record<string, string>): Record<string, string> =>
  isTauriAppPlatform() && !Object.keys(headers).some((key) => key.toLowerCase() === 'origin')
    ? { Origin: '', ...headers }
    : headers;

const SUPPORTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
];

/**
 * Per-device id sent as deviceInfo.deviceId when opening a playback session,
 * so the server can tell devices apart in its session list. KOSyncClient and
 * BookOrbitClient instead read a `deviceId` already minted into settings for
 * those specific providers (see settingsService.ts); ABSServer carries no
 * such field, so this client keeps its own, persisted the same way
 * useInboxDrainer's device id is (a localStorage-backed UUID under a
 * dedicated key).
 */
const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem(ABS_DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ABS_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

export class ABSRequestError extends Error {
  status: number;
  constructor(status: number, path: string) {
    super(`Audiobookshelf request to ${path} failed with status ${status}`);
    this.name = 'ABSRequestError';
    this.status = status;
  }
}

export class ABSAuthError extends Error {
  status: number;
  constructor(status: number, path: string) {
    super(`Audiobookshelf authentication failed for ${path} with status ${status}`);
    this.name = 'ABSAuthError';
    this.status = status;
  }
}

interface ABSRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

type ABSTokenPatch = Pick<ABSServer, 'accessToken' | 'refreshToken' | 'serverVersion'>;

/** Shape of the `user` object Audiobookshelf returns from /login and /auth/refresh. */
interface ABSAuthUser {
  /** Legacy long-lived token, pre-2.26 servers. */
  token?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface ABSLoginResponse {
  user?: ABSAuthUser;
  serverSettings?: { version?: string };
}

interface ABSRefreshResponse {
  user?: ABSAuthUser;
}

/**
 * Typed client for the Audiobookshelf HTTP API: login/token refresh,
 * libraries, items, playback sessions, and progress sync.
 *
 * Mirrors the platform fetch-selector idiom from
 * `src/app/opds/utils/opdsReq.ts` (window.fetch on web, the Tauri HTTP
 * plugin on native, self-signed certs accepted, and the webview's Origin
 * header suppressed on native LAN requests, see #5698/#5765) rather than
 * owning its own copy of that logic. On the web platform, API calls hit
 * the ABS server directly and rely on its opt-in CORS support (the
 * `ALLOW_CORS=1` env var or the `allowedOrigins` server setting must
 * cover the Readest web origin). Media and cover URLs are also direct —
 * `<audio>`/`<img>` element fetches aren't subject to CORS anyway.
 * Media URLs are built by `openAudiobook`'s
 * `resolveUrl` closure (it re-reads the store's live access token on every
 * track load, which a client-captured copy could not do); the client only
 * owns `buildCoverUrl`.
 */
export class ABSClient {
  #server: ABSServer;
  #base: string;
  #onTokensUpdated: (patch: ABSTokenPatch) => void;
  #refreshInFlight: Promise<void> | null = null;

  constructor(server: ABSServer, callbacks: { onTokensUpdated: (patch: ABSTokenPatch) => void }) {
    this.#server = { ...server };
    this.#base = server.url.replace(/\/+$/, '');
    this.#onTokensUpdated = callbacks.onTokensUpdated;
  }

  async #fetch(path: string, init: ABSRequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = withOriginSuppressed({
      Accept: 'application/json',
      ...(this.#server.accessToken ? { Authorization: `Bearer ${this.#server.accessToken}` } : {}),
      ...init.headers,
    });
    const method = init.method ?? 'GET';
    const absoluteUrl = `${this.#base}${path}`;
    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    return fetch(absoluteUrl, {
      method,
      headers,
      body: init.body,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
  }

  /** #fetch, retrying once on 401 after a token refresh / re-login. */
  async #request<T>(path: string, init: ABSRequestOptions = {}): Promise<T> {
    let res = await this.#fetch(path, init);
    if (res.status === 401) {
      await this.#refreshOrRelogin();
      res = await this.#fetch(path, init);
    }
    if (res.status === 401) {
      throw new ABSAuthError(res.status, path);
    }
    if (!res.ok) {
      throw new ABSRequestError(res.status, path);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Single-flight: concurrent 401s (e.g. a periodic `syncSession` racing a
   * UI-triggered read) collapse into one refresh, or one credential
   * re-login, instead of each independently spending the same refresh
   * token. A server that rotates refresh tokens on use would otherwise
   * reject every refresh past the first, so the second caller would fall
   * through to an extra `/login` (or fail outright with no stored
   * credentials) despite the first refresh having already succeeded.
   * Mirrors `PersistedOAuth.refresh` in
   * `src/services/sync/providers/oauth/persistedOAuth.ts`.
   */
  async #refreshOrRelogin(): Promise<void> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    this.#refreshInFlight = this.#doRefreshOrRelogin().finally(() => {
      this.#refreshInFlight = null;
    });
    return this.#refreshInFlight;
  }

  async #doRefreshOrRelogin(): Promise<void> {
    let refreshError: unknown;
    if (this.#server.refreshToken) {
      try {
        const res = await this.#fetch('/auth/refresh', {
          method: 'POST',
          headers: { 'x-refresh-token': this.#server.refreshToken },
        });
        if (res.ok) {
          const data = (await res.json()) as ABSRefreshResponse;
          const accessToken = data.user?.accessToken;
          if (accessToken) {
            this.#server.accessToken = accessToken;
            this.#server.refreshToken = data.user?.refreshToken ?? this.#server.refreshToken;
            this.#onTokensUpdated({
              accessToken: this.#server.accessToken,
              refreshToken: this.#server.refreshToken,
              serverVersion: this.#server.serverVersion,
            });
            return;
          }
        } else {
          refreshError = new ABSAuthError(res.status, '/auth/refresh');
        }
      } catch (e) {
        // Network failure refreshing the token; fall through to credential
        // re-login below, same as a rejected refresh response.
        refreshError = e;
      }
    }
    if (this.#server.username && this.#server.password) {
      await this.login();
      return;
    }
    throw refreshError ?? new ABSAuthError(401, '/auth/refresh');
  }

  async login(): Promise<void> {
    const res = await this.#fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.#server.username, password: this.#server.password }),
    });
    if (!res.ok) {
      throw new ABSAuthError(res.status, '/login');
    }
    const data = (await res.json()) as ABSLoginResponse;
    const accessToken = data.user?.accessToken ?? data.user?.token;
    const refreshToken = data.user?.refreshToken;
    const serverVersion = data.serverSettings?.version;
    this.#server.accessToken = accessToken;
    this.#server.refreshToken = refreshToken;
    this.#server.serverVersion = serverVersion;
    this.#onTokensUpdated({ accessToken, refreshToken, serverVersion });
  }

  async authorize(): Promise<boolean> {
    try {
      const res = await this.#fetch('/api/authorize', { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getLibraries(): Promise<ABSLibrary[]> {
    const data = await this.#request<{ libraries: ABSLibrary[] }>('/api/libraries');
    return data.libraries;
  }

  async getLibraryItems(libraryId: string): Promise<ABSLibraryItem[]> {
    const items: ABSLibraryItem[] = [];
    let page = 0;
    for (;;) {
      const data = await this.#request<{ total: number; results: ABSLibraryItem[] }>(
        `/api/libraries/${libraryId}/items?limit=${PAGE_SIZE}&page=${page}`,
      );
      items.push(...data.results);
      if (data.results.length === 0 || items.length >= data.total) break;
      page += 1;
    }
    return items;
  }

  async getItemExpanded(itemId: string): Promise<ABSLibraryItem> {
    return this.#request<ABSLibraryItem>(`/api/items/${itemId}?expanded=1`);
  }

  async getMe(): Promise<{ mediaProgress: ABSMediaProgress[] }> {
    return this.#request<{ mediaProgress: ABSMediaProgress[] }>('/api/me');
  }

  async openPlaybackSession(itemId: string, episodeId?: string): Promise<ABSPlaybackSession> {
    // Normalized here too (not just at AbsProgressSyncer's ctor) so any
    // caller that passes '' gets the same "no episode" book-level path,
    // one consistent rule across the client, the progress syncer's
    // mediaProgress matcher, and its localStorage key.
    const normalizedEpisodeId = episodeId || undefined;
    const path = normalizedEpisodeId
      ? `/api/items/${itemId}/play/${encodeURIComponent(normalizedEpisodeId)}`
      : `/api/items/${itemId}/play`;
    return this.#request<ABSPlaybackSession>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceInfo: { clientName: 'Readest', deviceId: getDeviceId() },
        supportedMimeTypes: SUPPORTED_MIME_TYPES,
        mediaPlayer: 'html5',
      }),
    });
  }

  async syncSession(
    sessionId: string,
    payload: { currentTime: number; timeListened: number; duration: number },
  ): Promise<void> {
    await this.#request<void>(`/api/session/${sessionId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async closeSession(
    sessionId: string,
    payload: { currentTime: number; timeListened: number; duration: number },
  ): Promise<void> {
    await this.#request<void>(`/api/session/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async patchProgress(
    libraryItemId: string,
    payload: { currentTime: number; duration: number; progress: number },
  ): Promise<void> {
    await this.#request<void>(`/api/me/progress/${libraryItemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /** Absolute, unauthenticated cover URL. */
  buildCoverUrl(itemId: string): string {
    return `${this.#base}/api/items/${itemId}/cover`;
  }
}
