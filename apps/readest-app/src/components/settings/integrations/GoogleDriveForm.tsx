import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import {
  runGoogleDriveConnect,
  runGoogleDriveDisconnect,
} from '@/services/sync/providers/gdrive/googleDriveConnect';
import { hasValidWebDriveToken } from '@/services/sync/providers/gdrive/auth/webTokenStore';
import { Tips } from '../primitives';
import FileSyncForm from './FileSyncForm';
import { persistActiveCloudProvider } from './cloudSync';

const disconnectButtonClass = clsx(
  'eink-bordered',
  'h-10 rounded-lg px-4 text-sm font-medium',
  'text-error hover:bg-error/10',
  'transition-colors duration-150',
  'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
);

const primaryButtonClass = clsx(
  'btn btn-contrast',
  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
  'focus-visible:ring-base-content/40 focus-visible:outline-none focus-visible:ring-2',
);

/**
 * Google Drive provider panel, embedded in the Integrations Google Drive
 * sub-page (which owns the header). Three states:
 *
 * - **Active** (`googleDrive.enabled`): the shared {@link FileSyncForm} controls
 *   + Disconnect (which clears the keychain token — a full teardown).
 * - **Configured but inactive** (a token exists — `accountLabel` is set — but
 *   another provider is active): "Use Google Drive" re-activates it WITHOUT a
 *   fresh sign-in, so switching back is frictionless; Disconnect tears it down.
 * - **Not connected**: the OAuth Connect button.
 *
 * Activating makes Drive the single active cloud provider (turns WebDAV off).
 */
const GoogleDriveForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.googleDrive;
  const isActive = !!stored?.enabled;
  const isConfigured = !!stored?.accountLabel;
  const [isConnecting, setIsConnecting] = useState(false);

  // On web the access token is short-lived (no refresh token) and lives in
  // sessionStorage, so an active connection can sit with an expired/absent
  // token. When that happens, swap Disconnect → Reconnect and disable Sync now;
  // the user-facing "session expired" notice is a one-time toast in the reader
  // (see useFileSync), not a hint here.
  const sessionExpired = isActive && isWebAppPlatform() && !hasValidWebDriveToken();

  const persistGDrive = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, googleDrive: { ...latest.googleDrive, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  // Make Drive the active provider (turns WebDAV off), optionally stamping a
  // freshly-resolved account label.
  const activate = async (accountLabel?: string) => {
    await persistActiveCloudProvider(envConfig, 'gdrive', (s) =>
      accountLabel === undefined ? s : { ...s, googleDrive: { ...s.googleDrive, accountLabel } },
    );
  };

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { accountLabel } = await runGoogleDriveConnect();
      // Only mark connected after the token persisted (runGoogleDriveConnect
      // throws if the keychain save fails).
      await activate(accountLabel ?? undefined);
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
    } catch (e) {
      console.warn('[gdrive] connect failed', e);
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to connect') });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleActivate = async () => {
    await activate();
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleDisconnect = async () => {
    await runGoogleDriveDisconnect();
    await persistActiveCloudProvider(envConfig, null, (s) => ({
      ...s,
      googleDrive: { ...s.googleDrive, accountLabel: undefined },
    }));
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  if (isActive) {
    return (
      <div className='space-y-5'>
        <FileSyncForm
          kind='gdrive'
          stored={stored}
          persist={persistGDrive}
          syncNowDisabled={sessionExpired}
        />
        <div className='flex justify-end'>
          {sessionExpired ? (
            <button
              type='button'
              onClick={handleConnect}
              disabled={isConnecting}
              className={clsx(primaryButtonClass, isConnecting && 'opacity-60')}
            >
              {isConnecting ? (
                <>
                  <span className='loading loading-spinner loading-sm' />
                  {_('Waiting for sign-in…')}
                </>
              ) : (
                _('Reconnect')
              )}
            </button>
          ) : (
            <button type='button' onClick={handleDisconnect} className={disconnectButtonClass}>
              {_('Disconnect')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isConfigured) {
    return (
      <div className='space-y-5'>
        <div className='flex justify-end gap-2'>
          <button type='button' onClick={handleDisconnect} className={disconnectButtonClass}>
            {_('Disconnect')}
          </button>
          <button type='button' onClick={handleActivate} className={primaryButtonClass}>
            {_('Use Google Drive')}
          </button>
        </div>
        <Tips>
          <li>
            {_('Connected as {{account}}. Make {{provider}} the active cloud provider.', {
              account: stored.accountLabel,
              provider: 'Google Drive',
            })}
          </li>
        </Tips>
      </div>
    );
  }

  return (
    <div className='space-y-5'>
      <div className='flex justify-end pt-1'>
        <button
          type='button'
          onClick={handleConnect}
          disabled={isConnecting}
          className={clsx(primaryButtonClass, isConnecting && 'opacity-60')}
        >
          {isConnecting ? (
            <>
              <span className='loading loading-spinner loading-sm' />
              {_('Waiting for sign-in…')}
            </>
          ) : (
            _('Connect')
          )}
        </button>
      </div>
      <Tips>
        <li>{_('Sign-in opens in your browser.')}</li>
        <li>{_('Readest only accesses the files it creates in your Drive.')}</li>
      </Tips>
    </div>
  );
};

export default GoogleDriveForm;
