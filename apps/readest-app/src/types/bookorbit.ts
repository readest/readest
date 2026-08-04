export interface BookOrbitProxyPayload {
  /** Base server origin, e.g. https://books.example.com (no API path). */
  serverUrl: string;
  /** Path relative to /api/v1/koreader, e.g. /plugin/version. */
  endpoint: string;
  method: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}
