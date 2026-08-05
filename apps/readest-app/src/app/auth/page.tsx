'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IoArrowBack } from 'react-icons/io5';

import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { isTauriAppPlatform } from '@/services/environment';
import WindowButtons from '@/components/WindowButtons';

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { isDarkMode, safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);

  useTheme({ systemUIVisible: false });

  const handleGoBack = () => {
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    const redirectTo = new URLSearchParams(window.location.search).get('redirect');
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.back();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError(_('Email and password are required.'));
      return;
    }

    setLoading(true);
    setError(null);

    const apiUrl = process.env.NEXT_PUBLIC_BIBLO_API_URL || 'http://localhost:3001/api/v0';

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, pass: password }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success' && result.data) {
        const data = result.data;
        localStorage.setItem('refresh_token', data.refreshToken);
        const user = {
          id: String(data.userId),
          email: data.email,
          user_metadata: {
            full_name: data.fullName,
            name: data.name,
          },
        };
        login(data.accessToken, user);

        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        router.push(redirectTo ?? '/library');
      } else {
        setError(result.message || _('Invalid email or password'));
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(_('Failed to connect to authentication server'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  const containerClasses = clsx(
    'bg-base-100 full-height inset-0 flex select-none flex-col items-center overflow-hidden',
    appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
  );

  return (
    <div className={containerClasses}>
      <div
        className='fixed z-10 flex w-full items-center justify-between py-2 pe-6 ps-4'
        ref={headerRef}
        style={{
          paddingTop: `${(safeAreaInsets?.top || 0) + (appService?.hasTrafficLight ? 44 : 8)}px`,
        }}
      >
        <button
          aria-label={_('Go Back')}
          onClick={handleGoBack}
          className='btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8'
        >
          <IoArrowBack className='text-base-content text-xl' />
        </button>

        {appService?.hasWindowBar && (
          <WindowButtons
            headerRef={headerRef}
            showMinimize={!isTrafficLightVisible}
            showMaximize={!isTrafficLightVisible}
            showClose={!isTrafficLightVisible}
            onClose={handleGoBack}
          />
        )}
      </div>

      <div
        className='z-20 flex flex-col items-center w-full max-w-[400px] px-6 mx-auto justify-center h-full'
        style={{ marginTop: '60px' }}
      >
        <div className='w-full text-center mb-8'>
          <h1 className='text-3xl font-bold tracking-tight text-base-content font-poppins mb-2'>
            {_('Biblophile Account')}
          </h1>
          <p className='text-sm text-base-content/60'>
            {_('Sign in to sync your library, settings, annotations, and reading insights')}
          </p>
        </div>

        {error && (
          <div className='alert alert-error mb-4 w-full text-sm py-2 px-3 rounded-lg flex items-center gap-2'>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className='w-full flex flex-col gap-4'>
          <div className='form-control w-full'>
            <label className='label py-1'>
              <span className='label-text font-medium text-xs text-base-content/70'>
                {_('Email Address')}
              </span>
            </label>
            <input
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='you@example.com'
              className='input input-bordered w-full h-11 text-sm bg-base-200/50 focus:bg-base-200 focus:border-primary border-base-300'
              required
              disabled={loading}
            />
          </div>

          <div className='form-control w-full'>
            <label className='label py-1'>
              <span className='label-text font-medium text-xs text-base-content/70'>
                {_('Password')}
              </span>
            </label>
            <input
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='••••••••'
              className='input input-bordered w-full h-11 text-sm bg-base-200/50 focus:bg-base-200 focus:border-primary border-base-300'
              required
              disabled={loading}
            />
          </div>

          <button
            type='submit'
            className={clsx(
              'btn btn-primary w-full h-11 min-h-11 mt-4 text-sm font-semibold tracking-wide text-white uppercase rounded-lg shadow-lg hover:shadow-primary/30 transition-all duration-300',
            )}
            style={{ backgroundColor: '#D17842', borderColor: '#D17842' }}
            disabled={loading}
          >
            {loading ? (
              <span className='flex items-center gap-2'>
                <span className='loading loading-spinner loading-sm'></span>
                {_('Signing in...')}
              </span>
            ) : (
              _('Sign In')
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
