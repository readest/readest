'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { FcGoogle } from 'react-icons/fc';
import { FaApple } from 'react-icons/fa';
import { FaGithub } from 'react-icons/fa';
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
import { handleAuthCallback } from '@/helpers/auth';
import { getUserProfilePlan } from '@/utils/access';
import { getAppleIdAuth, Scope } from './utils/appleIdAuth';
import { authWithCustomTab, authWithSafari } from './utils/nativeAuth';
import WindowButtons from '@/components/WindowButtons';

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

const WEB_AUTH_CALLBACK = `${getBaseUrl()}/auth/callback`;
const DEEPLINK_CALLBACK = 'readest://auth-callback';
const USE_APPLE_SIGN_IN = process.env['NEXT_PUBLIC_USE_APPLE_SIGN_IN'] === 'true';

const ProviderLogin: React.FC<ProviderLoginProp> = ({ provider, handleSignIn, Icon, label }) => {
  return (
    <button
      onClick={() => handleSignIn(provider)}
      className={clsx(
        'mb-2 flex w-64 items-center justify-center rounded border p-2.5',
        'bg-base-100 border-base-300 hover:bg-base-200 shadow-sm transition',
      )}
    >
      <Icon />
      <span className='text-base-content/75 px-2 text-sm'>{label}</span>
    </button>
  );
};

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { isDarkMode, safeAreaInsets, isRoundedWindow } = useThemeStore();
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo: getTauriRedirectTo(true),
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
      const res = await authWithCustomTab({ authUrl: data.url });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else {
      await openUrl(data.url);
    }
  };

  const handleOAuthUrl = async (url: string) => {
    console.log('Handle OAuth URL:', url);
    const hashMatch = url.match(/#(.*)/);
    if (hashMatch) {
      const hash = hashMatch[1];
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');
      if (accessToken) {
        let next = params.get('next') ?? '/';
        if (getUserProfilePlan(accessToken) === 'free') {
          next = '/user';
        }
        handleAuthCallback({ accessToken, refreshToken, type, next, login, navigate: router.push });
      }
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
    router.back();
  };

  const getAuthLocalization = () => {
    return {
      variables: {
        sign_in: {
          email_label: _('Email address'),
          password_label: _('Your Password'),
          email_input_placeholder: _('Your email address'),
          password_input_placeholder: _('Your password'),
          button_label: _('Sign in'),
          loading_button_label: _('Signing in...'),
          social_provider_text: _('Sign in with {{provider}}'),
          link_text: _('Already have an account? Sign in'),
        },
        sign_up: {
          email_label: _('Email address'),
          password_label: _('Create a Password'),
          email_input_placeholder: _('Your email address'),
          password_input_placeholder: _('Your password'),
          button_label: _('Sign up'),
          loading_button_label: _('Signing up...'),
          social_provider_text: _('Sign in with {{provider}}'),
          link_text: _("Don't have an account? Sign up"),
          confirmation_text: _('Check your email for the confirmation link'),
        },
        magic_link: {
          email_input_label: _('Email address'),
          email_input_placeholder: _('Your email address'),
          button_label: _('Sign in'),
          loading_button_label: _('Signing in ...'),
          link_text: _('Send a magic link email'),
          confirmation_text: _('Check your email for the magic link'),
        },
        forgotten_password: {
          email_label: _('Email address'),
          password_label: _('Your Password'),
          email_input_placeholder: _('Your email address'),
          button_label: _('Send reset password instructions'),
          loading_button_label: _('Sending reset instructions ...'),
          link_text: _('Forgot your password?'),
          confirmation_text: _('Check your email for the password reset link'),
        },
        verify_otp: {
          email_input_label: _('Email address'),
          email_input_placeholder: _('Your email address'),
          phone_input_label: _('Phone number'),
          phone_input_placeholder: _('Your phone number'),
          token_input_label: _('Token'),
          token_input_placeholder: _('Your OTP token'),
          button_label: _('Verify token'),
          loading_button_label: _('Signing in ...'),
        },
      },
    };
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
        'bg-base-100 inset-0 flex h-[100vh] select-none flex-col items-center overflow-hidden',
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
            'z-20 flex flex-col items-center pb-8',
            appService?.hasTrafficLight ? 'mt-24' : 'mt-12',
          )}
          style={{ maxWidth: '420px' }}
        >
          <ProviderLogin
            provider='google'
            handleSignIn={tauriSignIn}
            Icon={FcGoogle}
            label={_('Sign in with Google')}
          />
          <ProviderLogin
            provider='apple'
            handleSignIn={
              appService?.isIOSApp || USE_APPLE_SIGN_IN ? tauriSignInApple : tauriSignIn
            }
            Icon={FaApple}
            label={_('Sign in with Apple')}
          />
          <ProviderLogin
            provider='github'
            handleSignIn={tauriSignIn}
            Icon={FaGithub}
            label={_('Sign in with GitHub')}
          />
          <hr className='border-base-300 my-3 mt-6 w-64 border-t' />
          <div className='w-full'>
            <Auth
              supabaseClient={supabase}
              appearance={{ theme: ThemeSupa }}
              theme={isDarkMode ? 'dark' : 'light'}
              magicLink={true}
              providers={[]}
              redirectTo={getTauriRedirectTo(false)}
              localization={getAuthLocalization()}
            />
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem', paddingTop: '4rem' }}>
      <button
        onClick={handleGoBack}
        className='btn btn-ghost fixed left-6 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme={isDarkMode ? 'dark' : 'light'}
        magicLink={true}
        providers={['google', 'apple', 'github']}
        redirectTo={getWebRedirectTo()}
        localization={getAuthLocalization()}
      />
    </div>
  );
}
