'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdCheckCircle } from 'react-icons/md';
import { IoOpenOutline } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';
import { useOpenDeviceLink } from '@/hooks/useOpenDeviceLink';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl, isTauriAppPlatform } from '@/services/environment';
import { useThemeStore } from '@/store/themeStore';
import { fetchWithAuth } from '@/utils/fetch';
import { navigateToLibrary, navigateToLogin } from '@/utils/nav';
import ProfileHeader from '@/app/user/components/Header';

type Status = 'idle' | 'linking' | 'linked' | 'failed';

/**
 * Approves a CrossPoint reader's sign-in. The Readest card on the reader's web
 * Settings page links to this page with the code filled in, and waits until
 * its owner approves here.
 */
export default function LinkDevice() {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const queryCode = searchParams?.get('code') ?? '';
  const [code, setCode] = useState(queryCode);
  const [status, setStatus] = useState<Status>('idle');
  const { safeAreaInsets } = useThemeStore();
  // Opened from a reader sign-in link (useOpenDeviceLink), the app's own
  // account approves the code, and the page needs a way back.
  const inApp = isTauriAppPlatform();
  // Back to where the link arrived; a link that launched the app has no
  // history, so it goes to the library.
  const goBack = () => (window.history.length > 1 ? router.back() : navigateToLibrary(router));

  // The app can still be on this page, with the library and reader pages that
  // listen for links unmounted, when the next reader's sign-in link arrives:
  // listen here too, and show the code of the link that opened the page.
  useAppUrlIngress();
  useOpenDeviceLink();
  // The user's theme mode and color, like the account page this page shares
  // its header with; nothing else applies it when a link opens this page.
  useTheme({ systemUIVisible: false });
  // Bumped by each approval and each new code, so an approval still in
  // flight when another link's code arrives can't mark that code linked.
  const approval = useRef(0);
  useEffect(() => {
    approval.current++;
    setCode(queryCode);
    setStatus('idle');
  }, [queryCode]);

  const link = async () => {
    const current = ++approval.current;
    setStatus('linking');
    try {
      await fetchWithAuth(`${getAPIBaseUrl()}/crosspoint/device/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code }),
      });
      if (current === approval.current) setStatus('linked');
    } catch {
      if (current === approval.current) setStatus('failed');
    }
  };

  return (
    <div
      className='bg-base-100 full-height overflow-y-auto'
      style={inApp ? { paddingTop: `${safeAreaInsets?.top || 0}px` } : undefined}
    >
      {inApp && <ProfileHeader onGoBack={goBack} />}
      <div className='mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-16'>
        <header>
          <h1 className='text-xl font-semibold tracking-tight'>{_('Link a CrossPoint Reader')}</h1>
          <p className='text-base-content/70 mt-1 text-sm'>
            {_(
              'The reader gets your Readest library, reading statistics and reading progress. Only enter a code shown on your own reader.',
            )}
          </p>
        </header>

        {!user ? (
          <div className='flex flex-col gap-3'>
            {/* A phone browser is rarely signed in to Readest, and on iOS a social
              sign-in started here finishes in the app (/auth/* is a Universal
              Link), so offer the app, which usually is signed in. */}
            {!inApp && (
              <a
                href={`readest://link?code=${encodeURIComponent(code)}`}
                className='btn btn-contrast'
              >
                <IoOpenOutline className='h-5 w-5' aria-hidden='true' />
                {_('Open in app')}
              </a>
            )}
            <button
              type='button'
              className={inApp ? 'btn btn-contrast' : 'btn btn-ghost'}
              onClick={() => navigateToLogin(router)}
            >
              {_('Sign in to continue')}
            </button>
          </div>
        ) : status === 'linked' ? (
          <p className='flex items-center gap-2 text-sm'>
            <MdCheckCircle className='text-success h-5 w-5 shrink-0' />
            {_('Your reader is linked. It finishes signing in on its own.')}
          </p>
        ) : (
          <form
            className='flex flex-col gap-3'
            onSubmit={(e) => {
              e.preventDefault();
              void link();
            }}
          >
            <input
              className='input eink-bordered w-full text-center font-mono text-lg uppercase tracking-widest'
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder='XXXX-XXXX'
              aria-label={_('Code')}
              autoComplete='off'
              spellCheck={false}
            />
            <p className='text-base-content/60 text-xs'>
              {_('Linking to {{account}}', { account: user.email ?? '' })}
            </p>
            {status === 'failed' && (
              <p className='text-error text-sm'>
                {_('Could not link the reader. Check the code, or sign in again on the reader.')}
              </p>
            )}
            <button
              type='submit'
              className='btn btn-contrast'
              disabled={!code.trim() || status === 'linking'}
            >
              {status === 'linking' ? (
                <span className='loading loading-spinner loading-sm' />
              ) : (
                _('Link Reader')
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
