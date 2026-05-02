'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { IoAlertCircleOutline, IoBookOutline, IoOpenOutline } from 'react-icons/io5';
import { DOWNLOAD_READEST_URL, READEST_WEB_BASE_URL } from '@/services/constants';
import { useTranslation } from '@/hooks/useTranslation';
import { buildAnnotationAppUrl } from '@/utils/deeplink';
import { BrandHeader } from '@/components/landing/BrandHeader';
import { Card } from '@/components/landing/Card';
import { PageFooter } from '@/components/landing/PageFooter';

type Platform = 'android-chromium' | 'android-other' | 'ios' | 'desktop' | 'unknown';

const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  if (isAndroid) {
    const isChromium = /Chrome|CriOS|EdgA|Brave/i.test(ua) && !/Firefox|FxiOS/i.test(ua);
    return isChromium ? 'android-chromium' : 'android-other';
  }
  if (isIOS) return 'ios';
  return 'desktop';
};

const ANDROID_PACKAGE = 'com.bilingify.readest';
const FALLBACK_TIMEOUT_MS = 1500;
const DESKTOP_FALLBACK_DELAY_MS = 1000;

const buildIntentUrl = (path: string, fallbackUrl: string) => {
  const cleanPath = path.replace(/^\//, '');
  return `intent://${cleanPath}#Intent;scheme=readest;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
};

const buildWebReaderUrl = (bookHash: string, cfi: string | null): string => {
  const query = cfi ? `?${new URLSearchParams({ cfi }).toString()}` : '';
  return `/reader/${bookHash}${query}`;
};

const OpenAnnotationLanding = () => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [showManualOpen, setShowManualOpen] = useState(false);

  // Resolve hash/note from either the rewritten query (?book=&note=) or the
  // pretty path (/o/book/{hash}/annotation/{id}). The rewrite handles web; the
  // pathname parsing handles direct visits or environments where rewrites
  // didn't apply.
  let bookHash = searchParams?.get('book') ?? null;
  let noteId = searchParams?.get('note') ?? null;
  if ((!bookHash || !noteId) && pathname) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'o' && segments[1] === 'book' && segments[3] === 'annotation') {
      bookHash = segments[2] ?? null;
      noteId = segments[4] ?? null;
    }
  }
  const cfi = searchParams?.get('cfi') ?? null;

  useEffect(() => {
    if (!bookHash || !noteId) return;
    const platform = detectPlatform();
    const appUrl = buildAnnotationAppUrl({ bookHash, noteId, cfi: cfi ?? undefined });
    const webReaderUrl = buildWebReaderUrl(bookHash, cfi);
    const path = `book/${bookHash}/annotation/${noteId}${cfi ? `?cfi=${encodeURIComponent(cfi)}` : ''}`;

    if (platform === 'android-chromium') {
      const absoluteFallback = `${READEST_WEB_BASE_URL}${webReaderUrl}`;
      window.location.replace(buildIntentUrl(path, absoluteFallback));
      return;
    }

    if (platform === 'android-other') {
      let cancelled = false;
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') cancelled = true;
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.location.replace(appUrl);
      const timer = window.setTimeout(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        if (!cancelled) router.replace(webReaderUrl);
      }, FALLBACK_TIMEOUT_MS);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.clearTimeout(timer);
      };
    }

    if (platform === 'ios') {
      // Apple blocks JS-driven scheme launches without a user gesture; show
      // the manual UI instead. Universal Links should have intercepted before
      // this page loaded if the app is installed.
      setShowManualOpen(true);
      return;
    }

    // Desktop: auto-launch the app and only surface the fallback UI if the
    // page is still in front after a short delay. Browsers prompt once for
    // permission and remember the choice; subsequent clicks are silent.
    window.location.href = appUrl;
    const desktopTimer = window.setTimeout(() => {
      setShowManualOpen(true);
    }, DESKTOP_FALLBACK_DELAY_MS);
    return () => {
      window.clearTimeout(desktopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash, noteId, cfi]);

  // Invalid link — missing book or note identifier.
  if (!bookHash || !noteId) {
    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <div className='flex flex-col items-center text-center'>
            <div className='bg-base-200 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
              <IoAlertCircleOutline className='text-base-content/60 h-8 w-8' />
            </div>
            <h1 className='text-base-content text-2xl font-semibold'>
              {_("This link can't be opened")}
            </h1>
            <p className='text-base-content/70 mt-2 text-sm'>
              {_(
                'The annotation link is missing required information. The original link may have been truncated.',
              )}
            </p>
            <a href='https://readest.com' className='btn btn-ghost btn-block mt-6' rel='noopener'>
              {_('Go to Readest')}
            </a>
          </div>
        </Card>
        <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
      </main>
    );
  }

  const appUrl = buildAnnotationAppUrl({ bookHash, noteId, cfi: cfi ?? undefined });
  const webReaderHref = buildWebReaderUrl(bookHash, cfi);

  return (
    <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
      <Card>
        <BrandHeader
          title={_('Open in Readest')}
          subtitle={
            showManualOpen
              ? _("If Readest didn't open automatically, choose an option below:")
              : _('Continue reading where you left off.')
          }
          alt={_('Readest logo')}
        />

        {/* Loading state — visible until the desktop timeout fires (or always
            on Android-other while the auto-launch races the timeout). */}
        {!showManualOpen && (
          <div
            className='mt-6 flex flex-col items-center gap-3 py-4'
            role='status'
            aria-live='polite'
          >
            <span className='loading loading-dots loading-md text-primary' aria-hidden='true' />
            <span className='text-base-content/70 text-sm'>{_('Opening Readest...')}</span>
          </div>
        )}

        {/* Fallback action UI — fades in once the page realizes the launch
            didn't take. */}
        <div
          className={`mt-6 flex flex-col gap-2 transition-opacity motion-safe:duration-200 ${
            showManualOpen ? 'opacity-100' : 'pointer-events-none h-0 overflow-hidden opacity-0'
          }`}
        >
          <a href={appUrl} className='btn btn-primary btn-block' rel='noopener'>
            <IoBookOutline className='h-5 w-5' aria-hidden='true' />
            {_('Open in Readest app')}
          </a>
          <a href={webReaderHref} className='btn btn-ghost btn-block' rel='noopener'>
            <IoOpenOutline className='h-5 w-5' aria-hidden='true' />
            {_('Continue in browser')}
          </a>
          <p className='text-base-content/60 mt-3 text-center text-xs'>
            {_("Don't have Readest?")}{' '}
            <a
              href={DOWNLOAD_READEST_URL}
              target='_blank'
              rel='noopener'
              className='text-primary font-medium hover:underline'
            >
              {_('Download')}
            </a>
          </p>
        </div>
      </Card>
      <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
    </main>
  );
};

const Page = () => {
  return (
    <Suspense fallback={null}>
      <OpenAnnotationLanding />
    </Suspense>
  );
};

export default Page;
