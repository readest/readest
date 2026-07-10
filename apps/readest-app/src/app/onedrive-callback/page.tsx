'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { resolveOneDriveAccountLabel } from '@/services/sync/providers/onedrive/onedriveAuth';
import { getMicrosoftClientId } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
import {
  consumeReturnPath,
  consumeWebOAuthState,
  consumeWebPkceVerifier,
  exchangeWebAuthCode,
  oneDriveWebRedirectUri,
  saveWebOneDriveToken,
} from '@/services/sync/providers/onedrive/webAuthCodeFlow';
import { persistActiveCloudProvider } from '@/components/settings/integrations/cloudSync';

/**
 * OAuth return route for the web OneDrive connect (full-page auth-code + PKCE
 * flow). Microsoft redirects here with the authorization code in the URL
 * query string (not the `#` fragment, unlike gdrive's implicit flow); we
 * validate the CSRF state, exchange the code for tokens, store them, mark
 * OneDrive the active cloud provider, then route back to where the user
 * started. See `onedrive/webAuthCodeFlow.ts`.
 */
export default function OneDriveCallback() {
  const router = useRouter();
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const setSettings = useSettingsStore((s) => s.setSettings);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const returnPath = consumeReturnPath();
      const expectedState = consumeWebOAuthState();
      const verifier = consumeWebPkceVerifier();
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const returnedState = params.get('state');
      const oauthError = params.get('error');
      try {
        if (oauthError) throw new Error(oauthError);
        if (!expectedState || returnedState !== expectedState) {
          throw new Error('state mismatch');
        }
        if (!code || !verifier) throw new Error('missing code or verifier');

        const clientId = getMicrosoftClientId();
        if (!clientId) throw new Error('OneDrive is not configured for the web build');

        const fetchFn = globalThis.fetch.bind(globalThis);
        const tokens = await exchangeWebAuthCode({
          clientId,
          code,
          verifier,
          redirectUri: oneDriveWebRedirectUri(),
          fetchFn,
        });

        saveWebOneDriveToken(tokens);

        const accountLabel = await resolveOneDriveAccountLabel(tokens.accessToken, fetchFn).catch(
          () => null,
        );

        // Mark OneDrive the single active cloud provider (turns others off) and
        // stamp the account label. persistActiveCloudProvider loads via
        // appService when the settings store isn't hydrated on this route,
        // persists, hydrates the store, and broadcasts to other windows.
        await persistActiveCloudProvider(envConfig, 'onedrive', (s) => ({
          ...s,
          onedrive: {
            ...s.onedrive,
            accountLabel: accountLabel ?? s.onedrive?.accountLabel,
          },
        }));
        eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
      } catch (e) {
        console.warn('[onedrive] web callback failed', e);
        eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to connect') });
      } finally {
        if (!cancelled) router.replace(returnPath);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envConfig, router, setSettings, _]);

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <span className='loading loading-infinity loading-xl w-20' />
    </div>
  );
}
