import { NextResponse } from 'next/server';
import { getDownloadSignedUrl } from '@/utils/object';
import { rejectionToHttp, resolveActiveShare } from '@/libs/share-server';
import { SHARE_PRESIGN_TTL_SECONDS } from '@/services/constants';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// GET /api/share/[token]/download — public, 302 to a short-lived presigned URL.
// IMPORTANT: this endpoint MUST NOT write to the database. iMessage / WhatsApp /
// Slack / Twitter unfurlers and browser prefetchers will hit this URL just by
// previewing a link. Counting them would inflate `download_count` to garbage.
// Real downloads ping POST /download/confirm separately so the count tracks
// user intent, not crawler curiosity.
export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;

  const result = await resolveActiveShare(token);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;

  let url: string;
  try {
    url = await getDownloadSignedUrl(share.bookFileKey, SHARE_PRESIGN_TTL_SECONDS);
  } catch (err) {
    console.error('Share download presign failed:', err);
    return NextResponse.json({ error: 'Could not sign download URL' }, { status: 500 });
  }

  return NextResponse.redirect(url, {
    status: 302,
    // Don't let intermediaries cache the redirect target itself; the presign
    // expires fast but caching the 302 would point future requests at a
    // soon-to-be-dead URL.
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
