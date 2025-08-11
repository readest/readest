/**
 * Defines the contract for the request body that the client will send
 * to our API endpoint that acts as a proxy.
 */
export interface KoSyncProxyPayload {
  serverUrl: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: unknown;
}
