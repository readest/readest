import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { checkSignInDeviceLimit } from '@/libs/syncDevices';

interface UseAuthCallbackOptions {
  accessToken?: string | null;
  refreshToken?: string | null;
  login: (accessToken: string, user: User) => void;
  navigate: (path: string) => void;
  type?: string | null;
  next?: string;
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
  /**
   * Over the Free plan's device limit. Goes to /auth, which lists the devices
   * and goes on to `destination` once one is signed out.
   */
  onDeviceLimit?: (destination: string) => void;
}

export interface OAuthCallbackParams {
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  next: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

// OAuth callbacks may carry data in the URL fragment (implicit flow tokens) or
// the query string (provider/GoTrue errors), so we read from both.
export function parseOAuthCallbackUrl(url: string): OAuthCallbackParams {
  const hashParams = new URLSearchParams(url.match(/#(.*)/)?.[1] ?? '');
  const queryParams = new URLSearchParams(url.match(/\?([^#]*)/)?.[1] ?? '');
  const getParam = (key: string) => hashParams.get(key) ?? queryParams.get(key);
  return {
    accessToken: getParam('access_token'),
    refreshToken: getParam('refresh_token'),
    type: getParam('type'),
    next: getParam('next'),
    error: getParam('error'),
    errorCode: getParam('error_code'),
    errorDescription: getParam('error_description'),
  };
}

// AuthProvider stores nothing for a new sign-in whose device check failed, and
// an offline launch restores the sign-in from this key. It comes from the SDK's
// session: setSession refreshes an expired link, which spends its refresh token.
const keepRefreshToken = (session: Session | null) => {
  if (session) localStorage.setItem('refresh_token', session.refresh_token);
};

export function handleAuthCallback({
  accessToken,
  refreshToken,
  login,
  navigate,
  type,
  next = '/',
  error,
  onDeviceLimit = (destination) => navigate(`/auth?redirect=${encodeURIComponent(destination)}`),
}: UseAuthCallbackOptions) {
  async function finalizeSession() {
    if (error) {
      navigate('/auth/error');
      return;
    }

    if (!accessToken || !refreshToken) {
      // On web, supabase-js takes the tokens from the URL and clears it first.
      const { data } = await supabase.auth.getSession();
      if (data.session && (await checkSignInDeviceLimit(data.session.access_token))) {
        onDeviceLimit('/library');
        return;
      }
      if (data.session) {
        login(data.session.access_token, data.session.user);
        keepRefreshToken(data.session);
      }
      navigate('/library');
      return;
    }

    const { error: err } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (err) {
      console.error('Error setting session:', err);
      navigate('/auth/error');
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      if (await checkSignInDeviceLimit(accessToken)) {
        onDeviceLimit(type === 'recovery' ? '/auth/recovery' : next);
        return;
      }
      login(accessToken, user);
      // Another link may have replaced the SDK's session meanwhile.
      const { session } = (await supabase.auth.getSession()).data;
      if (session?.user.id === user.id) keepRefreshToken(session);
      if (type === 'recovery') {
        navigate('/auth/recovery');
        return;
      }
      navigate(next);
    } else {
      console.error('Error fetching user data');
      navigate('/auth/error');
    }
  }

  finalizeSession();
}
