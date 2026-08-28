'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  IoAlertCircleOutline,
  IoBookOutline,
  IoLibraryOutline,
  IoOpenOutline,
  IoPeopleOutline,
} from 'react-icons/io5';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { BrandHeader } from '@/components/landing/BrandHeader';
import { Card } from '@/components/landing/Card';
import { PageFooter } from '@/components/landing/PageFooter';
import { getShare, importShare, type ShareMetadata } from '@/libs/share';
import { ensureSharedBookLocal } from '@/libs/shareImport';
import { getAPIBaseUrl } from '@/services/environment';
import { useBuddyReadStore } from '@/store/buddyReadStore';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';

const BuddyReadJoinLanding = () => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { appService } = useEnv();

  const id = searchParams?.get('id') ?? '';
  const shareToken = searchParams?.get('shareToken') ?? searchParams?.get('token') ?? '';

  const [buddyRead, setBuddyRead] = useState<any | null>(null);
  const [meta, setMeta] = useState<ShareMetadata | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinProgress, setJoinProgress] = useState<number | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoadError({ status: 400, message: _('Missing buddy read ID') });
      return;
    }

    let cancelled = false;

    // Fetch buddy read details from public endpoint
    const fetchDetails = async () => {
      try {
        const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(_('Could not fetch buddy read details'));
        }
        const resData = await res.json();
        if (!cancelled) setBuddyRead(resData.data);
      } catch (err: any) {
        if (!cancelled) {
          setLoadError({
            status: 404,
            message: err.message || _('Buddy read group not found'),
          });
        }
      }
    };

    fetchDetails();

    // Fetch share metadata if token is provided
    if (shareToken) {
      (async () => {
        try {
          const data = await getShare(shareToken);
          if (!cancelled) setMeta(data);
        } catch (err) {
          console.warn('Could not load associated share metadata', err);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [id, shareToken, _]);

  const appHref = `readest://buddy-read?id=${encodeURIComponent(id)}${
    shareToken ? `&shareToken=${encodeURIComponent(shareToken)}` : ''
  }`;

  const handleJoin = async () => {
    if (!id || joining) return;
    setJoining(true);
    setJoinProgress(null);
    setJoinError(null);

    try {
      let importedBookHash: string | null = null;

      // 1. If we have a shareToken, import & download the book first
      if (shareToken && appService) {
        try {
          const result = await importShare(shareToken);
          const book = await ensureSharedBookLocal({
            token: shareToken,
            importResult: result,
            appService,
            meta: meta ?? undefined,
            onProgress: setJoinProgress,
          });
          importedBookHash = book.hash;
        } catch (importErr: any) {
          console.error('Failed to import shared book during join:', importErr);
          // Don't fail the whole join flow if book import fails; user can manually match/add
        }
      }

      // 2. Join the buddy read
      const store = useBuddyReadStore.getState();
      await store.joinBuddyRead(Number(id));

      // 3. Navigate to reader if book is available, else go to library
      if (importedBookHash) {
        navigateToReader(router, [importedBookHash]);
      } else {
        router.push('/library');
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Joined buddy read successfully!'),
          timeout: 3000,
        });
      }
    } catch (err: any) {
      setJoining(false);
      setJoinProgress(null);
      setJoinError(err.message || _('Could not join buddy read'));
    }
  };

  const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] || '';

  if (loadError) {
    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <div className='flex flex-col items-center text-center'>
            <div className='bg-base-200 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
              <IoAlertCircleOutline className='text-base-content/60 h-8 w-8' />
            </div>
            <h1 className='text-base-content text-2xl font-semibold'>
              {_('Could not load invitation')}
            </h1>
            <p className='text-base-content/70 mt-2 text-sm'>{loadError.message}</p>
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

  if (!buddyRead) {
    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <BrandHeader title={_('Loading invitation…')} alt={_('Readest logo')} />
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

  const coverSrc = meta?.hasCover ? `/api/share/${encodeURIComponent(shareToken)}/cover` : null;

  return (
    <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-6'>
      <div className='bg-base-100 border-base-300/60 mx-auto w-full max-w-md overflow-hidden rounded-2xl border shadow-xl sm:max-w-2xl'>
        {/* Header */}
        <div className='flex flex-col items-center gap-2 px-5 pb-2 pt-5 sm:px-7 sm:pb-3 sm:pt-7'>
          <Image
            src={`${basePath}/icon.png`}
            alt={_('Readest logo')}
            width={40}
            height={40}
            priority
            className='rounded-lg'
          />
          <span className='text-base-content text-base font-semibold'>
            {_('Buddy Read Invitation')}
          </span>
        </div>

        <div className='flex flex-col items-center gap-5 px-5 pb-5 sm:flex-row sm:items-stretch sm:gap-7 sm:px-7 sm:pb-7'>
          {/* Cover */}
          <div className='aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg shadow-lg sm:w-40 sm:self-center'>
            {coverSrc ? (
              <img src={coverSrc} alt='' className='h-full w-full object-cover' loading='eager' />
            ) : (
              <div className='bg-base-200 flex h-full w-full items-center justify-center'>
                <IoBookOutline className='text-base-content/30 h-10 w-10' aria-hidden='true' />
              </div>
            )}
          </div>

          {/* Details */}
          <div className='flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:justify-center sm:text-left'>
            <span className='badge badge-primary gap-1 mb-2 px-2.5 py-1 text-xs font-semibold'>
              <IoPeopleOutline className='h-3.5 w-3.5' />
              {buddyRead.members?.length || 1} {_('Members')}
            </span>
            <h1 className='text-base-content line-clamp-3 text-xl font-semibold leading-tight sm:text-2xl'>
              {buddyRead.book_title || meta?.title || _('Unknown Book')}
            </h1>
            {buddyRead.host?.name && (
              <p className='text-base-content/70 mt-1 truncate text-sm'>
                {_('Hosted by')} {buddyRead.host.name}
              </p>
            )}
            {buddyRead.buddyReadDescription && (
              <div className='mt-3 p-3 bg-base-200/50 rounded-lg text-xs leading-relaxed max-w-full text-base-content/80 text-left border border-base-300/40'>
                {buddyRead.buddyReadDescription}
              </div>
            )}

            {/* Actions */}
            <div className='mt-4 flex w-full flex-col gap-2 sm:mt-5'>
              {user ? (
                <>
                  <button
                    type='button'
                    onClick={handleJoin}
                    disabled={joining}
                    aria-busy={joining}
                    className='btn btn-primary btn-block flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                  >
                    {joining ? (
                      <span className='loading loading-spinner loading-sm' aria-hidden='true' />
                    ) : (
                      <IoLibraryOutline className='h-5 w-5' aria-hidden='true' />
                    )}
                    {joining
                      ? joinProgress !== null
                        ? _('Downloading Book… {{percent}}%', { percent: joinProgress })
                        : _('Joining Group…')
                      : shareToken
                        ? _('Join Group & Add Book')
                        : _('Join Buddy Read')}
                  </button>
                  {joining && joinProgress !== null && (
                    <progress
                      className='progress progress-primary w-full'
                      value={joinProgress}
                      max={100}
                      aria-label={_('Import progress')}
                    />
                  )}
                  <a
                    href={appHref}
                    aria-disabled={joining}
                    onClick={(e) => {
                      if (joining) e.preventDefault();
                    }}
                    className={
                      joining
                        ? 'btn btn-ghost btn-block btn-disabled flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                        : 'btn btn-ghost btn-block flex-nowrap gap-2 whitespace-nowrap rounded-xl'
                    }
                  >
                    <IoOpenOutline className='h-5 w-5' aria-hidden='true' />
                    {_('Open in app')}
                  </a>
                  {joinError && (
                    <p className='text-error mt-1 text-center text-xs sm:text-left' role='alert'>
                      {joinError}
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
                  <p className='text-base-content/60 mt-3 text-xs leading-normal'>
                    {_('Please sign in on the web or open the link in the app to join.')}
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

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BuddyReadJoinLanding />
    </Suspense>
  );
}
