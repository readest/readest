import clsx from 'clsx';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToHardcoverConnect } from '@/utils/nav';
import { isHardcoverConnected } from '@/services/hardcover';
import { revokeHardcoverTokens } from '@/services/hardcover/hardcoverOAuth';
import SubPageHeader from '../SubPageHeader';
import { Toggle } from '@/components/primitives/toggle';
import { SettingLabel } from '../primitives';

interface HardcoverFormProps {
  onBack: () => void;
}

const HardcoverForm: React.FC<HardcoverFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const isConfigured = isHardcoverConnected(settings.hardcover);

  const handleDisconnect = async () => {
    const oauth = settings.hardcover?.oauth;
    const newSettings = {
      ...settings,
      hardcover: { enabled: false, accessToken: '', lastSyncedAt: 0 },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    // Not awaited: signing out must not wait on the network.
    if (oauth) void revokeHardcoverTokens(oauth);
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

  const handleToggleAutoSync = async () => {
    const newSettings = {
      ...settings,
      hardcover: { ...settings.hardcover, autoSync: !(settings.hardcover?.autoSync === true) },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const lastSyncedAt = settings.hardcover?.lastSyncedAt ?? 0;
  const lastSyncedLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : _('Never');

  const description: string = isConfigured
    ? _('Connected to Hardcover. Last synced {{time}}.', { time: lastSyncedLabel })
    : _('Connect your Hardcover account to sync reading progress and notes.');

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
                <Toggle
                  checked={settings.hardcover?.enabled ?? false}
                  onChange={handleToggleEnabled}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Auto Sync')}</SettingLabel>
                <Toggle
                  checked={settings.hardcover?.autoSync === true}
                  onChange={handleToggleAutoSync}
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
                'focus-visible:ring-error/40 focus-visible:outline-hidden focus-visible:ring-2',
              )}
            >
              {_('Disconnect')}
            </button>
          </div>
        </div>
      ) : (
        <div className='flex justify-center'>
          <button
            type='button'
            onClick={() => navigateToHardcoverConnect(router)}
            className={clsx(
              'btn btn-primary',
              'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
              'focus-visible:ring-primary/40 focus-visible:outline-hidden focus-visible:ring-2',
            )}
          >
            {_('Connect')}
          </button>
        </div>
      )}
    </div>
  );
};

export default HardcoverForm;
