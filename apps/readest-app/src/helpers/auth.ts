import { User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';

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

export function handleAuthCallback({
  accessToken,
  refreshToken,
  login,
  navigate,
  type,
  next = '/',
  error,
}: UseAuthCallbackOptions) {
  async function finalizeSession() {
    if (error) {
      navigate('/auth/error');
      return;
    }

    if (!accessToken || !refreshToken) {
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
      login(accessToken, user);
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
