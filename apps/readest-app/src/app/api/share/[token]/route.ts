import { NextResponse } from 'next/server';
import { rejectionToHttp, resolveActiveShare } from '@/libs/share-server';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// GET /api/share/[token] — public metadata used by the /s landing page.
// Returns 410 if the share is revoked, expired, or its source file no longer
// exists. Never returns presigned URLs in this body — covers and downloads
// are fetched from dedicated endpoints with their own caching semantics.
export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;

  const result = await resolveActiveShare(token);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;

  return NextResponse.json(
    {
      title: share.bookTitle,
      author: share.bookAuthor,
      format: share.bookFormat,
      size: share.bookSize,
      expiresAt: share.expiresAt,
      hasCover: !!share.coverFileKey,
      hasCfi: !!share.cfi,
      downloadCount: share.downloadCount,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
