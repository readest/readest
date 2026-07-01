'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { WebDriveAuth } from '@/services/sync/providers/gdrive/WebDriveAuth';
import type { FetchFn } from '@/services/sync/providers/gdrive/GoogleDriveProvider';
import { saveWebDriveToken } from '@/services/sync/providers/gdrive/auth/webTokenStore';
import {
  consumeOAuthState,
  consumeReturnPath,
  parseImplicitRedirect,
  tokenSetFromRedirect,
} from '@/services/sync/providers/gdrive/auth/webRedirectFlow';
import { withActiveCloudProvider } from '@/components/settings/integrations/cloudSync';

/**
 * OAuth return route for the web Google Drive connect (full-page implicit flow).
 * Google redirects here with the access token in the URL fragment; we validate
 * the CSRF state, store the token, mark Drive the active cloud provider, then
 * route back to where the user started. See `gdrive/auth/webRedirectFlow.ts`.
 */
export default function GDriveCallback() {
  const router = useRouter();
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const setSettings = useSettingsStore((s) => s.setSettings);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const returnPath = consumeReturnPath();
      const expectedState = consumeOAuthState();
      const result = parseImplicitRedirect(window.location.hash);
      try {
        if (result.error) throw new Error(result.error);
        if (!expectedState || result.state !== expectedState) throw new Error('state mismatch');
        const tokens = tokenSetFromRedirect(result);
        if (!tokens) throw new Error('no access token returned');

        saveWebDriveToken(tokens);

        const accountLabel = await new WebDriveAuth(
          globalThis.fetch.bind(globalThis) as unknown as FetchFn,
        )
          .accountLabel()
          .catch(() => null);

        // Mark Drive the single active cloud provider (turns WebDAV off) and
        // stamp the account label. Load + save through appService so this works
        // even though the settings store may not be hydrated on this route.
        const appService = await envConfig.getAppService();
        const settings = await appService.loadSettings();
        const base = withActiveCloudProvider(settings, 'gdrive');
        const next = {
          ...base,
          googleDrive: {
            ...base.googleDrive,
            accountLabel: accountLabel ?? base.googleDrive?.accountLabel,
          },
        };
        await appService.saveSettings(next);
        setSettings(next);
        eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
      } catch (e) {
        console.warn('[gdrive] web callback failed', e);
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
