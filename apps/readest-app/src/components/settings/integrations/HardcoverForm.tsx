import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { HardcoverClient, HardcoverSyncMapStore } from '@/services/hardcover';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel } from '../primitives';

interface HardcoverFormProps {
  onBack: () => void;
}

const HardcoverForm: React.FC<HardcoverFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [accessToken, setAccessToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const isConfigured = !!settings.hardcover?.accessToken;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const appService = await envConfig.getAppService();
      const mapStore = new HardcoverSyncMapStore(appService);
      const client = new HardcoverClient({ accessToken }, mapStore);
      const { valid, isNetworkError } = await client.validateToken();
      if (valid) {
        const newSettings = {
          ...settings,
          hardcover: {
            enabled: true,
            accessToken,
            lastSyncedAt: settings.hardcover?.lastSyncedAt ?? 0,
          },
        };
        setSettings(newSettings);
        await saveSettings(envConfig, newSettings);
      } else if (isNetworkError) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to connect to Hardcover. Please check your network connection.'),
          type: 'error',
        });
      } else {
        eventDispatcher.dispatch('toast', {
          message: _('Invalid Hardcover API token'),
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
      hardcover: { enabled: false, accessToken: '', lastSyncedAt: 0 },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Hardcover'), type: 'info' });
  };

  const handleToggleEnabled = async () => {
    const newSettings = {
      ...settings,
      hardcover: { ...settings.hardcover, enabled: !settings.hardcover?.enabled },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const lastSyncedAt = settings.hardcover?.lastSyncedAt ?? 0;
  const lastSyncedLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : _('Never');

  const description: string = isConfigured
    ? _('Connected to Hardcover. Last synced {{time}}.', { time: lastSyncedLabel })
    : _('Connect your Hardcover account to sync reading progress and notes.') +
      ' ' +
      _('Get your API token from hardcover.app → Settings → API.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Hardcover')}
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
                  checked={settings.hardcover?.enabled ?? false}
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
            <SectionTitle as='label' htmlFor='hardcover-token' className='block'>
              {_('API Token')}
            </SectionTitle>
            <input
              id='hardcover-token'
              type='password'
              placeholder={_('Paste your Hardcover API token')}
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

export default HardcoverForm;
