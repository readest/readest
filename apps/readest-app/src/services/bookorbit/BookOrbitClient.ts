import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { BookOrbitProxyPayload } from '@/types/bookorbit';
import type { BookOrbitSettings } from '@/types/settings';
import { isLanAddress } from '@/utils/network';
import { normalizeCustomHeaders } from '@/utils/customHeaders';
import { getAppVersion } from '@/utils/version';
import { getAPIBaseUrl, isTauriAppPlatform } from '../environment';
import { formatKoDatetime } from './noteMapping';
import type {
  BookOrbitVersionInfo,
  BookStateEntry,
  BookmarkAckBook,
  BookmarkExchangeBookRequest,
  BookmarkExchangeResponse,
  ExchangeAckBook,
  ExchangeBookRequest,
  ExchangeResponse,
  MatchCheckBook,
  MatchCheckResponse,
  PageStatsBookWire,
  PluginDeviceFields,
} from './types';

export class BookOrbitRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BookOrbitRequestError';
    this.status = status;
  }
}

/**
 * Client for the BookOrbit KOReader plugin API at {server}/api/v1/koreader.
 * Auth is KOSync-style (x-auth-user / x-auth-key = md5(password)); credentials
 * are minted in BookOrbit's web UI (Settings > Integrations > KOReader) — this
 * client never self-registers.
 */
export class BookOrbitClient {
  private config: BookOrbitSettings;
  private serverUrl: string;
  private isLanServer: boolean;
  private versionInfo: BookOrbitVersionInfo | null = null;

  constructor(config: BookOrbitSettings) {
    this.config = config;
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.isLanServer = isLanAddress(this.serverUrl);
  }

  private deviceFields(): PluginDeviceFields {
    return {
      deviceId: this.config.deviceId,
      deviceModel: (this.config.deviceName || 'Readest').slice(0, 100),
      pluginVersion: `readest-${getAppVersion()}`.slice(0, 20),
      // Always the UTC frame — see formatKoDatetime; keys derived from
      // server-minted datetimes then agree across Readest devices.
      deviceTime: formatKoDatetime(Date.now()),
    };
  }

  private async request(
    endpoint: string,
    options: { method?: 'GET' | 'POST'; body?: string } = {},
  ): Promise<Response> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = {
      ...normalizeCustomHeaders(this.config.customHeaders),
      Accept: 'application/json',
      'X-Auth-User': this.config.username,
      'X-Auth-Key': this.config.userkey,
    };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.isLanServer || isTauriAppPlatform()) {
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      return await fetch(`${this.serverUrl}/api/v1/koreader${endpoint}`, {
        method,
        headers,
        body,
        danger: {
          acceptInvalidCerts: true,
          acceptInvalidHostnames: true,
        },
      });
    }

    const proxyBody: BookOrbitProxyPayload = {
      serverUrl: this.serverUrl,
      endpoint,
      method,
      headers,
      body: body ? (JSON.parse(body) as Record<string, unknown>) : undefined,
    };
    return await fetch(`${getAPIBaseUrl()}/bookorbit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyBody),
    });
  }

  private async requestJson<T>(
    endpoint: string,
    options: { method?: 'GET' | 'POST'; body?: string } = {},
  ): Promise<T> {
    const response = await this.request(endpoint, options);
    if (!response.ok) {
      let message = `BookOrbit request failed with status ${response.status}`;
      const data: unknown = await response.json().catch(() => null);
      if (data && typeof data === 'object' && 'message' in data) {
        const serverMessage = (data as { message: unknown }).message;
        if (typeof serverMessage === 'string' && serverMessage) message = serverMessage;
      }
      throw new BookOrbitRequestError(response.status, message);
    }
    return (await response.json()) as T;
  }

  private postJson<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
    return this.requestJson<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ ...this.deviceFields(), ...payload }),
    });
  }

  async connect(): Promise<{ success: boolean; message?: string; capabilities?: string[] }> {
    try {
      const authResponse = await this.request('/users/auth');
      if (!authResponse.ok) {
        if (authResponse.status === 401) {
          return { success: false, message: 'Invalid credentials.' };
        }
        return {
          success: false,
          message: `Authorization failed with status: ${authResponse.status}`,
        };
      }
      // A wrong Server URL can land on a web UI that answers 200 with HTML.
      const data: unknown = await authResponse.json().catch(() => null);
      if (typeof data !== 'object' || data === null) {
        return { success: false, message: 'Not a BookOrbit server. Check the Server URL.' };
      }
      try {
        const version = await this.getVersion();
        return { success: true, capabilities: version.capabilities };
      } catch {
        return {
          success: true,
          capabilities: [],
          message: 'Connected, but the server does not expose the BookOrbit plugin API.',
        };
      }
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Connection error.' };
    }
  }

  async getVersion(): Promise<BookOrbitVersionInfo> {
    if (!this.versionInfo) {
      this.versionInfo = await this.requestJson<BookOrbitVersionInfo>('/plugin/version');
    }
    return this.versionInfo;
  }

  async matchCheck(books: MatchCheckBook[]): Promise<MatchCheckResponse> {
    return await this.postJson<MatchCheckResponse>('/plugin/match-check', {
      hashes: books.map((book) => book.hash),
      books,
    });
  }

  async exchangeAnnotations(books: ExchangeBookRequest[]): Promise<ExchangeResponse> {
    return await this.postJson<ExchangeResponse>('/plugin/annotations/exchange', { books });
  }

  async ackAnnotations(books: ExchangeAckBook[]): Promise<void> {
    await this.postJson<unknown>('/plugin/annotations/exchange-ack', { books });
  }

  async exchangeBookmarks(books: BookmarkExchangeBookRequest[]): Promise<BookmarkExchangeResponse> {
    return await this.postJson<BookmarkExchangeResponse>('/plugin/bookmarks/exchange', { books });
  }

  async ackBookmarks(books: BookmarkAckBook[]): Promise<void> {
    await this.postJson<unknown>('/plugin/bookmarks/exchange-ack', { books });
  }

  async uploadPageStats(books: PageStatsBookWire[]): Promise<void> {
    await this.postJson<unknown>('/plugin/page-stats', { books });
  }

  async uploadBookStates(books: BookStateEntry[]): Promise<void> {
    await this.postJson<unknown>('/plugin/book-states', { books });
  }
}
