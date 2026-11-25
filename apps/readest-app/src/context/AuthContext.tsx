'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import { isAuthRetryableFetchError, User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { claimGiftCards } from '@/libs/payment/gift/client';
import { fetchSyncDevices, hasDeviceLimit } from '@/libs/syncDevices';
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
  // logout() refreshes before signing out, which reports the session again.
  const signingOut = useRef(false);

  useEffect(() => {
    type Session = { access_token: string; refresh_token: string; user: User };
    // The SDK's latest report, so a device check that answers late can't
    // publish a session that has changed or ended since.
    let latestSession: Session | null = null;
    const publishSession = ({ access_token, refresh_token, user }: Session) => {
      console.log('Syncing session');
      localStorage.setItem('token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      localStorage.setItem('user', JSON.stringify(user));
      posthog.identify(user.id);
      setToken(access_token);
      setUser(user);
    };
    const syncSession = (session: Session | null) => {
      if (session && signingOut.current) return;
      latestSession = session;
      if (!session) {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
        return;
      }
      // A new sign-in on the Free plan waits for the device check. Held at the
      // device limit, it stays out of the app while the login page lists the
      // devices, and after a restart too; the login page signs it in once a
      // device is signed out. Only the server's answer lets it in: a failed
      // check, such as one the browser aborts on a reload, would let a held
      // sign-in in for good. The sign-in screens sign in on their own answer,
      // which still lets a sign-in through when the server can't answer.
      const storedUser = localStorage.getItem('user');
      const signedIn = !!storedUser && JSON.parse(storedUser).id === session.user.id;
      if (signedIn || !hasDeviceLimit(session.access_token)) {
        publishSession(session);
        return;
      }
      fetchSyncDevices(session.access_token).then(
        ({ blocked }) => {
          if (!blocked && !signingOut.current && latestSession === session) {
            publishSession(session);
          }
        },
        () => {},
      );
    };
    const refreshSession = async () => {
      try {
        await supabase.auth.refreshSession();
      } catch {
        // A thrown refresh is not the server rejecting the token: keep the
        // stored session. A rejection signs out through SIGNED_OUT.
      }
    };
    const restoreSession = async (refreshToken: string) => {
      try {
        const { error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
        // Offline or a gateway error: keep the session rather than sign out.
        if (error && !isAuthRetryableFetchError(error)) syncSession(null);
      } catch {
        // Not a rejection of the token either; keep the session.
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event !== 'INITIAL_SESSION') {
        syncSession(session);
        return;
      }
      // A null INITIAL_SESSION doesn't mean signed out. When the startup
      // refresh fails on the network (offline at launch), the SDK keeps its
      // stored session but still reports null. When the SDK's own startup
      // refresh fails with an error it doesn't retry, it drops its session
      // before this listener exists, so that SIGNED_OUT never reaches the app.
      // Ask the server about the app's refresh token before signing out.
      // Not awaited: the SDK callback must not wait on another SDK call.
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        void restoreSession(refreshToken);
      } else {
        syncSession(null);
      }
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
  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      return !error && !!data.session;
    } catch {
      return false;
    }
  }, []);

  const login = useCallback(
    (newToken: string, newUser: User) => {
      console.log('Logging in');
      setToken(newToken);
      setUser(newUser);
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(newUser));
      // Gift cards bought for this email reach the account at sign-in; the
      // refreshed session then carries the gifted plan.
      claimGiftCards()
        .then((claimed) => (claimed > 0 ? refresh() : undefined))
        .catch((error) => console.error('Failed to claim gift cards:', error));
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    console.log('Logging out');
    // Signed out in the app at once: the requests below can take a while (the
    // refresh retries for up to 30 s offline), and pages opened meanwhile still
    // saw the user signed in, so the library kept them signed in (#7726).
    signingOut.current = true;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    try {
      await supabase.auth.refreshSession();
    } catch {
    } finally {
      await supabase.auth.signOut({ scope: 'local' });
      signingOut.current = false;
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
