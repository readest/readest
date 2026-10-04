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

// A reader's KOSync document id is the partial MD5 of its file. CrossPoint's
// "Optimize EPUB" upload rewrites a book, so that copy's id matches no Readest
// book. Its first progress upload links it to the library book by title and
// author (sent with KOSync "Send metadata"); later syncs and reading
// sessions follow the link. Both helpers report a database error, like a
// query, so a route never syncs a linked copy under its own id instead.

interface Link {
  bookHash: string | null;
  error: unknown;
}

const NO_LINK: Link = { bookHash: null, error: null };

/** The library book a rewritten copy was linked to (null if none). */
export const linkedBook = async (
  supabase: SupabaseClient,
  userId: string,
  document: string,
): Promise<Link> => {
  const { data, error } = await supabase
    .from('crosspoint_documents')
    .select('book_hash')
    .eq('user_id', userId)
    .eq('document', document)
    .maybeSingle();
  return { bookHash: (data?.book_hash as string | undefined) ?? null, error };
};

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() : '';

/**
 * Links a copy to the library EPUB with its title. When titles collide, the
 * book must also share the copy's first author, and of several such books
 * (the same book imported twice, another edition) the most recently read one
 * wins. No book when the copy is Readest's own file or none fits.
 */
export const linkCopy = async (
  supabase: SupabaseClient,
  userId: string,
  document: string,
  metadata: unknown,
): Promise<Link> => {
  const { title, authors } = (metadata ?? {}) as Record<string, unknown>;
  const wanted = normalizeText(title);
  if (!wanted) return NO_LINK;
  // Commas and parentheses are or() syntax, and %, *, \ and " are pattern or
  // quoting characters: each becomes a one-character wildcard. The exact
  // comparison happens below.
  const pattern = String(title)
    .trim()
    .replace(/[,()%*\\"]/g, '_');
  const { data, error } = await supabase
    .from('books')
    .select('book_hash, title, source_title, author, updated_at')
    .eq('user_id', userId)
    .or(`book_hash.eq.${document},source_title.ilike.${pattern},title.ilike.${pattern}`)
    .eq('format', 'EPUB')
    .is('deleted_at', null);
  if (error) return { bookHash: null, error };
  if (!data || data.some((book) => book.book_hash === document)) return NO_LINK;
  let matches = data.filter(
    (book) => normalizeText(book.source_title) === wanted || normalizeText(book.title) === wanted,
  );
  // The reader joins every dc:creator with ", "; Readest lists a book's
  // authors with ", ", " and ", " & " or "、" between them.
  const author = normalizeText(authors).split(', ')[0];
  const firstAuthor = (book: (typeof matches)[number]) =>
    normalizeText(book.author).split(/, | and | & |、/)[0];
  if (matches.length > 1) {
    matches = author ? matches.filter((book) => firstAuthor(book) === author) : [];
  }
  const recent = (book: (typeof matches)[number]) => Date.parse(String(book.updated_at)) || 0;
  const [book] = matches.sort((a, b) => recent(b) - recent(a));
  if (!book) return NO_LINK;
  const bookHash = book.book_hash as string;
  const { error: linkError } = await supabase
    .from('crosspoint_documents')
    .upsert(
      { user_id: userId, document, book_hash: bookHash },
      { onConflict: 'user_id,document', ignoreDuplicates: true },
    );
  return linkError ? { bookHash: null, error: linkError } : { bookHash, error: null };
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
