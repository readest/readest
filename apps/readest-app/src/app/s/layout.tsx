import type { Metadata, ResolvingMetadata } from 'next';
import { READEST_WEB_BASE_URL, SHARE_BASE_URL } from '@/services/constants';
import { resolveActiveShare } from '@/libs/share-server';

// Server-rendered metadata for chat unfurls. The /s page itself is a client
// component that mirrors /o/page.tsx, but the OG/Twitter tags must be in the
// initial HTML so iMessage / WhatsApp / Twitter / Slack crawlers can read
// them without executing JS.
//
// In the Tauri build (output: 'export'), this whole route is dropped because
// rewrites and dynamic metadata require a server. Tauri intercepts the
// readest://share/{token} deep link before /s ever loads.
interface LayoutProps {
  children: React.ReactNode;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

interface MetadataProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(
  { searchParams }: MetadataProps,
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const params = (await searchParams) ?? {};
  const tokenParam = params['token'];
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  if (!token) {
    return {
      title: 'Open in Readest',
      description: 'Open-source ebook reader for everyone, on every device.',
    };
  }

  const result = await resolveActiveShare(token);
  if (!result.ok) {
    return {
      title: 'Share link unavailable · Readest',
      description: 'This share link is no longer available.',
    };
  }
  const { share } = result;
  const shareUrl = `${SHARE_BASE_URL}/${token}`;
  const ogImage = `${READEST_WEB_BASE_URL}/api/share/${token}/og.png`;

  return {
    title: `${share.bookTitle} · Shared via Readest`,
    description: share.bookAuthor
      ? `${share.bookAuthor} · Shared via Readest`
      : 'Shared via Readest',
    openGraph: {
      type: 'book',
      url: shareUrl,
      title: share.bookTitle,
      description: share.bookAuthor
        ? `${share.bookAuthor} · Shared via Readest`
        : 'Shared via Readest',
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.bookTitle,
      description: share.bookAuthor
        ? `${share.bookAuthor} · Shared via Readest`
        : 'Shared via Readest',
      images: [ogImage],
    },
  };
}

export default function ShareLandingLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
