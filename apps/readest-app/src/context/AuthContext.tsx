'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useEffect,
} from 'react';
import { isAuthRetryableFetchError, User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import posthog from 'posthog-js';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  });
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    }
    return null;
  });

  useEffect(() => {
    const syncSession = (
      session: { access_token: string; refresh_token: string; user: User } | null,
    ) => {
      if (session) {
        console.log('Syncing session');
        const { access_token, refresh_token, user } = session;
        localStorage.setItem('token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        localStorage.setItem('user', JSON.stringify(user));
        posthog.identify(user.id);
        setToken(access_token);
        setUser(user);
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      }
    };
    const refreshSession = async () => {
      try {
        await supabase.auth.refreshSession();
      } catch {
        // A failed startup refresh must not sign the user out: the stored
        // access token may still be valid and the failure may be transient
        // (offline at launch, proxy hiccup). Keep the stored session; the
        // next refresh will retry.
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        syncSession(session);
        return;
      }
      if (event === 'INITIAL_SESSION') {
        // Supabase drops its own stored session at client init when the
        // startup refresh fails (e.g. a transient network error on
        // WebView2 at launch) and then reports a null INITIAL_SESSION.
        // The app's stored refresh token may still be valid, so try to
        // re-establish the session from it before signing the user out.
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          try {
            const { error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
            if (!error) return;
            if (isAuthRetryableFetchError(error)) {
              // Transient failure (offline at launch, proxy hiccup): keep
              // the stored session so the user stays signed in on the
              // existing access token; the next refresh will retry.
              return;
            }
          } catch {
            // A thrown refresh must not sign the user out either.
            return;
          }
        }
      }
      syncSession(null);
    });

    refreshSession();
    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  // setToken / setUser from useState are stable across renders, so the empty
  // deps array is correct. Wrapping in useCallback (and only including stable
  // refs in the deps) is what makes the useMemo below actually memoize the
  // context value — without this, login/logout/refresh would be recreated on
  // every render and the memo would always invalidate.
  const login = useCallback((newToken: string, newUser: User) => {
    console.log('Logging in');
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out');
    try {
      await supabase.auth.refreshSession();
    } catch {
    } finally {
      await supabase.auth.signOut({ scope: 'local' });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      return !error && !!data.session;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
