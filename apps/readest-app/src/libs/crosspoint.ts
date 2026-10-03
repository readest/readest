import { md5 } from 'js-md5';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Server side of the CrossPoint SD plugin (routes under /api/crosspoint). A
// reader links to an account with a device code, then authenticates every
// request with its own key: as a Bearer token from the plugin's catalog and
// events, and as the KOReader Sync password from the reader's built-in KOSync
// client. The key alone identifies the device, so the KOSync username (the
// account email) is only a label and survives an email change.

export const BOOK_HASH = /^[0-9a-f]{32}$/;

// Page count for books no Readest app has paginated yet: whole percents.
export const PERCENT_PAGES = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export const newSecret = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

export const sha256Hex = async (text: string) =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** What crosspoint_devices stores for a key: sha256 of its md5 hex, the form KOSync clients send. */
export const hashDeviceKey = (key: string) => sha256Hex(md5(key));

// The md5 hex of the device key. KOSync clients send it as x-auth-key, and
// CrossPoint also sends the key as the HTTP Basic password; the catalog and
// events send the key itself as a Bearer token.
const readKeyMd5 = (headers: Headers) => {
  const keyMd5 = headers.get('x-auth-key');
  if (keyMd5) return keyMd5.toLowerCase();
  const [, scheme, value] = headers.get('authorization')?.match(/^(\w+) (.+)$/) ?? [];
  if (!scheme || !value) return null;
  if (/^bearer$/i.test(scheme)) return md5(value);
  if (!/^basic$/i.test(scheme)) return null;
  try {
    const decoded = atob(value);
    const sep = decoded.indexOf(':');
    return sep >= 0 ? md5(decoded.slice(sep + 1)) : null;
  } catch {
    return null;
  }
};

/** The user id a CrossPoint request authenticates as, or the error response to send. */
export const authenticateDevice = async (
  request: Request,
  supabase: SupabaseClient,
): Promise<string | NextResponse> => {
  const keyMd5 = readKeyMd5(request.headers);
  if (keyMd5) {
    const { data, error } = await supabase
      .from('crosspoint_devices')
      .select('user_id')
      .eq('key_hash', await sha256Hex(keyMd5))
      .limit(1);
    // An outage is not a wrong key: the reader must not ask the user to sign in again.
    if (error) return NextResponse.json({ message: 'Could not check the key' }, { status: 500 });
    const userId = data?.[0]?.user_id as string | undefined;
    if (userId) return userId;
  }
  return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
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
