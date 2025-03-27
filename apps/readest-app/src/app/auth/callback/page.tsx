'use client';

import { useRouter } from 'next/navigation';
import { handleAuthCallback } from '@/helpers/auth';
import { useAuth } from '@/context/AuthContext';

export default function AuthCallback() {
  const router = useRouter();
  const { login } = useAuth();

  if (typeof window === 'undefined') {
    return null;
  }
  const hash = window.location.hash || '';
  const params = new URLSearchParams(hash.slice(1));

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');
  const next = params.get('next') ?? '/';

  handleAuthCallback({ accessToken, refreshToken, type, next, login, navigate: router.push });

  return null;
}
