'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { FcGoogle } from 'react-icons/fc';
import { FaApple } from 'react-icons/fa';
import { VscAzure } from 'react-icons/vsc';
import { FaGithub } from 'react-icons/fa';
import { IoArrowBack } from 'react-icons/io5';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useTheme } from '@/hooks/useTheme';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { start, cancel, onUrl, onInvalidUrl } from '@fabianlars/tauri-plugin-oauth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { handleAuthCallback } from '@/helpers/auth';

type OAuthProvider = 'google' | 'apple' | 'azure' | 'github';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface ProviderLoginProp {
  provider: OAuthProvider;
  handleSignIn: (provider: OAuthProvider) => void;
  Icon: React.ElementType;
  label: string;
}

const ProviderLogin: React.FC<ProviderLoginProp> = ({ provider, handleSignIn, Icon, label }) => {
  return (
    <button
      onClick={() => handleSignIn(provider)}
      className={clsx(
        'mb-2 flex w-64 items-center justify-center rounded border p-2.5',
        'bg-base-100 border-gray-300 shadow-sm transition hover:bg-gray-50',
      )}
    >
      <Icon size={20} />
      <span className='text-neutral-content/70 px-2 text-sm'>{label}</span>
    </button>
  );
};

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig } = useEnv();
  const { isDarkMode } = useTheme();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState<number | null>(null);
  const isOAuthServerRunning = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  const signIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo:
          process.env.NODE_ENV === 'production'
            ? 'readest://auth/callback'
            : `http://localhost:${port}`,
      },
    });

    if (error) {
      console.error('Authentication error:', error);
      return;
    }
    openUrl(data.url);
  };

  const handleOAuthUrl = async (url: string) => {
    console.log('Received OAuth URL:', url);
    const hashMatch = url.match(/#(.*)/);
    if (hashMatch) {
      const hash = hashMatch[1];
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const next = params.get('next') ?? '/';
      if (accessToken) {
        handleAuthCallback({ accessToken, refreshToken, next, login, navigate: router.push });
      }
    }
  };

  const startTauriOAuth = async () => {
    try {
      if (process.env.NODE_ENV === 'production') {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        currentWindow.listen('single-instance', ({ event, payload }) => {
          console.log('Received deep link:', event, payload);
          const { args } = payload as SingleInstancePayload;
          if (args?.[1]) {
            handleOAuthUrl(args[1]);
          }
        });
        await onOpenUrl((urls) => {
          urls.forEach((url) => {
            handleOAuthUrl(url);
          });
        });
      } else {
        const port = await start();
        setPort(port);
        console.log(`OAuth server started on port ${port}`);

        await onUrl(handleOAuthUrl);
        await onInvalidUrl((url) => {
          console.log('Received invalid OAuth URL:', url);
        });
      }
    } catch (error) {
      console.error('Error starting OAuth server:', error);
    }
  };

  const stopTauriOAuth = async () => {
    try {
      if (port) {
        await cancel(port);
        console.log('OAuth server stopped');
      }
    } catch (error) {
      console.error('Error stopping OAuth server:', error);
    }
  };

  const handleGoBack = () => {
    // Keep login false to avoid infinite loop to redirect to the login page
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    router.back();
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (isOAuthServerRunning.current) return;
    isOAuthServerRunning.current = true;

    startTauriOAuth();
    return () => {
      isOAuthServerRunning.current = false;
      stopTauriOAuth();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && session.user) {
        login(session.access_token, session.user);
        router.push('/library');
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  // For tauri app development, use a custom OAuth server to handle the OAuth callback
  // For tauri app production, use deeplink to handle the OAuth callback
  // For web app, use the built-in OAuth callback page /auth/callback
  return isTauriAppPlatform() ? (
    <div className='flex pt-11'>
      <button
        onClick={handleGoBack}
        className='btn btn-ghost fixed left-3 top-11 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack size={20} className='text-base-content' />
      </button>
      <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem' }}>
        <ProviderLogin
          provider='google'
          handleSignIn={signIn}
          Icon={FcGoogle}
          label='Sign in with Google'
        />
        <ProviderLogin
          provider='apple'
          handleSignIn={signIn}
          Icon={FaApple}
          label='Sign in with Apple'
        />
        <ProviderLogin
          provider='azure'
          handleSignIn={signIn}
          Icon={VscAzure}
          label='Sign in with Azure'
        />
        <ProviderLogin
          provider='github'
          handleSignIn={signIn}
          Icon={FaGithub}
          label='Sign in with GitHub'
        />
        <hr className='my-3 mt-6 w-64 border-t border-gray-200' />
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          theme={isDarkMode ? 'dark' : 'light'}
          magicLink={true}
          providers={[]}
          redirectTo={`http://localhost:${port}`}
        />
      </div>
    </div>
  ) : (
    <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem', paddingTop: '4rem' }}>
      <button
        onClick={handleGoBack}
        className='btn btn-ghost fixed left-10 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack size={20} className='text-base-content' />
      </button>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme={isDarkMode ? 'dark' : 'light'}
        magicLink={true}
        providers={['google', 'apple', 'azure', 'github']}
        redirectTo='/auth/callback'
      />
    </div>
  );
}
