'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Auth } from '@supabase/auth-ui-react';
import { supabase } from '@/utils/supabase';

export default function ResetPasswordPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { isDarkMode } = useThemeStore();

  const getAuthLocalization = () => {
    return {
      variables: {
        update_password: {
          password_label: _('New Password'),
          password_input_placeholder: _('Your new password'),
          button_label: _('Update password'),
          loading_button_label: _('Updating password ...'),
          confirmation_text: _('Your password has been updated'),
        },
      },
    };
  };

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && session.user && event === 'USER_UPDATED') {
        login(session.access_token, session.user);
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        router.push(redirectTo ?? '/library');
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-md p-8'>
        <Auth
          supabaseClient={supabase}
          view='update_password'
          appearance={{ theme: ThemeSupa }}
          theme={isDarkMode ? 'dark' : 'light'}
          magicLink={false}
          providers={[]}
          localization={getAuthLocalization()}
        />
      </div>
    </div>
  );
}
