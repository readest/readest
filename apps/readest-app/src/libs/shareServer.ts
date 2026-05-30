import { customAlphabet } from 'nanoid';
import { createSupabaseAdminClient } from '@/utils/supabase';

// 22-char URL-safe alphabet (alphanumeric only — no `-` or `_`). Avoids
// punctuation that some chat clients linkify oddly.
const SHARE_TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_TOKEN_LENGTH = 22;
const generator = customAlphabet(SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH);

const SHARE_TOKEN_REGEX = new RegExp(`^[${SHARE_TOKEN_ALPHABET}]{${SHARE_TOKEN_LENGTH}}$`);

export const isValidShareToken = (token: unknown): token is string =>
  typeof token === 'string' && SHARE_TOKEN_REGEX.test(token);

// Generate a fresh share token. The raw value is shown to the user once at
// create-time; only the hash is persisted to the database. A leaked DB read
// therefore cannot recover live bearer credentials.
export const generateShareToken = async (): Promise<{ raw: string; hash: string }> => {
  const raw = generator();
  const hash = await hashShareToken(raw);
  return { raw, hash };
};

// SHA-256 of the raw token. Used at create (insert) and lookup (constant-time
// comparison via the unique index). Implemented with WebCrypto so it runs in
// both Node and edge runtimes.
export const hashShareToken = async (raw: string): Promise<string> => {
  const data = new TextEncoder().encode(raw);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Reasons a share lookup may reject.
export type ShareLookupRejection =
  | { kind: 'invalid_token' }
  | { kind: 'not_found' }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'source_deleted' }
  | { kind: 'lookup_failed'; detail?: string };

export interface ResolvedShare {
  id: string;
  userId: string;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string | null;
  bookFormat: string;
  bookSize: number;
  cfi: string | null;
  expiresAt: string;
  revokedAt: string | null;
  downloadCount: number;
  createdAt: string;
  bookFileKey: string;
  coverFileKey: string | null;
}

const isCoverKey = (fileKey: string): boolean => /\.(png|jpe?g|webp|gif)$/i.test(fileKey);

// Single source of truth for the "is this share alive and usable?" check.
// Used by the public metadata, download, cover, og.png, and import routes
// so the validation logic stays in one place.
export const resolveActiveShare = async (
  rawToken: string,
): Promise<{ ok: true; share: ResolvedShare } | { ok: false; reason: ShareLookupRejection }> => {
  if (!isValidShareToken(rawToken)) {
    return { ok: false, reason: { kind: 'invalid_token' } };
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = await hashShareToken(rawToken);

  const { data: row, error } = await supabase
    .from('book_shares')
    .select(
      'id, user_id, book_hash, book_title, book_author, book_format, book_size, cfi, expires_at, revoked_at, download_count, created_at',
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: { kind: 'lookup_failed', detail: error.message } };
  }
  if (!row) {
    return { ok: false, reason: { kind: 'not_found' } };
  }
  if (row.revoked_at) {
    return { ok: false, reason: { kind: 'revoked' } };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: { kind: 'expired' } };
  }

  const { data: files, error: filesError } = await supabase
    .from('files')
    .select('file_key')
    .eq('user_id', row.user_id)
    .eq('book_hash', row.book_hash)
    .is('deleted_at', null);
  if (filesError) {
    return { ok: false, reason: { kind: 'lookup_failed', detail: filesError.message } };
  }

  const bookFile = files?.find((f) => !isCoverKey(f.file_key));
  if (!bookFile) {
    return { ok: false, reason: { kind: 'source_deleted' } };
  }
  const coverFile = files?.find((f) => isCoverKey(f.file_key));

  return {
    ok: true,
    share: {
      id: row.id,
      userId: row.user_id,
      bookHash: row.book_hash,
      bookTitle: row.book_title,
      bookAuthor: row.book_author,
      bookFormat: row.book_format,
      bookSize: row.book_size,
      cfi: row.cfi,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      downloadCount: row.download_count,
      createdAt: row.created_at,
      bookFileKey: bookFile.file_key,
      coverFileKey: coverFile?.file_key ?? null,
    },
  };
};

// Maps the rejection kinds to the standard HTTP status + code combinations
// used by every share endpoint. Centralized so the JSON error shape is
// consistent across routes.
export const rejectionToHttp = (
  reason: ShareLookupRejection,
): { status: number; body: { error: string; code?: string } } => {
  switch (reason.kind) {
    case 'invalid_token':
      return { status: 400, body: { error: 'Invalid share token', code: 'invalid_token' } };
    case 'not_found':
      return { status: 404, body: { error: 'Share not found', code: 'not_found' } };
    case 'revoked':
      return { status: 410, body: { error: 'Share has been revoked', code: 'revoked' } };
    case 'expired':
      return { status: 410, body: { error: 'Share has expired', code: 'expired' } };
    case 'source_deleted':
      return {
        status: 410,
        body: { error: 'Shared book is no longer available', code: 'source_deleted' },
      };
    case 'lookup_failed':
      console.error('Share lookup failed:', reason.detail);
      return { status: 500, body: { error: 'Could not look up share' } };
  }
};
