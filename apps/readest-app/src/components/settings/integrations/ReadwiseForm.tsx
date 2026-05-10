import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { ReadwiseClient } from '@/services/readwise';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel } from '../primitives';

interface ReadwiseFormProps {
  onBack: () => void;
}

const ReadwiseForm: React.FC<ReadwiseFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [accessToken, setAccessToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const isConfigured = !!settings.readwise?.accessToken;

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

  const description: React.ReactNode = isConfigured ? (
    _('Connected to Readwise. Last synced {{time}}.', { time: lastSyncedLabel })
  ) : (
    <>
      {_('Connect your Readwise account to sync highlights.')} {_('Get your access token at')}{' '}
      <a
        href='https://readwise.io/access_token'
        target='_blank'
        rel='noopener noreferrer'
        className='link link-primary'
      >
        readwise.io/access_token
      </a>
      .
    </>
  );

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Readwise')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Sync Enabled')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={settings.readwise?.enabled ?? false}
                  onChange={handleToggleEnabled}
                />
              </label>
            </div>
          </div>

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
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='readwise-token' className='block'>
              {_('Access Token')}
            </SectionTitle>
            <input
              id='readwise-token'
              type='password'
              placeholder={_('Paste your Readwise access token')}
              className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
              spellCheck='false'
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleConnect}
              disabled={isConnecting || !accessToken}
              className={clsx(
                'btn btn-primary',
                'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                isConnecting && 'opacity-60',
              )}
            >
              {isConnecting ? (
                <span className='loading loading-spinner loading-sm' />
              ) : (
                _('Connect')
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadwiseForm;
