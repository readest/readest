import clsx from 'clsx';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { md5 } from 'js-md5';
import { type as osType } from '@tauri-apps/plugin-os';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { BookOrbitClient } from '@/services/bookorbit/BookOrbitClient';
import { KOSyncStrategy } from '@/types/settings';
import { debounce } from '@/utils/debounce';
import { getOSPlatform } from '@/utils/misc';
import {
  formatCustomHeadersInput,
  hasCustomHeaders,
  parseCustomHeadersInput,
} from '@/utils/customHeaders';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, SettingsSelect, SettingsSwitchRow, Tips } from '../primitives';
import { Toggle } from '@/components/primitives/toggle';

interface BookOrbitFormProps {
  onBack: () => void;
}

type BookOrbitToggleField = 'syncProgress' | 'syncNotes' | 'syncStats' | 'syncBookStates';

const BookOrbitForm: React.FC<BookOrbitFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig, appService } = useEnv();

  const [url, setUrl] = useState(settings.bookorbit.serverUrl || '');
  const [username, setUsername] = useState(settings.bookorbit.username || '');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [osName, setOsName] = useState('');
  const [customHeadersInput, setCustomHeadersInput] = useState(
    formatCustomHeadersInput(settings.bookorbit.customHeaders),
  );
  const [headerError, setHeaderError] = useState('');

  useEffect(() => {
    const formatOsName = (name: string): string => {
      if (!name) return '';
      if (name.toLowerCase() === 'macos') return 'macOS';
      if (name.toLowerCase() === 'ios') return 'iOS';
      return name.charAt(0).toUpperCase() + name.slice(1);
    };

    const getOsName = async () => {
      let name = '';
      if (appService?.appPlatform === 'tauri') {
        name = await osType();
      } else {
        const platform = getOSPlatform();
        if (platform !== 'unknown') {
          name = platform;
        }
      }
      setOsName(formatOsName(name));
    };
    getOsName();
  }, [appService]);

  useEffect(() => {
    const defaultName = osName ? `Readest (${osName})` : 'Readest';
    setDeviceName(settings.bookorbit.deviceName || defaultName);
  }, [settings.bookorbit.deviceName, osName]);

  const isConfigured = useMemo(() => !!settings.bookorbit.userkey, [settings.bookorbit.userkey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveDeviceName = useCallback(
    debounce((newDeviceName: string) => {
      const newSettings = {
        ...settings,
        bookorbit: { ...settings.bookorbit, deviceName: newDeviceName },
      };
      setSettings(newSettings);
      saveSettings(envConfig, newSettings);
    }, 500),
    [settings, setSettings, saveSettings, envConfig],
  );

  const handleDeviceNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setDeviceName(newName);
    debouncedSaveDeviceName(newName);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveCustomHeaders = useCallback(
    debounce((input: string) => {
      const parsed = parseCustomHeadersInput(input);
      if (parsed.error) {
        setHeaderError(parsed.error);
        return;
      }
      setHeaderError('');
      const bookorbit = {
        ...settings.bookorbit,
        customHeaders: hasCustomHeaders(parsed.headers) ? parsed.headers : undefined,
      };
      const newSettings = { ...settings, bookorbit };
      setSettings(newSettings);
      saveSettings(envConfig, newSettings);
    }, 500),
    [settings, setSettings, saveSettings, envConfig],
  );

  const handleCustomHeadersChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newInput = e.target.value;
    setCustomHeadersInput(newInput);
    debouncedSaveCustomHeaders(newInput);
  };

  const handleConnect = async () => {
    const parsedHeaders = parseCustomHeadersInput(customHeadersInput);
    if (parsedHeaders.error) {
      setHeaderError(parsedHeaders.error);
      return;
    }
    setHeaderError('');
    setIsConnecting(true);
    const config = {
      ...settings.bookorbit,
      serverUrl: url,
      username,
      userkey: md5(password),
      password,
      deviceName,
      customHeaders: hasCustomHeaders(parsedHeaders.headers) ? parsedHeaders.headers : undefined,
      enabled: true,
    };
    const client = new BookOrbitClient(config);
    const result = await client.connect();

    if (result.success) {
      const newSettings = { ...settings, bookorbit: config };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
      if (result.message) {
        eventDispatcher.dispatch('toast', { message: _(result.message), type: 'info' });
      }
    } else {
      eventDispatcher.dispatch('toast', {
        message: `${_('Failed to connect')}: ${_(result.message || 'Connection error')}`,
        type: 'error',
      });
    }
    setIsConnecting(false);
    setPassword('');
  };

  const handleDisconnect = async () => {
    const bookorbit = { ...settings.bookorbit, userkey: '', password: '', enabled: false };
    const newSettings = { ...settings, bookorbit };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setUsername('');
    setHeaderError('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected'), type: 'info' });
  };

  const handleToggleEnabled = async () => {
    const bookorbit = { ...settings.bookorbit, enabled: !settings.bookorbit.enabled };
    const newSettings = { ...settings, bookorbit };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleToggleField = (field: BookOrbitToggleField) => async () => {
    const bookorbit = { ...settings.bookorbit, [field]: !settings.bookorbit[field] };
    const newSettings = { ...settings, bookorbit };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const bookorbit = { ...settings.bookorbit, strategy: e.target.value as KOSyncStrategy };
    const newSettings = { ...settings, bookorbit };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const description: string = isConfigured
    ? _('Sync as {{userDisplayName}}', { userDisplayName: settings.bookorbit.username })
    : _('Connect to your BookOrbit server.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('BookOrbit')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Sync Server Connected')}</SettingLabel>
                <Toggle checked={settings.bookorbit.enabled} onChange={handleToggleEnabled} />
              </label>
              <div className='flex min-h-14 items-center justify-between gap-3 px-4'>
                <SettingLabel>{_('Sync Strategy')}</SettingLabel>
                <SettingsSelect
                  value={settings.bookorbit.strategy}
                  onChange={handleStrategyChange}
                  ariaLabel={_('Sync Strategy')}
                  options={[
                    { value: 'prompt', label: _('Ask on conflict') },
                    { value: 'silent', label: _('Always use latest') },
                    { value: 'send', label: _('Send only') },
                    { value: 'receive', label: _('Receive only') },
                  ]}
                />
              </div>
              <SettingsSwitchRow
                label={_('Sync Reading Progress')}
                checked={settings.bookorbit.syncProgress}
                onChange={handleToggleField('syncProgress')}
              />
              <SettingsSwitchRow
                label={_('Sync Highlights and Bookmarks')}
                checked={settings.bookorbit.syncNotes}
                onChange={handleToggleField('syncNotes')}
              />
              <SettingsSwitchRow
                label={_('Sync Reading Statistics')}
                checked={settings.bookorbit.syncStats}
                onChange={handleToggleField('syncStats')}
              />
              <SettingsSwitchRow
                label={_('Sync Reading Status')}
                checked={settings.bookorbit.syncBookStates}
                onChange={handleToggleField('syncBookStates')}
              />
              <div className='-me-2 flex min-h-14 items-center justify-between gap-3 px-4'>
                <SettingLabel>{_('Device Name')}</SettingLabel>
                <input
                  type='text'
                  placeholder={osName ? `Readest (${osName})` : 'Readest'}
                  className='input h-9 max-w-[60%] rounded-md !border-0 !bg-transparent !pe-3 !ps-2 text-end text-sm hover:!bg-transparent focus:!border-0 focus:!bg-transparent focus:!shadow-none focus:!outline-none focus:!ring-0'
                  value={deviceName}
                  onChange={handleDeviceNameChange}
                />
              </div>
            </div>
          </div>

          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='bookorbit-custom-headers' className='block'>
              {_('Custom Headers (optional)')}
            </SectionTitle>
            <textarea
              id='bookorbit-custom-headers'
              value={customHeadersInput}
              onChange={handleCustomHeadersChange}
              placeholder={formatCustomHeadersInput({
                'CF-Access-Client-Id': 'your-client-id',
                'CF-Access-Client-Secret': 'your-client-secret',
              })}
              className='textarea textarea-bordered eink-bordered w-full font-mono text-sm placeholder:text-xs'
              rows={4}
              spellCheck={false}
            />
            <span className='label-text-alt text-base-content/60'>
              {_('Add one header per line using "Header-Name: value".')}
            </span>
            {headerError && (
              <div className='pt-0.5'>
                <span className='label-text-alt text-error'>{headerError}</span>
              </div>
            )}
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
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='bookorbit-server-url' className='block'>
                {_('Server URL')}
              </SectionTitle>
              <input
                id='bookorbit-server-url'
                type='text'
                placeholder='https://books.example.com'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='bookorbit-username' className='block'>
                {_('Username')}
              </SectionTitle>
              <input
                id='bookorbit-username'
                type='text'
                placeholder={_('Your Username')}
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete='username'
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='bookorbit-password' className='block'>
                {_('Password')}
              </SectionTitle>
              <input
                id='bookorbit-password'
                type='password'
                placeholder={_('Your Password')}
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete='current-password'
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='bookorbit-custom-headers' className='block'>
                {_('Custom Headers (optional)')}
              </SectionTitle>
              <textarea
                id='bookorbit-custom-headers'
                value={customHeadersInput}
                onChange={(e) => {
                  setCustomHeadersInput(e.target.value);
                  setHeaderError('');
                }}
                placeholder={formatCustomHeadersInput({
                  'CF-Access-Client-Id': 'your-client-id',
                  'CF-Access-Client-Secret': 'your-client-secret',
                })}
                className='textarea textarea-bordered eink-bordered w-full font-mono text-sm placeholder:text-xs'
                rows={4}
                spellCheck={false}
              />
              <span className='label-text-alt text-base-content/60'>
                {_('Add one header per line using "Header-Name: value".')}
              </span>
              {headerError && (
                <div className='pt-0.5'>
                  <span className='label-text-alt text-error'>{headerError}</span>
                </div>
              )}
            </div>

            <Tips>
              <li>
                {_(
                  'Create KOReader credentials in BookOrbit under Settings > Integrations > KOReader, then enter them here with your server address.',
                )}
              </li>
            </Tips>

            <div className='flex justify-end pt-1'>
              <button
                type='submit'
                disabled={isConnecting || !url || !username || !password}
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
          </form>
        </div>
      )}
    </div>
  );
};

export default BookOrbitForm;
