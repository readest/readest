import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { loginPagebound } from '@/services/pagebound';
import { DEFAULT_PAGEBOUND_SETTINGS } from '@/services/constants';
import type { PageboundSettings } from '@/types/settings';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel } from '../primitives';
import { Toggle } from '@/components/primitives/toggle';

interface PageboundFormProps {
  onBack: () => void;
}

const PageboundForm: React.FC<PageboundFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const pagebound = settings.pagebound ?? DEFAULT_PAGEBOUND_SETTINGS;
  const isConfigured = !!pagebound.refreshToken;

  const save = async (next: PageboundSettings) => {
    const newSettings = { ...settings, pagebound: next };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const session = await loginPagebound(email.trim(), password);
      await save({ ...pagebound, ...session, email: email.trim(), enabled: true });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        message: _('Unable to sign in to Pagebound: {{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
        type: 'error',
      });
    } finally {
      setIsConnecting(false);
      setPassword('');
    }
  };

  const handleDisconnect = async () => {
    await save(DEFAULT_PAGEBOUND_SETTINGS);
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Pagebound'), type: 'info' });
  };

  const lastSyncedLabel = pagebound.lastSyncedAt
    ? new Date(pagebound.lastSyncedAt).toLocaleString()
    : _('Never');

  const description: string = isConfigured
    ? _('Connected to Pagebound. Last synced {{time}}.', { time: lastSyncedLabel })
    : _('Sign in with your Pagebound email and password to sync reading progress.') +
      ' ' +
      _('If you use Apple or Google sign-in, set a password in Pagebound first.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Pagebound')}
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
                  checked={pagebound.enabled}
                  onChange={() => save({ ...pagebound, enabled: !pagebound.enabled })}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Auto Sync')}</SettingLabel>
                <Toggle
                  checked={pagebound.autoSync === true}
                  onChange={() => save({ ...pagebound, autoSync: pagebound.autoSync !== true })}
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
        <form
          className='space-y-5'
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect();
          }}
        >
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='pagebound-email' className='block'>
              {_('Email address')}
            </SectionTitle>
            <input
              id='pagebound-email'
              type='email'
              autoComplete='username'
              className='input eink-bordered h-11 w-full text-sm focus:outline-hidden'
              spellCheck='false'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='pagebound-password' className='block'>
              {_('Password')}
            </SectionTitle>
            <input
              id='pagebound-password'
              type='password'
              autoComplete='current-password'
              className='input eink-bordered h-11 w-full text-sm focus:outline-hidden'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className='flex justify-end'>
            <button
              type='submit'
              disabled={isConnecting || !email.trim() || !password}
              className={clsx(
                'btn btn-primary',
                'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                'focus-visible:ring-primary/40 focus-visible:outline-hidden focus-visible:ring-2',
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
        </form>
      )}
    </div>
  );
};

export default PageboundForm;
