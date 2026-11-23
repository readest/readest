import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTranslation } from '@/hooks/useTranslation';
import DeviceCode from '@/components/DeviceCode';
import {
  CodeSignInError,
  pollSignInSession,
  requestSignInCode,
  type SignInCode,
} from '../utils/codeSignIn';

interface CodeSignInProps {
  supabaseClient: SupabaseClient;
  onCancel: () => void;
}

/**
 * Signs in with a code approved on a phone or computer already signed in to
 * Readest (the /link page). Typing nothing suits e-ink readers, and it works
 * for every sign-in method, since this device never sees a password.
 */
export default function CodeSignIn({ supabaseClient, onCancel }: CodeSignInProps) {
  const _ = useTranslation();
  const [code, setCode] = useState<SignInCode | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setCode(null);
    setError('');
    void (async () => {
      try {
        const next = await requestSignInCode();
        if (abort.signal.aborted) return;
        setCode(next);
        const session = await pollSignInSession(next, { signal: abort.signal });
        // The auth page hears the new session (onAuthStateChange) and leaves.
        const { error } = await supabaseClient.auth.setSession(session);
        if (error) throw error;
      } catch (e) {
        if (abort.signal.aborted) return;
        setCode(null);
        setError(
          e instanceof CodeSignInError && e.code === 'expired_token'
            ? _('The code expired. Please try again.')
            : _('Unable to connect to Readest. Please check your network connection.'),
        );
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className='flex w-full flex-col items-center gap-4 text-center'>
      {error ? (
        <>
          <p className='text-sm'>{error}</p>
          <button
            type='button'
            className='btn btn-contrast w-full'
            onClick={() => setAttempt((n) => n + 1)}
          >
            {_('Try Again')}
          </button>
        </>
      ) : code ? (
        <>
          <DeviceCode
            userCode={code.userCode}
            verificationUri={code.verificationUri}
            verificationUriComplete={code.verificationUriComplete}
          />
          <p className='text-base-content/70 text-xs'>
            {_('Approve on a phone or computer signed in to Readest.')}
          </p>
        </>
      ) : (
        <span className='loading loading-spinner loading-md' />
      )}
      <button type='button' className='btn btn-ghost eink-bordered w-full' onClick={onCancel}>
        {_('Cancel')}
      </button>
    </div>
  );
}
