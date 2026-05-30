/**
 * Auth-token storage helpers. The token is captured by the `auth-bridge`
 * content script while the user is signed in at web.readest.com and read by
 * the service worker / popup. We never store the user's password — only the
 * short-lived Supabase access token Readest hands out.
 */

const TOKEN_KEY = 'readestAccessToken';
const TOKEN_AT_KEY = 'readestTokenAt';

export interface StoredToken {
  token: string;
  capturedAt: number;
}

export async function readToken(): Promise<StoredToken | null> {
  const result = (await chrome.storage.local.get([TOKEN_KEY, TOKEN_AT_KEY])) as Record<
    string,
    unknown
  >;
  const token = result[TOKEN_KEY];
  const at = result[TOKEN_AT_KEY];
  if (typeof token !== 'string' || !token) return null;
  return { token, capturedAt: typeof at === 'number' ? at : 0 };
}

export async function writeToken(token: string): Promise<void> {
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [TOKEN_AT_KEY]: Date.now(),
  });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_AT_KEY]);
}
