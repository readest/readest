'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdCheckCircle } from 'react-icons/md';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';
import { navigateToLogin } from '@/utils/nav';

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
  const [code, setCode] = useState(searchParams?.get('code') ?? '');
  const [status, setStatus] = useState<Status>('idle');

  const link = async () => {
    setStatus('linking');
    try {
      await fetchWithAuth(`${getAPIBaseUrl()}/crosspoint/device/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code }),
      });
      setStatus('linked');
    } catch {
      setStatus('failed');
    }
  };

  return (
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
        <button type='button' className='btn btn-contrast' onClick={() => navigateToLogin(router)}>
          {_('Sign in to continue')}
        </button>
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
  );
}
