'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  IoAlertCircleOutline,
  IoBookOutline,
  IoLibraryOutline,
  IoOpenOutline,
} from 'react-icons/io5';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { BrandHeader } from '@/components/landing/BrandHeader';
import { Card } from '@/components/landing/Card';
import { PageFooter } from '@/components/landing/PageFooter';
import { getShare, importShare, type ShareMetadata } from '@/libs/share';
import { ensureSharedBookLocal } from '@/libs/shareImport';
import { formatBytes } from '@/utils/book';
import { navigateToReader } from '@/utils/nav';

const formatExpiry = (iso: string, _: TranslationFunc): string => {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (days >= 1) return _('Expires in {{count}} days', { count: days });
  if (hours > 0) return _('Expires in {{count}} hours', { count: hours });
  return _('Expiring soon');
};

const ShareLanding = () => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const { appService } = useEnv();

  // Resolve the token from either the rewritten query (?token=) or the pretty
  // path (/s/{token}). The next.config.mjs rewrite handles the web build; the
  // pathname fallback handles Tauri (output: 'export', no rewrites), dev
  // sessions where the rewrite isn't picked up without a server restart, and
  // any deploy where the rewrite gets misconfigured. Mirrors src/app/o/page.tsx.
  let token = searchParams?.get('token') ?? '';
  if (!token && pathname) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 's' && segments[1]) {
      token = segments[1];
    }
  }

  const [meta, setMeta] = useState<ShareMetadata | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError({ status: 400, message: _('Missing share token') });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await getShare(token);
        if (!cancelled) setMeta(data);
      } catch (err) {
        if (!cancelled) {
          const status =
            err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
              ? err.status
              : 500;
          setLoadError({ status, message: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, _]);

  const appHref = `readest://share/${encodeURIComponent(token)}`;

  const handleAddToLibrary = async () => {
    if (!token || importing || !appService) return;
    setImporting(true);
    setImportProgress(null);
    setImportError(null);
    try {
      const result = await importShare(token);
      // /import only mutates server state (R2 byte-copy + files row). The
      // local library is unchanged, so the reader's getBookByHash would miss.
      // Pull bytes + create the local Book entry before navigating; meta is
      // already in state from the initial getShare call so no extra round-trip.
      await ensureSharedBookLocal({
        token,
        importResult: result,
        appService,
        meta: meta ?? undefined,
        onProgress: setImportProgress,
      });
      // navigateToReader routes web to /reader/{hash} (Pages Router page that
      // actually renders) and Tauri to /reader?ids={hash}. Building the URL
      // by hand here lands on the App Router /reader page instead, which is
      // a stub for this flow and renders blank.
      const queryParams = result.cfi ? `cfi=${encodeURIComponent(result.cfi)}` : undefined;
      navigateToReader(router, [result.bookHash], queryParams);
    } catch (err) {
      setImporting(false);
      setImportProgress(null);
      const message = err instanceof Error ? err.message : _('Could not add to your library');
      setImportError(message);
    }
  };

  if (loadError) {
    // Pick a body copy that reflects the actual failure mode. Network /
    // unknown failures get the generic "try again" message; only confirmed
    // expired/revoked/not-found responses get the "no longer available" copy.
    // This makes misconfigurations debuggable without inspecting devtools.
    const isUnavailable = loadError.status === 410 || loadError.status === 404;
    const isInvalidToken = loadError.status === 400;
    const heading = isUnavailable
      ? _('This share link is no longer available')
      : isInvalidToken
        ? _("This link can't be opened")
        : _('Could not load shared book');
    const body = isUnavailable
      ? _('The original link may have expired or been revoked.')
      : isInvalidToken
        ? _('The share link is missing required information.')
        : _('Please check your connection and try again.');

    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <div className='flex flex-col items-center text-center'>
            <div className='bg-base-200 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
              <IoAlertCircleOutline className='text-base-content/60 h-8 w-8' />
            </div>
            <h1 className='text-base-content text-2xl font-semibold'>{heading}</h1>
            <p className='text-base-content/70 mt-2 text-sm'>{body}</p>
            <a
              href={DOWNLOAD_READEST_URL}
              target='_blank'
              rel='noopener'
              className='btn btn-ghost btn-block mt-6'
            >
              {_('Get Readest')}
            </a>
          </div>
        </Card>
        <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
      </main>
    );
  }

  if (!meta) {
    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <BrandHeader title={_('Loading shared book…')} alt={_('Readest logo')} />
          <div
            className='mt-6 flex flex-col items-center gap-3 py-4'
            role='status'
            aria-live='polite'
          >
            <span className='loading loading-dots loading-md text-primary' aria-hidden='true' />
          </div>
        </Card>
        <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
      </main>
    );
  }

  const coverSrc = meta.hasCover ? `/api/share/${encodeURIComponent(token)}/cover` : null;
  const expiryLabel = formatExpiry(meta.expiresAt, _);

  return (
    <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-6'>
      {/* Inline card instead of <Card>: this surface needs a wider container
          on desktop (sm:max-w-2xl) and a horizontal cover+content layout
          that the shared Card primitive doesn't support. The /o landing
          stays on the narrow Card; only /s gets the wider treatment. */}
      <div className='bg-base-100 border-base-300/60 mx-auto w-full max-w-md overflow-hidden rounded-2xl border shadow-xl sm:max-w-2xl'>
        {/* Branded header — small Readest mark + headline. Stays compact so
            the card still fits on common viewports without scroll, but
            gives the page identity at a glance. */}
        <div className='flex flex-col items-center gap-2 px-5 pb-2 pt-5 sm:px-7 sm:pb-3 sm:pt-7'>
          <Image
            src='/icon.png'
            alt={_('Readest logo')}
            width={40}
            height={40}
            priority
            className='rounded-lg'
          />
          <span className='text-base-content text-base font-semibold'>{_('Shared with you')}</span>
        </div>

        <div className='flex flex-col items-center gap-5 px-5 pb-5 sm:flex-row sm:items-stretch sm:gap-7 sm:px-7 sm:pb-7'>
          {/* Cover: dominant visual anchor. aspect-[2/3] keeps the box the
              right shape whether or not the image loaded — stable layout
              while the cover fetches. */}
          <div className='aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg shadow-lg sm:w-40 sm:self-center'>
            {coverSrc ? (
              // Plain <img>: source is a presigned URL that varies per
              // request, so next/image's loader gives no win.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverSrc} alt='' className='h-full w-full object-cover' loading='eager' />
            ) : (
              <div className='bg-base-200 flex h-full w-full items-center justify-center'>
                <IoBookOutline className='text-base-content/30 h-10 w-10' aria-hidden='true' />
              </div>
            )}
          </div>

          {/* Content column: title, author, meta line, then actions.
              Centered on mobile, left-aligned on desktop where it sits to
              the right of the cover. */}
          <div className='flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:justify-center sm:text-left'>
            <h1 className='text-base-content line-clamp-3 text-xl font-semibold leading-tight sm:text-2xl'>
              {meta.title}
            </h1>
            {meta.author && (
              <p className='text-base-content/70 mt-1 truncate text-sm'>{meta.author}</p>
            )}
            <p className='text-base-content/50 mt-2 text-xs'>
              {meta.format.toUpperCase()} · {formatBytes(meta.size)} · {expiryLabel}
            </p>

            {/* Direct file download is intentionally disabled on the landing
                page for now (rights / abuse risk). Recipients open the share
                inside the app — logged-in via "Add to my library", anonymous
                via the readest:// deep link with a "Get Readest" footnote
                fallback. The /api/share/[token]/download route still exists
                so we can re-enable the button without a server change. */}
            <div className='mt-4 flex w-full flex-col gap-2 sm:mt-5'>
              {user ? (
                <>
                  <button
                    type='button'
                    onClick={handleAddToLibrary}
                    disabled={importing}
                    aria-busy={importing}
                    className='btn btn-primary btn-block flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                  >
                    {importing ? (
                      <span className='loading loading-spinner loading-sm' aria-hidden='true' />
                    ) : (
                      <IoLibraryOutline className='h-5 w-5' aria-hidden='true' />
                    )}
                    {importing
                      ? importProgress !== null
                        ? _('Downloading… {{percent}}%', { percent: importProgress })
                        : _('Adding…')
                      : _('Add to my library')}
                  </button>
                  {/* Live progress bar while bytes are streaming in. Stays at
                      the indeterminate striped state until we get the first
                      progress event from the byte transfer. */}
                  {importing && (
                    <progress
                      className='progress progress-primary w-full'
                      value={importProgress ?? undefined}
                      max={100}
                      aria-label={_('Import progress')}
                    />
                  )}
                  <a
                    href={appHref}
                    aria-disabled={importing}
                    onClick={(e) => {
                      if (importing) e.preventDefault();
                    }}
                    className={
                      importing
                        ? 'btn btn-ghost btn-block btn-disabled flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                        : 'btn btn-ghost btn-block flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                    }
                  >
                    <IoOpenOutline className='h-5 w-5' aria-hidden='true' />
                    {_('Open in app')}
                  </a>
                  {importError && (
                    <p className='text-error mt-1 text-center text-xs sm:text-left' role='alert'>
                      {importError}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <a
                    href={appHref}
                    className='btn btn-primary btn-block flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                  >
                    <IoOpenOutline className='h-5 w-5' aria-hidden='true' />
                    {_('Open in app')}
                  </a>
                  <p className='text-base-content/60 mt-1 text-center text-xs sm:text-left'>
                    {_("Don't have Readest?")}{' '}
                    <a
                      href={DOWNLOAD_READEST_URL}
                      target='_blank'
                      rel='noopener'
                      className='text-primary font-medium hover:underline'
                    >
                      {_('Download Readest')}
                    </a>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
    </main>
  );
};

export default ShareLanding;
