import { NextResponse } from 'next/server';
import { getDownloadSignedUrl } from '@/utils/object';
import { rejectionToHttp, resolveActiveShare } from '@/libs/share-server';
import { SHARE_PRESIGN_TTL_SECONDS } from '@/services/constants';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// GET /api/share/[token]/cover — public 302 redirect to a presigned cover URL.
// Cached briefly so chat-app preview crawlers don't re-fetch the same image
// for every recipient. Covers aren't sensitive; max-age is intentional.
export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;

  const result = await resolveActiveShare(token);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;

  if (!share.coverFileKey) {
    return NextResponse.json({ error: 'No cover for this share' }, { status: 404 });
  }

  let url: string;
  try {
    url = await getDownloadSignedUrl(share.coverFileKey, SHARE_PRESIGN_TTL_SECONDS);
  } catch (err) {
    console.error('Share cover presign failed:', err);
    return NextResponse.json({ error: 'Could not sign cover URL' }, { status: 500 });
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
