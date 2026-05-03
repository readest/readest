import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { getDownloadSignedUrl } from '@/utils/object';
import { rejectionToHttp, resolveActiveShare } from '@/libs/share-server';
import { SHARE_PRESIGN_TTL_SECONDS } from '@/services/constants';

// JSX renderer for the OG image. Lives in a non-route `.tsx` so the route
// file itself can be `.ts` and get filtered out of the Tauri static export
// by `pageExtensions: ['jsx', 'tsx']` (no `ts`) — same trick used by every
// other `share/[token]/*/route.ts` neighbor.

const WIDTH = 1200;
const HEIGHT = 630;

export const renderShareOgImage = async (token: string): Promise<Response> => {
  const result = await resolveActiveShare(token);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;

  let coverDataUrl: string | null = null;
  if (share.coverFileKey) {
    try {
      const signedUrl = await getDownloadSignedUrl(share.coverFileKey, SHARE_PRESIGN_TTL_SECONDS);
      const response = await fetch(signedUrl);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') ?? 'image/jpeg';
        coverDataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
      }
    } catch (err) {
      console.error('Share og.png cover fetch failed:', err);
      // Fall through to text-only card.
    }
  }

  // JSX form is XSS-safe by construction: ImageResponse escapes text content.
  // No raw HTML strings cross the boundary.
  return new ImageResponse(
    coverDataUrl
      ? withCoverCard(coverDataUrl, share.bookTitle, share.bookAuthor)
      : textOnlyCard(share.bookTitle, share.bookAuthor),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    },
  );
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
};

// Cover-on-left composition. Asymmetric (anti-slop). Cover is the visual
// anchor; metadata sits to the right with strong vertical hierarchy.
const withCoverCard = (cover: string, title: string, author: string | null) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#ffffff',
      padding: '64px',
      gap: '64px',
      fontFamily: 'serif',
    }}
  >
    <img
      src={cover}
      width={320}
      height={480}
      style={{
        objectFit: 'cover',
        border: '1px solid #e5e5e5',
        boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
      }}
      alt=''
    />
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: '24px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
        }}
      >
        {clamp(title, 90)}
      </div>
      {author && (
        <div style={{ fontSize: 32, color: '#525252', fontWeight: 400 }}>{clamp(author, 60)}</div>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: 22, color: '#0066cc', fontWeight: 500 }}>Shared via Readest</div>
        <div style={{ fontSize: 18, color: '#a3a3a3' }}>readest.com</div>
      </div>
    </div>
  </div>
);

// Cover-less fallback (eng-review locked option A). Title becomes the visual
// anchor at display size. No placeholder rectangle, no procedural pattern.
const textOnlyCard = (title: string, author: string | null) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      backgroundColor: '#ffffff',
      padding: '96px 80px',
      fontFamily: 'serif',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div
        style={{
          fontSize: 88,
          fontWeight: 700,
          color: '#1a1a1a',
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
        }}
      >
        {clamp(title, 80)}
      </div>
      {author && (
        <div style={{ fontSize: 40, color: '#525252', fontWeight: 400 }}>{clamp(author, 60)}</div>
      )}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: 26, color: '#0066cc', fontWeight: 500 }}>Shared via Readest</div>
      <div style={{ fontSize: 20, color: '#a3a3a3' }}>readest.com</div>
    </div>
  </div>
);

const clamp = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
