import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import {
  runGoogleDriveConnect,
  runGoogleDriveDisconnect,
} from '@/services/sync/providers/gdrive/googleDriveConnect';
import SubPageHeader from '../SubPageHeader';
import { Tips } from '../primitives';
import FileSyncForm from './FileSyncForm';

interface GoogleDriveFormProps {
  onBack: () => void;
}

/**
 * Google Drive integration form. Mirrors {@link WebDAVForm}'s two-mode layout,
 * but the connect panel is an OAuth sign-in (open consent in the browser, store
 * the token in the OS keychain) rather than a URL/credentials form. Once
 * connected it renders the shared {@link FileSyncForm} sync controls.
 *
 * Desktop only for now — the Integrations row is hidden off-desktop until the
 * mobile OAuth runners land.
 */
const GoogleDriveForm: React.FC<GoogleDriveFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.googleDrive;
  const isConnected = !!stored?.enabled;
  const [isConnecting, setIsConnecting] = useState(false);

  const persistGDrive = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, googleDrive: { ...latest.googleDrive, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { accountLabel } = await runGoogleDriveConnect();
      // Only mark connected after the token has persisted (runGoogleDriveConnect
      // throws if the keychain save fails), so a "Connected" row never points at
      // a token that won't survive a restart.
      await persistGDrive({ enabled: true, accountLabel: accountLabel ?? undefined });
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
    } catch (e) {
      console.warn('[gdrive] connect failed', e);
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to connect') });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await runGoogleDriveDisconnect();
    await persistGDrive({ enabled: false, accountLabel: undefined });
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  const description: string = isConnected
    ? stored.accountLabel
      ? _('Connected as {{account}}', { account: stored.accountLabel })
      : _('Connected to Google Drive')
    : _('Sync your library, reading progress, and highlights with your Google Drive.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Google Drive')}
        description={description}
        onBack={onBack}
      />

      {isConnected ? (
        <div className='space-y-5'>
          <FileSyncForm kind='gdrive' stored={stored} persist={persistGDrive} />

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleDisconnect}
              className={clsx(
                'eink-bordered',
                'h-10 rounded-lg px-4 text-sm font-medium',
                'text-error hover:bg-error/10',
                'transition-colors duration-150',
                'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
              )}
            >
              {_('Disconnect')}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-5'>
          <Tips>
            <li>{_('Sign-in opens in your browser.')}</li>
            <li>{_('Readest only accesses the files it creates in your Drive.')}</li>
          </Tips>

          <div className='flex justify-end pt-1'>
            <button
              type='button'
              onClick={handleConnect}
              disabled={isConnecting}
              className={clsx(
                'btn btn-primary',
                'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                isConnecting && 'opacity-60',
              )}
            >
              {isConnecting ? (
                <>
                  <span className='loading loading-spinner loading-sm' />
                  {_('Waiting for sign-in…')}
                </>
              ) : (
                _('Connect Google Drive')
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoogleDriveForm;
