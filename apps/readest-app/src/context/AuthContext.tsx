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
import posthog from 'posthog-js';
import { supabase } from '@/utils/supabase';

export interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => void;
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

  const login = useCallback((newToken: string, newUser: User) => {
    console.log('Logging in to Biblophile account');
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    if (newUser.id) {
      posthog.identify(newUser.id);
    }
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out from Biblophile/Supabase account');
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Supabase sign-out failed:', e);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return;

    const apiUrl = process.env['NEXT_PUBLIC_BIBLO_API_URL'] || 'http://localhost:3001/api/v0';
    try {
      const response = await fetch(`${apiUrl}/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.accessToken) {
          localStorage.setItem('token', result.data.accessToken);
          setToken(result.data.accessToken);
        }
      }
    } catch (e) {
      console.error('Refresh token call failed:', e);
    }
  }, []);

  useEffect(() => {
    // Attempt initial token refresh on mount
    refresh();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const userData: User = {
          id: session.user.id,
          email: session.user.email,
          user_metadata: session.user.user_metadata,
        };
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
      } else if (_event === 'SIGNED_OUT') {
        setUser(null);
        localStorage.removeItem('user');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refresh]);

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
