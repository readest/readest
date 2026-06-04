'use client';

import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';

type LocalUser = {
  id?: string;
  email?: string;
  user_metadata?: Record<string, string | null | undefined>;
};

interface AuthContextType {
  token: string | null;
  user: LocalUser | null;
  login: (token: string, user: LocalUser) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const login = useCallback((_newToken: string, _newUser: LocalUser) => {}, []);

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
    }
  }, []);

  const refresh = useCallback(() => {}, []);

  const value = useMemo(
    () => ({ token: null, user: null, login, logout, refresh }),
    [login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
