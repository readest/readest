import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { withOriginSuppressed } from '@/app/opds/utils/opdsReq';
import type { GrimmorySettings } from '@/types/settings';
import { normalizeCustomHeaders } from '@/utils/customHeaders';
import { stubTranslation as _ } from '@/utils/misc';
import { isLanAddress } from '@/utils/network';
import { allowsSelfSignedCert, tlsFetch } from '@/utils/tls';
import { getAPIBaseUrl, isTauriAppPlatform } from '../environment';
import type {
  GrimmoryAnnotation,
  GrimmoryAnnotationCreate,
  GrimmoryAnnotationUpdate,
  GrimmoryBook,
  GrimmoryBookmark,
  GrimmoryBookmarkCreate,
  GrimmoryBookmarkUpdate,
  GrimmoryBookType,
  GrimmoryProgressUpdate,
  GrimmoryProxyPayload,
  GrimmoryReadStatus,
  GrimmoryReadingSession,
  GrimmorySessionPage,
} from './types';

export type GrimmoryConnection = Pick<
  GrimmorySettings,
  'serverUrl' | 'username' | 'password' | 'customHeaders' | 'allowSelfSignedCert'
>;

export class GrimmoryRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GrimmoryRequestError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestInit {
  method?: Method;
  headers?: Record<string, string>;
  body?: unknown;
}

// Access tokens last two hours. Keep them for the life of the app, shared by
// every client for the same account, so each sync pass doesn't sign in again.
const tokens = new Map<string, string>();
const logins = new Map<string, Promise<string>>();

export const normalizeGrimmoryServerUrl = (url: string): string => url.trim().replace(/\/+$/, '');

/** Identifies the account a stored match or mapping belongs to. */
export const grimmoryAccountKey = (config: Pick<GrimmorySettings, 'serverUrl' | 'username'>) =>
  `${normalizeGrimmoryServerUrl(config.serverUrl)}|${config.username}`;

const errorMessage = async (response: Response): Promise<string> => {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return `Grimmory request failed with status ${response.status}`;
};

/**
 * Client for a Grimmory server's REST API. Signs in with the account's
 * username and password and sends the bearer token; a 401 signs in again once.
 */
export class GrimmoryClient {
  private config: GrimmoryConnection;
  private serverUrl: string;
  private accountKey: string;

  constructor(config: GrimmoryConnection) {
    this.config = config;
    this.serverUrl = normalizeGrimmoryServerUrl(config.serverUrl);
    this.accountKey = grimmoryAccountKey(config);
  }

