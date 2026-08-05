'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { IoArrowBack } from 'react-icons/io5';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { getBaseUrl, isTauriAppPlatform } from '@/services/environment';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { start, cancel, onUrl, onInvalidUrl } from '@fabianlars/tauri-plugin-oauth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { handleAuthCallback, parseOAuthCallbackUrl } from '@/helpers/auth';
import { getUserProfilePlan } from '@/utils/access';
import { getAppleIdAuth, Scope } from './utils/appleIdAuth';
import { authWithCustomTab, authWithSafari } from './utils/nativeAuth';
import WindowButtons from '@/components/WindowButtons';
import type { OAuthProvider } from './components/ProviderLogin';
import AuthPanel from './components/AuthPanel';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

const WEB_AUTH_CALLBACK = `${getBaseUrl()}/auth/callback`;
const DEEPLINK_CALLBACK = 'readest://auth-callback';
const USE_APPLE_SIGN_IN = process.env['NEXT_PUBLIC_USE_APPLE_SIGN_IN'] === 'true';

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const isOAuthServerRunning = useRef(false);
  const useCustomeOAuth = useRef(false);

  const headerRef = useRef<HTMLDivElement>(null);

  useTheme({ systemUIVisible: false });

  const getTauriRedirectTo = (isOAuth: boolean) => {
    // For custom OAuth mode, use a local server to handle the OAuth callback
    // This is useful for development or some sandboxed environments like Flatpak
    // where custom URL schemes are not supported
    if (
      !useCustomeOAuth.current &&
      (process.env.NODE_ENV === 'production' || appService?.isMobileApp || USE_APPLE_SIGN_IN)
    ) {
      if (appService?.isMobileApp) {
        return isOAuth ? DEEPLINK_CALLBACK : WEB_AUTH_CALLBACK;
      }
      return DEEPLINK_CALLBACK;
    }
    // For development env on Desktop, use a custom OAuth callback server
    // it's possible to register a custom URL scheme for the app
    // but this is not supported by macOS, so we use a local server instead
    return `http://localhost:${port}`;
  };

  const getWebRedirectTo = () => {
    return process.env.NODE_ENV === 'production'
      ? WEB_AUTH_CALLBACK
      : `${window.location.origin}/auth/callback`;
  };

  const tauriSignInApple = async () => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    supabase.auth.signOut();
    const request = {
      scope: ['fullName', 'email'] as Scope[],
    };
    if (appService?.isIOSApp || USE_APPLE_SIGN_IN) {
      const appleAuthResponse = await getAppleIdAuth(request);
      if (appleAuthResponse.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: appleAuthResponse.identityToken,
        });
        if (error) {
          console.error('Authentication error:', error);
        }
      }
    } else {
      console.log('Sign in with Apple on this platform is not supported yet');
    }
  };

  const tauriSignIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    supabase.auth.signOut();
    const redirectTo = getTauriRedirectTo(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo,
      },
    });

    if (error) {
      console.error('Authentication error:', error);
      return;
    }
    // Open the OAuth URL in a ASWebAuthenticationSession on iOS to comply with Apple's guidelines
    // for other platforms, open the OAuth URL in the default browser
    if (appService?.isIOSApp || appService?.isMacOSApp) {
      const res = await authWithSafari({ authUrl: data.url });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else if (appService?.isAndroidApp) {
      const res = await authWithCustomTab({ authUrl: data.url, callbackUrl: redirectTo });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else {
      await openUrl(data.url);
    }
  };

  const tauriProviderSignIn = async (provider: OAuthProvider) => {
    if (provider === 'apple' && (appService?.isIOSApp || USE_APPLE_SIGN_IN)) {
      return tauriSignInApple();
    }
    return tauriSignIn(provider);
  };

  const webProviderSignIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getWebRedirectTo() },
    });
    if (error) {
      console.error('Authentication error:', error);
    }
  };

  const handleOAuthUrl = async (url: string) => {
    console.log('Handle OAuth URL:', url);
    const { accessToken, refreshToken, type, next, error, errorCode, errorDescription } =
      parseOAuthCallbackUrl(url);
    if (error) {
      console.error('OAuth callback error:', error, errorCode, errorDescription);
      handleAuthCallback({ error, errorCode, errorDescription, login, navigate: router.push });
      return;
    }
    if (accessToken) {
      let nextPath = next ?? '/';
      if (getUserProfilePlan(accessToken) === 'free') {
        nextPath = '/user';
      }
      handleAuthCallback({
        accessToken,
        refreshToken,
        type,
        next: nextPath,
        login,
        navigate: router.push,
      });
    }
  };

  const startTauriOAuth = async () => {
    try {
      if (
        !useCustomeOAuth.current &&
        (process.env.NODE_ENV === 'production' || appService?.isMobileApp || USE_APPLE_SIGN_IN)
      ) {
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
    const redirectTo = new URLSearchParams(window.location.search).get('redirect');
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.back();
    }
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (isOAuthServerRunning.current) return;
    isOAuthServerRunning.current = true;

    invoke('get_environment_variable', { name: 'USE_CUSTOM_OAUTH' }).then((value) => {
      if (value === 'true') {
        useCustomeOAuth.current = true;
      }
    });

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
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        const lastRedirectAtKey = 'lastRedirectAt';
        const lastRedirectAt = parseInt(localStorage.getItem(lastRedirectAtKey) || '0', 10);
        const now = Date.now();
        localStorage.setItem(lastRedirectAtKey, now.toString());
        if (now - lastRedirectAt > 3000) {
          router.push(redirectTo ?? '/library');
        }
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
    <div
      className={clsx(
        'bg-base-100 full-height inset-0 flex select-none flex-col items-center overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className={clsx('flex h-full w-full flex-col items-center overflow-y-auto')}
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <div
          ref={headerRef}
          className={clsx(
            'fixed z-10 flex w-full items-center justify-between py-2 pe-6 ps-4',
            appService?.hasTrafficLight && 'pt-11',
          )}
          style={{ top: `${safeAreaInsets?.top || 0}px` }}
        >
          <button
            aria-label={_('Go Back')}
            onClick={handleGoBack}
            className={clsx('btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8')}
          >
            <IoArrowBack className='text-base-content' />
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
          className={clsx(
            'z-20 flex w-full flex-col items-center px-6 pb-12',
            appService?.hasTrafficLight ? 'mt-24' : 'mt-16',
          )}
        >
          <AuthPanel
            supabaseClient={supabase}
            magicLink={true}
            redirectTo={getTauriRedirectTo(false)}
            onProviderSignIn={tauriProviderSignIn}
          />
        </div>
      </div>
    </div>
  ) : (
    <div className='bg-base-100 flex min-h-screen flex-col items-center overflow-y-auto px-6 pb-12 pt-20'>
      <button
        aria-label={_('Go Back')}
        onClick={handleGoBack}
        className='btn btn-ghost fixed start-6 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <AuthPanel
        supabaseClient={supabase}
        magicLink={true}
        redirectTo={getWebRedirectTo()}
        onProviderSignIn={webProviderSignIn}
      />
    </div>
  );
}
