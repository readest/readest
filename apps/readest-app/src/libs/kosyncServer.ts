import { md5 } from 'js-md5';
import type { SupabaseClient } from '@supabase/supabase-js';

// Readest as a KOSync server for the CrossPoint plugin (routes under
// /api/crosspoint). Devices authenticate with per-device keys from the
// kosync_keys table; the KOSync username is the Readest user id.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export const newKosyncKey = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

// What kosync_keys stores: sha256 of the md5 hex KOSync clients send as x-auth-key.
export const hashKosyncKey = async (keyMd5: string) =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMd5.toLowerCase())));

// KOSync clients send x-auth-user and x-auth-key (md5 of the password);
// CrossPoint also sends the same credentials as HTTP Basic.
const readCredentials = (headers: Headers) => {
  const user = headers.get('x-auth-user');
  const keyMd5 = headers.get('x-auth-key');
  if (user && keyMd5) return { user, keyMd5 };
  const basic = headers.get('authorization')?.match(/^Basic (.+)$/i)?.[1];
  if (!basic) return null;
  const decoded = atob(basic);
  const sep = decoded.indexOf(':');
  return sep > 0 ? { user: decoded.slice(0, sep), keyMd5: md5(decoded.slice(sep + 1)) } : null;
};

/** The Readest user id a KOSync request authenticates as, or null. */
export const authenticateKosync = async (
  request: Request,
  supabase: SupabaseClient,
): Promise<string | null> => {
  const credentials = readCredentials(request.headers);
  if (!credentials || !isUuid(credentials.user)) return null;
  const { data } = await supabase
    .from('kosync_keys')
    .select('id')
    .eq('user_id', credentials.user)
    .eq('key_hash', await hashKosyncKey(credentials.keyMd5))
    .limit(1);
  return data?.length ? credentials.user : null;
};

/** A book config's `[current, total]` progress, stored as a JSON string. */
export const parseConfigProgress = (value: unknown): [number, number] | null => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'number' &&
      typeof parsed[1] === 'number' &&
      parsed[1] > 0
      ? [parsed[0], parsed[1]]
      : null;
  } catch {
    return null;
  }
};
