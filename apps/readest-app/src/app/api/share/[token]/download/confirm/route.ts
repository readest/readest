import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { hashShareToken, isValidShareToken } from '@/libs/share-server';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// POST /api/share/[token]/download/confirm — analytics ping fired by the
// landing-page Download button (post-click) and the in-app deeplink hook on
// successful import. Best-effort: the user-facing action does not depend on
// this returning 2xx. Lookup is by token_hash so the row stays cheap to find.
//
// Increments are done in a single SQL UPDATE so concurrent requests cannot
// race a read-modify-write. We also accept the small risk that an increment
// lands shortly after a revoke — that's harmless, the counter doesn't grant
// access. The validity check below skips obviously dead shares so crawlers
// hitting expired links don't pollute the count after the fact.
export async function POST(_request: Request, { params }: RouteParams) {
  const { token } = await params;

  if (!isValidShareToken(token)) {
    // Silently OK — this is a best-effort beacon, not an enforcement point.
    return new NextResponse(null, { status: 204 });
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = await hashShareToken(token);

  // Atomic conditional update via the SQL function defined alongside the
  // table. Only bumps rows that are still active so late-firing pings on
  // expired/revoked shares don't pollute the count.
  const nowIso = new Date().toISOString();
  const { error } = await supabase.rpc('increment_book_share_download', {
    p_token_hash: tokenHash,
    p_now: nowIso,
  });
  if (error) {
    // Best-effort beacon — log but never surface to the caller.
    console.error('download confirm rpc failed:', error);
  }

  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