  private async send(path: string, init: RequestInit, token?: string): Promise<Response> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {
      ...normalizeCustomHeaders(this.config.customHeaders),
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    };
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    // The web build can't reach a public server directly when its CORS policy
    // leaves Readest out, so it goes through the proxy; a LAN server is out of
    // the proxy's reach and is fetched directly.
    if (isTauriAppPlatform() || isLanAddress(this.serverUrl)) {
      return await tlsFetch(
        isTauriAppPlatform() ? tauriFetch : window.fetch,
        `${this.serverUrl}${path}`,
        { method, headers: withOriginSuppressed(headers), body },
        allowsSelfSignedCert(this.config),
      );
    }
    const payload: GrimmoryProxyPayload = {
      serverUrl: this.serverUrl,
      path,
      method,
      headers,
      body,
    };
    return await fetch(`${getAPIBaseUrl()}/grimmory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  private async login(): Promise<string> {
    const inFlight = logins.get(this.accountKey);
    if (inFlight) return inFlight;
    const login = (async () => {
      const response = await this.send('/api/v1/auth/login', {
        method: 'POST',
        body: { username: this.config.username, password: this.config.password },
      });
      if (!response.ok) {
        throw new GrimmoryRequestError(response.status, await errorMessage(response));
      }
      // A wrong Server URL can land on a page that answers 200 with HTML.
      const data: unknown = await response.json().catch(() => null);
      const token =
        data && typeof data === 'object' && 'accessToken' in data
          ? (data as { accessToken: unknown }).accessToken
          : null;
      if (typeof token !== 'string' || !token) {
        throw new GrimmoryRequestError(0, _('Not a Grimmory server. Check the Server URL.'));
      }
      tokens.set(this.accountKey, token);
      return token;
    })().finally(() => logins.delete(this.accountKey));
    logins.set(this.accountKey, login);
    return login;
  }

  private async authorized(path: string, init: RequestInit = {}): Promise<Response> {
    let token = tokens.get(this.accountKey) ?? (await this.login());
    let response = await this.send(path, init, token);
    if (response.status === 401) {
      tokens.delete(this.accountKey);
      token = await this.login();
      response = await this.send(path, init, token);
    }
    return response;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.authorized(path, init);
    if (!response.ok) {
      throw new GrimmoryRequestError(response.status, await errorMessage(response));
    }
    return (await response.json()) as T;
  }

  private async call(path: string, init: RequestInit, allowNotFound = false): Promise<void> {
    const response = await this.authorized(path, init);
    if (response.ok || (allowNotFound && response.status === 404)) return;
    throw new GrimmoryRequestError(response.status, await errorMessage(response));
  }

  private connectionFailure(error: unknown) {
    if (error instanceof GrimmoryRequestError && error.status === 401) {
      return { success: false, message: _('Invalid credentials.') };
    }
    return { success: false, message: (error as Error).message || _('Connection error.') };
  }

  async connect(): Promise<{ success: boolean; message?: string }> {
    try {
      tokens.delete(this.accountKey);
      await this.login();
      await this.json<{ current?: string }>('/api/v1/version');
      return { success: true };
    } catch (error) {
      return this.connectionFailure(error);
    }
  }

  /** Reuses the session, unlike {@link connect}: a sync may be using that token. */
  async checkConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.json<{ current?: string }>('/api/v1/version');
      return { success: true };
    } catch (error) {
      return this.connectionFailure(error);
    }
  }

  listBooks(): Promise<GrimmoryBook[]> {
    return this.json<GrimmoryBook[]>('/api/v1/books');
  }

  getBook(bookId: number): Promise<GrimmoryBook> {
    return this.json<GrimmoryBook>(`/api/v1/books/${bookId}`);
  }

  /** Bytes [start, end) of a book file, via an HTTP Range request. */
  async readContent(
    bookId: number,
    bookType: GrimmoryBookType | null | undefined,
    start: number,
    end: number,
  ): Promise<Uint8Array> {
    const query = bookType ? `?bookType=${encodeURIComponent(bookType)}` : '';
    const response = await this.authorized(`/api/v1/books/${bookId}/content${query}`, {
      headers: { Accept: '*/*', Range: `bytes=${start}-${end - 1}` },
    });
    if (!response.ok) {
      throw new GrimmoryRequestError(
        response.status,
        `Content request failed (${response.status})`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A server that ignores Range sends the whole file from byte 0.
    return response.status === 206 ? bytes : bytes.slice(start, end);
  }

  getAnnotations(bookId: number): Promise<GrimmoryAnnotation[]> {
    return this.json<GrimmoryAnnotation[]>(`/api/v1/annotations/book/${bookId}`);
  }

  createAnnotation(body: GrimmoryAnnotationCreate): Promise<GrimmoryAnnotation> {
    return this.json<GrimmoryAnnotation>('/api/v1/annotations', { method: 'POST', body });
  }

  updateAnnotation(id: number, body: GrimmoryAnnotationUpdate): Promise<GrimmoryAnnotation> {
    return this.json<GrimmoryAnnotation>(`/api/v1/annotations/${id}`, { method: 'PUT', body });
  }

  deleteAnnotation(id: number): Promise<void> {
    return this.call(`/api/v1/annotations/${id}`, { method: 'DELETE' }, true);
  }

  getBookmarks(bookId: number): Promise<GrimmoryBookmark[]> {
    return this.json<GrimmoryBookmark[]>(`/api/v1/bookmarks/book/${bookId}`);
  }

  createBookmark(body: GrimmoryBookmarkCreate): Promise<GrimmoryBookmark> {
    return this.json<GrimmoryBookmark>('/api/v1/bookmarks', { method: 'POST', body });
  }

  updateBookmark(id: number, body: GrimmoryBookmarkUpdate): Promise<GrimmoryBookmark> {
    return this.json<GrimmoryBookmark>(`/api/v1/bookmarks/${id}`, { method: 'PUT', body });
  }

  deleteBookmark(id: number): Promise<void> {
    return this.call(`/api/v1/bookmarks/${id}`, { method: 'DELETE' }, true);
  }

  updateProgress(body: GrimmoryProgressUpdate): Promise<void> {
    return this.call('/api/v1/books/progress', { method: 'POST', body });
  }

  updateReadStatus(bookId: number, status: GrimmoryReadStatus): Promise<void> {
    return this.call('/api/v1/books/status', {
      method: 'POST',
      body: { bookIds: [bookId], status },
    });
  }

  getReadingSessions(bookId: number, page: number): Promise<GrimmorySessionPage> {
    return this.json<GrimmorySessionPage>(
      `/api/v1/reading-sessions/book/${bookId}?page=${page}&size=100`,
    );
  }

  recordReadingSession(body: GrimmoryReadingSession): Promise<void> {
    return this.call('/api/v1/reading-sessions', { method: 'POST', body });
  }
}
