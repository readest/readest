import React, { useState, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { ReadwiseClient } from '@/services/readwise';
import Dialog from '@/components/Dialog';

export const setReadwiseSettingsWindowVisible = (visible: boolean) => {
  const dialog = document.getElementById('readwise_settings_window');
  if (dialog) {
    const event = new CustomEvent('setReadwiseSettingsVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const ReadwiseSettingsWindow: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [isOpen, setIsOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const isConfigured = !!settings.readwise?.accessToken;

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        setAccessToken('');
      }
    };
    const el = document.getElementById('readwise_settings_window');
    el?.addEventListener('setReadwiseSettingsVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener('setReadwiseSettingsVisibility', handleCustomEvent as EventListener);
    };
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const client = new ReadwiseClient({ enabled: true, accessToken, lastSyncedAt: 0 });
      const { valid, isNetworkError } = await client.validateToken();
      if (valid) {
        const newSettings = {
          ...settings,
          readwise: {
            enabled: true,
            accessToken,
            lastSyncedAt: settings.readwise?.lastSyncedAt ?? 0,
          },
        };
        setSettings(newSettings);
        await saveSettings(envConfig, newSettings);
      } else if (isNetworkError) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to connect to Readwise. Please check your network connection.'),
          type: 'error',
        });
      } else {
        eventDispatcher.dispatch('toast', {
          message: _('Invalid Readwise access token'),
          type: 'error',
        });
      }
    } finally {
      setIsConnecting(false);
      setAccessToken('');
    }
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      readwise: { enabled: false, accessToken: '', lastSyncedAt: 0 },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Readwise'), type: 'info' });
  };

  const handleToggleEnabled = async () => {
    const newSettings = {
      ...settings,
      readwise: { ...settings.readwise, enabled: !settings.readwise?.enabled },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const lastSyncedAt = settings.readwise?.lastSyncedAt ?? 0;
  const lastSyncedLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : _('Never');

  return (
    <Dialog
      id='readwise_settings_window'
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Readwise Settings')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
          {isConfigured ? (
            <>
              <div className='text-center'>
                <p className='text-base-content/80 text-sm'>{_('Connected to Readwise')}</p>
                <p className='text-base-content/60 mt-1 text-xs'>
                  {_('Last synced: {{time}}', { time: lastSyncedLabel })}
                </p>
              </div>
              <div className='flex h-14 items-center justify-between'>
                <span className='text-base-content/80'>{_('Sync Enabled')}</span>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={settings.readwise?.enabled ?? false}
                  onChange={handleToggleEnabled}
                />
              </div>
              <button className='btn btn-outline btn-sm mt-2' onClick={handleDisconnect}>
                {_('Disconnect')}
              </button>
            </>
          ) : (
            <>
              <p className='text-base-content/70 text-center text-sm'>
                {_('Connect your Readwise account to sync highlights.')}
              </p>
              <p className='text-base-content/60 text-center text-xs'>
                {_('Get your access token at')}{' '}
                <a
                  href='https://readwise.io/access_token'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='link link-primary'
                >
                  readwise.io/access_token
                </a>
              </p>
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Access Token')}</span>
                </label>
                <input
                  type='password'
                  placeholder={_('Paste your Readwise access token')}
                  className='input input-bordered h-12 w-full focus:outline-none focus:ring-0'
                  spellCheck='false'
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </div>
              <button
                className='btn btn-primary mt-2 h-12 min-h-12 w-full'
                onClick={handleConnect}
                disabled={isConnecting || !accessToken}
              >
                {isConnecting ? <span className='loading loading-spinner'></span> : _('Connect')}
              </button>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};
