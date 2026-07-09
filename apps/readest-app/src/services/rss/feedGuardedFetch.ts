import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isBlockedHost } from '@/utils/network';
import { getProxiedURL, needsProxy } from '@/app/opds/utils/opdsReq';
import { isTauriAppPlatform } from '@/services/environment';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export function assertFetchAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new Error(`Blocked scheme: ${u.protocol}`);
  if (isBlockedHost(u.hostname)) throw new Error(`Blocked host: ${u.hostname}`);
}

export async function guardedFetchText(url: string): Promise<string> {
  assertFetchAllowed(url);
  const doFetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const target = !isTauriAppPlatform() && needsProxy(url) ? getProxiedURL(url) : url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(target, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Response too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
