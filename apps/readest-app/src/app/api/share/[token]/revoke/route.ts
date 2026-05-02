import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { hashShareToken, isValidShareToken } from '@/libs/share-server';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// POST /api/share/[token]/revoke — owner-only. Sets revoked_at = now() so
// future landing-page visits and downloads return 410. Note: presigned URLs
// already minted (max ~5 min TTL) cannot be canceled — this is a documented
// soft-revocation grace, not a hard guarantee.
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;

  if (!isValidShareToken(token)) {
    return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });
  }

  const { user, token: jwt } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !jwt) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = await hashShareToken(token);

  // RLS would suffice, but we use the admin client elsewhere; gate explicitly
  // on user_id to keep the contract obvious to readers.
  const { data: share, error: lookupError } = await supabase
    .from('book_shares')
    .select('id, user_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (lookupError) {
    console.error('book_shares lookup failed:', lookupError);
    return NextResponse.json({ error: 'Could not look up share' }, { status: 500 });
  }
  if (!share) {
    return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  }
  if (share.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Idempotent: re-revoking returns success without churning the timestamp.
  if (share.revoked_at) {
    return new NextResponse(null, { status: 204 });
  }

  const { error: updateError } = await supabase
    .from('book_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', share.id);
  if (updateError) {
    console.error('book_shares revoke failed:', updateError);
    return NextResponse.json({ error: 'Could not revoke share' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
