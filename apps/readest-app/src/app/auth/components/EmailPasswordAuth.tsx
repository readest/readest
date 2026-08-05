import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTranslation } from '@/hooks/useTranslation';

type AuthView = 'sign_in' | 'sign_up' | 'magic_link' | 'forgotten_password';

interface EmailPasswordAuthProps {
  supabaseClient: SupabaseClient;
  redirectTo?: string;
  magicLink?: boolean;
}

const FORM_IDS: Record<AuthView, string> = {
  sign_in: 'auth-sign-in',
  sign_up: 'auth-sign-up',
  magic_link: 'auth-magic-link',
  forgotten_password: 'auth-forgot-password',
};

const LINK_CLASS =
  'text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors duration-150';

export default function EmailPasswordAuth({
  supabaseClient,
  redirectTo,
  magicLink = false,
}: EmailPasswordAuthProps) {
  const _ = useTranslation();
  const [view, setView] = useState<AuthView>('sign_in');
  const [defaultEmail, setDefaultEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);

  const hasPassword = view === 'sign_in' || view === 'sign_up';

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const layoutH = document.documentElement.clientHeight;
      const offset = layoutH - vv.height - vv.offsetTop;
      setKeyboardInset(offset > 1 ? offset : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // The Android WebView does not resize with the keyboard, and Chromium
  // resets the visual-viewport pan when the IME advances focus (keyboard
  // Next) without re-scrolling the newly focused editable. The keyboard
  // spacer gives the page scroller enough range, and the focus handler
  // scrolls the input back into the visible area above the keyboard.
  const keepAboveKeyboard = (event: React.FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    setTimeout(() => {
      if (document.activeElement === input) {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  };

  const switchView = (next: AuthView) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.form;
    if (form) {
      const email = new FormData(form).get('email');
      if (typeof email === 'string' && email) {
        setDefaultEmail(email);
      }
    }
    setError('');
    setMessage('');
    setView(next);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read credentials from the form's DOM state: Android/iOS password
    // managers fill WebView inputs without events React state can track.
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (view === 'sign_in') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
      } else if (view === 'sign_up') {
        const {
          data: { user, session },
          error,
        } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) setError(error.message);
        else if (user && !session) setMessage(_('Check your email for the confirmation link'));
      } else if (view === 'magic_link') {
        const { error } = await supabaseClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) setError(error.message);
        else setMessage(_('Check your email for the magic link'));
      } else {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) setError(error.message);
        else setMessage(_('Check your email for the password reset link'));
      }
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = {
    sign_in: loading ? _('Signing in...') : _('Sign in'),
    sign_up: loading ? _('Signing up...') : _('Sign up'),
    magic_link: loading ? _('Signing in ...') : _('Sign in'),
    forgotten_password: loading
      ? _('Sending reset instructions ...')
      : _('Send reset password instructions'),
  }[view];

  return (
    <form
      key={view}
      id={FORM_IDS[view]}
      method='post'
      onSubmit={handleSubmit}
      className='w-full space-y-4'
    >
      <div className='form-control'>
        <label className='label' htmlFor='email'>
          <span className='label-text'>{_('Email address')}</span>
        </label>
        <input
          id='email'
          name='email'
          type='email'
          required
          defaultValue={defaultEmail}
          placeholder={_('Your email address')}
          autoComplete={hasPassword ? 'username' : 'email'}
          className='input input-bordered eink-bordered w-full rounded-lg placeholder:text-sm'
          disabled={loading}
          onFocus={keepAboveKeyboard}
        />
      </div>
      {hasPassword && (
        <div className='form-control'>
          <label className='label' htmlFor='password'>
            <span className='label-text'>
              {view === 'sign_in' ? _('Your Password') : _('Create a Password')}
            </span>
          </label>
          <input
            id='password'
            name='password'
            type='password'
            required
            placeholder={_('Your password')}
            autoComplete={view === 'sign_in' ? 'current-password' : 'new-password'}
            className='input input-bordered eink-bordered w-full rounded-lg placeholder:text-sm'
            disabled={loading}
            onFocus={keepAboveKeyboard}
          />
        </div>
      )}
      <button type='submit' className='btn btn-primary w-full rounded-lg' disabled={loading}>
        {loading && <span className='loading loading-spinner loading-sm' aria-hidden='true' />}
        {buttonLabel}
      </button>
      {message && (
        <div className='eink-bordered border-base-200 bg-base-200/40 text-base-content/80 rounded-lg border px-3 py-2.5 text-center text-sm leading-relaxed'>
          {message}
        </div>
      )}
      {error && (
        <div className='eink-bordered border-error/30 bg-error/5 text-error rounded-lg border px-3 py-2.5 text-center text-sm leading-relaxed'>
          {error}
        </div>
      )}
      <div className='flex flex-col items-center gap-2.5 pt-1 text-sm'>
        {view === 'sign_in' && (
          <>
            {magicLink && (
              <button type='button' className={LINK_CLASS} onClick={switchView('magic_link')}>
                {_('Send a magic link email')}
              </button>
            )}
            <button type='button' className={LINK_CLASS} onClick={switchView('forgotten_password')}>
              {_('Forgot your password?')}
            </button>
            <button type='button' className={LINK_CLASS} onClick={switchView('sign_up')}>
              {_("Don't have an account? Sign up")}
            </button>
          </>
        )}
        {view !== 'sign_in' && (
          <button type='button' className={LINK_CLASS} onClick={switchView('sign_in')}>
            {_('Already have an account? Sign in')}
          </button>
        )}
      </div>
      {keyboardInset > 0 && (
        <div data-keyboard-spacer='' aria-hidden='true' style={{ height: `${keyboardInset}px` }} />
      )}
    </form>
  );
}
