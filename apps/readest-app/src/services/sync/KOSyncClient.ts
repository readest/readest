import { md5 } from 'js-md5';
import { Book } from '@/types/book';
import { KOSyncSettings } from '@/types/settings';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { KoSyncProxyPayload } from '@/types/kosync';
import { isLanAddress } from '@/utils/network';
import { getAPIBaseUrl, isTauriAppPlatform } from '../environment';

/**
 * Interface for KOSync progress response from the server
 */
export interface KoSyncProgress {
  document?: string;
  progress?: string;
  percentage?: number;
  timestamp?: number;
  device?: string;
  device_id?: string;
}

export class KOSyncClient {
  private config: KOSyncSettings;
  private isLanServer: boolean;
  private usesHttpAuth: boolean = false;

  constructor(config: KOSyncSettings) {
    this.config = config;
    this.config.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.isLanServer = isLanAddress(this.config.serverUrl);
  }

  private async request(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT';
      body?: BodyInit | null;
      headers?: HeadersInit;
      useAuth?: boolean;
    } = {},
  ): Promise<Response> {
    const { method = 'GET', body, headers: additionalHeaders, useAuth = true } = options;

    const buildHeaders = (): Headers => {
      const headers = new Headers(additionalHeaders || {});
      if (useAuth) {
        if (this.usesHttpAuth && this.config.password) {
          const credentials = btoa(`${this.config.username}:${this.config.password}`);
          headers.set('Authorization', `Basic ${credentials}`);
        } else {
          headers.set('X-Auth-User', this.config.username);
          headers.set('X-Auth-Key', this.config.userkey);
        }
      }
      return headers;
    };

    const attempt = async (): Promise<Response> => {
      const headers = buildHeaders();

      if (this.isLanServer || isTauriAppPlatform()) {
        const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
        const directUrl = `${this.config.serverUrl}${endpoint}`;

        return await fetch(directUrl, {
          method,
          headers: {
            accept: 'application/vnd.koreader.v1+json',
            ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
            ...Object.fromEntries(headers.entries()),
          },
          body,
          danger: {
            acceptInvalidCerts: true,
            acceptInvalidHostnames: true,
          },
        });
      }

      const proxyUrl = `${getAPIBaseUrl()}/kosync`;
      const proxyBody: KoSyncProxyPayload = {
        serverUrl: this.config.serverUrl,
        endpoint,
        method,
        headers: Object.fromEntries(headers.entries()),
        body: body ? JSON.parse(body as string) : undefined,
      };

      return await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(proxyBody),
      });
    };

    let response = await attempt();
    // some versions of CWA return status code 400 for auth failure, so check for both.
    if (response.status === 401 || response.status === 400) {
      // traditional auth failed; attempt one more time with HTTP auth
      this.usesHttpAuth = true;

      response = await attempt();
      if (!response.ok) {
        // this one failed too, revert to traditional auth
        this.usesHttpAuth = false;
      }
    }

    return response;
  }

  /**
   * Connects to the KOSync server with authentication
   * @param username - The username for authentication
   * @param password - The password for authentication
   * @returns Promise with success status and optional message
   */
  async connect(
    username: string,
    password: string,
  ): Promise<{ success: boolean; message?: string }> {
    const userkey = md5(password);

    try {
      const authResponse = await this.request('/users/auth', {
        method: 'GET',
        useAuth: true,
      });

      if (authResponse.ok) {
        // A wrong Server URL can land on the host's web UI, which answers 200
        // with an HTML page. Only treat the response as a successful login when
        // it's an actual KOReader Sync JSON response, otherwise the user is
        // silently "connected" to an endpoint that can never sync.
        if (!(await this.isKoSyncJsonResponse(authResponse))) {
          return { success: false, message: 'Not a KOReader Sync server. Check the Server URL.' };
        }
        return { success: true, message: 'Login successful.' };
      }

      if (authResponse.status === 401) {
        const registerResponse = await this.request('/users/create', {
          method: 'POST',
          useAuth: false,
          body: JSON.stringify({ username, password: userkey }),
        });

        if (registerResponse.ok) {
          if (!(await this.isKoSyncJsonResponse(registerResponse))) {
            return { success: false, message: 'Not a KOReader Sync server. Check the Server URL.' };
          }
          return { success: true, message: 'Registration successful.' };
        }

        const regError = await registerResponse.json().catch(() => ({}));
        if (registerResponse.status === 402) {
          return { success: false, message: 'Invalid credentials.' };
        }
        return { success: false, message: regError.message || 'Registration failed.' };
      }

      const errorBody = await authResponse.json().catch(() => ({}));
      return {
        success: false,
        message: errorBody.message || `Authorization failed with status: ${authResponse.status}`,
      };
    } catch (e) {
      console.error('KOSync connection failed', e);
      return { success: false, message: (e as Error).message || 'Connection error.' };
    }
  }

  /**
   * Retrieves the reading progress for a specific book from the server
   * @param book - The book to get progress for
   * @returns Promise with the progress data or null if not found
   */
  async getProgress(book: Book): Promise<KoSyncProgress | null> {
    if (!this.config.userkey) return null;

    const documentHash = this.getDocumentDigest(book);
    if (!documentHash) return null;

    try {
      const response = await this.request(`/syncs/progress/${documentHash}`);

      if (!response.ok) {
        console.error(
          `KOSync: Failed to get progress for ${book.title}. Status: ${response.status}`,
        );
        return null;
      }

      const data: KoSyncProgress = await response.json();
      if (!data || typeof data !== 'object') return null;
      // Key validity on an actual position, not on `document`: KOSync-compatible
      // servers don't all echo the document hash back on GET (koreader-sync only
      // returns progress/percentage/device/device_id/timestamp), and dropping
      // those replies left the reader on its stale local position — which it
      // then pushed back over the newer remote one.
      const hasPosition =
        (typeof data.progress === 'string' && data.progress.length > 0) ||
        (typeof data.percentage === 'number' && Number.isFinite(data.percentage));
      if (!hasPosition) return null;
      return { ...data, document: data.document || documentHash };
    } catch (e) {
      console.error('KOSync getProgress failed', e);
      return null;
    }
  }

  /**
   * Updates the reading progress for a specific book on the server
   * @param book - The book to update progress for
   * @param progress - The current reading progress position
   * @param percentage - The reading completion percentage
   * @returns Promise with boolean indicating success
   */
  async updateProgress(book: Book, progress: string, percentage: number): Promise<boolean> {
    if (!this.config.userkey) return false;

    const documentHash = this.getDocumentDigest(book);
    if (!documentHash) return false;

    const payload = {
      document: documentHash,
      progress,
      percentage,
      device: this.config.deviceName,
      device_id: this.config.deviceId,
    };

    try {
      const response = await this.request('/syncs/progress', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `KOSync: Failed to update progress for ${book.title}. Status: ${response.status}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error('KOSync updateProgress failed', e);
      return false;
    }
  }

  /**
   * A genuine KOReader Sync server replies with a JSON object (e.g.
   * `{ "authorized": "OK" }`). A misconfigured Server URL that hits a static
   * web UI returns an HTML page instead, which fails JSON parsing — use that to
   * tell the two apart.
   */
  private async isKoSyncJsonResponse(response: Response): Promise<boolean> {
    const data = await response.json().catch(() => null);
    return typeof data === 'object' && data !== null;
  }

  getDocumentDigest(book: Book): string {
    if (this.config.checksumMethod === 'filename') {
      console.warn('This is not possible anymore, using md5 instead.');
    }
    return book.hash;
  }
}
