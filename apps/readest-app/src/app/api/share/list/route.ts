import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { SHARE_BASE_URL } from '@/services/constants';

const PAGE_SIZE = 25;

// GET /api/share/list?cursor=<created_at_iso>:<id>
// Owner-only. Cursor-paginated list of the caller's shares (active + expired).
// Cursor format mirrors the (created_at DESC, id DESC) order so duplicates and
// drops are impossible across pages even when rows are added concurrently.
export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get('cursor');
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (rawCursor) {
    const sep = rawCursor.indexOf('|');
    if (sep > 0) {
      cursorCreatedAt = rawCursor.slice(0, sep);
      cursorId = rawCursor.slice(sep + 1);
    }
  }

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from('book_shares')
    .select(
      'id, user_id, token, book_hash, book_title, book_author, book_format, book_size, cfi, expires_at, revoked_at, download_count, created_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (cursorCreatedAt && cursorId) {
    // Strict less-than on (created_at, id) lexicographic to avoid skipping ties.
    query = query.or(
      `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('book_shares list failed:', error);
    return NextResponse.json({ error: 'Could not list shares' }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor = hasMore && last ? `${last.created_at}|${last.id}` : null;

  return NextResponse.json({
    shares: page.map((row) => ({
      id: row.id,
      // Plaintext token surfaced to the OWNER only. RLS ensures other users
      // cannot read this row; this endpoint is auth-gated and queried by
      // user_id so a token never leaves the sharer's session.
      token: row.token,
      bookHash: row.book_hash,
      title: row.book_title,
      author: row.book_author,
      format: row.book_format,
      size: row.book_size,
      hasCfi: !!row.cfi,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      downloadCount: row.download_count,
      createdAt: row.created_at,
    })),
    nextCursor,
    shareUrlBase: SHARE_BASE_URL,
  });
}
