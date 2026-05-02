import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { generateShareToken } from '@/libs/share-server';
import { objectExists } from '@/utils/object';
import {
  SHARE_BASE_URL,
  SHARE_CFI_MAX_LENGTH,
  SHARE_EXPIRATION_DAYS,
  SHARE_MAX_PER_USER,
} from '@/services/constants';

interface CreateShareBody {
  bookHash?: unknown;
  expirationDays?: unknown;
  title?: unknown;
  author?: unknown;
  format?: unknown;
  cfi?: unknown;
}

const isAllowedExpiration = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  (SHARE_EXPIRATION_DAYS as readonly number[]).includes(value);

// Bounds the snapshotted text fields the client can pass through. The metadata
// is rendered on a public landing page and embedded in the OG image, so a
// hostile client could try to abuse very long values for layout disruption.
const trimText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

// Reject the C0 control range (U+0000-U+001F) and DEL (U+007F). The cfi
// is round-tripped into URLs and rendered into HTML; a control byte in
// either path would do bad things.
const isControlChar = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);

export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: CreateShareBody;
  try {
    body = (await request.json()) as CreateShareBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bookHash = trimText(body.bookHash, 64);
  if (!bookHash) {
    return NextResponse.json({ error: 'Missing or invalid bookHash' }, { status: 400 });
  }

  if (!isAllowedExpiration(body.expirationDays)) {
    return NextResponse.json(
      {
        error: `expirationDays must be one of ${SHARE_EXPIRATION_DAYS.join(', ')}`,
        code: 'invalid_expiration',
      },
      { status: 400 },
    );
  }
  const expirationDays = body.expirationDays;

  const title = trimText(body.title, 512);
  if (!title) {
    return NextResponse.json({ error: 'Missing or invalid title' }, { status: 400 });
  }
  const author = trimText(body.author, 256);
  const format = trimText(body.format, 16);
  if (!format) {
    return NextResponse.json({ error: 'Missing or invalid format' }, { status: 400 });
  }

  let cfi: string | null = null;
  if (body.cfi != null) {
    cfi = trimText(body.cfi, SHARE_CFI_MAX_LENGTH);
    if (cfi && isControlChar(cfi)) {
      return NextResponse.json({ error: 'cfi contains invalid characters' }, { status: 400 });
    }
  }

  const supabase = createSupabaseAdminClient();

  // Active-share cap — silently enforced. Counts only non-revoked, non-expired rows.
  const { count: activeCount, error: countError } = await supabase
    .from('book_shares')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  if (countError) {
    console.error('book_shares cap query failed:', countError);
    return NextResponse.json({ error: 'Could not check share quota' }, { status: 500 });
  }
  if ((activeCount ?? 0) >= SHARE_MAX_PER_USER) {
    return NextResponse.json(
      {
        error: `You have reached the maximum of ${SHARE_MAX_PER_USER} active shares.`,
        code: 'share_limit_reached',
      },
      { status: 429 },
    );
  }

  // Look up the live `files` row for this user's book. Re-uploads of the same
  // hash follow the share automatically because we resolve at every access.
  const { data: bookFiles, error: filesError } = await supabase
    .from('files')
    .select('file_key, file_size')
    .eq('user_id', user.id)
    .eq('book_hash', bookHash)
    .is('deleted_at', null);
  if (filesError) {
    console.error('book_shares files lookup failed:', filesError);
    return NextResponse.json({ error: 'Could not look up book' }, { status: 500 });
  }
  if (!bookFiles || bookFiles.length === 0) {
    return NextResponse.json(
      { error: 'Book is not uploaded yet', code: 'book_not_uploaded' },
      { status: 409 },
    );
  }

  // Pick the book file (not the cover) by extension. Covers are PNG/JPG;
  // book files are EPUB/PDF/MOBI/etc. The widest filter is "is not an image".
  const bookFile = bookFiles.find((f) => !/\.(png|jpe?g|webp|gif)$/i.test(f.file_key));
  if (!bookFile) {
    return NextResponse.json(
      { error: 'Book file row not found', code: 'book_not_uploaded' },
      { status: 409 },
    );
  }
  const size = bookFile.file_size;

  // The `files` row is inserted before bytes upload (storage/upload.ts:74), so
  // a ghost row can exist if the client aborted. HEAD R2 to confirm bytes are
  // really there before we make the share publicly resolvable.
  const exists = await objectExists(bookFile.file_key);
  if (!exists) {
    return NextResponse.json(
      { error: 'Book upload is incomplete; please retry', code: 'upload_incomplete' },
      { status: 409 },
    );
  }

  const { raw, hash } = await generateShareToken();
  const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

  const { error: insertError } = await supabase.from('book_shares').insert({
    token_hash: hash,
    token: raw,
    user_id: user.id,
    book_hash: bookHash,
    book_title: title,
    book_author: author,
    book_format: format,
    book_size: size,
    cfi,
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) {
    console.error('book_shares insert failed:', insertError);
    return NextResponse.json({ error: 'Could not create share' }, { status: 500 });
  }

  return NextResponse.json({
    token: raw,
    url: `${SHARE_BASE_URL}/${raw}`,
    expiresAt: expiresAt.toISOString(),
  });
}
