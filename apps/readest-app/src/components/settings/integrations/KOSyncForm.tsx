import clsx from 'clsx';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { md5 } from 'js-md5';
import { type as osType } from '@tauri-apps/plugin-os';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { KOSyncChecksumMethod, KOSyncStrategy } from '@/types/settings';
import { debounce } from '@/utils/debounce';
import { getOSPlatform } from '@/utils/misc';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, SettingsSelect } from '../primitives';

interface KOSyncFormProps {
  onBack: () => void;
}

const KOSyncForm: React.FC<KOSyncFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig, appService } = useEnv();

  const [url, setUrl] = useState(settings.kosync.serverUrl || '');
  const [username, setUsername] = useState(settings.kosync.username || '');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [osName, setOsName] = useState('');

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
    setDeviceName(settings.kosync.deviceName || defaultName);
  }, [settings.kosync.deviceName, osName]);

  const isConfigured = useMemo(() => !!settings.kosync.userkey, [settings.kosync.userkey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveDeviceName = useCallback(
    debounce((newDeviceName: string) => {
      const newSettings = {
        ...settings,
        kosync: { ...settings.kosync, deviceName: newDeviceName },
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

  const handleConnect = async () => {
    setIsConnecting(true);
    const config = {
      ...settings.kosync,
      serverUrl: url,
      username,
      userkey: md5(password),
      password,
      deviceName,
      enabled: true,
    };
    const client = new KOSyncClient(config);
    const result = await client.connect(username, password);

    if (result.success) {
      const newSettings = { ...settings, kosync: config };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
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
    const kosync = { ...settings.kosync, userkey: '', enabled: false };
    const newSettings = { ...settings, kosync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setUsername('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected'), type: 'info' });
  };

  const handleToggleEnabled = async () => {
    const kosync = { ...settings.kosync, enabled: !settings.kosync.enabled };
    const newSettings = { ...settings, kosync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kosync = { ...settings.kosync, strategy: e.target.value as KOSyncStrategy };
    const newSettings = { ...settings, kosync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleChecksumMethodChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kosync = {
      ...settings.kosync,
      checksumMethod: e.target.value as KOSyncChecksumMethod,
    };
    const newSettings = { ...settings, kosync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const description: string = isConfigured
    ? _('Sync as {{userDisplayName}}', { userDisplayName: settings.kosync.username })
    : _('Connect to your KOReader Sync server.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('KOReader Sync')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              {/* Each row uses min-h-14 + items-center so toggle/select/input
                  rows render at a uniform height regardless of the embedded
                  control's intrinsic size. Selects and inputs are end-aligned
                  to match modern preferences-panel convention. */}
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Sync Server Connected')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={settings.kosync.enabled}
                  onChange={handleToggleEnabled}
                />
              </label>
              {/* SettingsSelect handles the chromeless treatment, the
                  custom MdArrowDropDown icon at the trailing edge (so the
                  chevron lands at the same X as the toggle's right edge),
                  and the focus/hover signal — see DESIGN.md §5. */}
              <div className='flex min-h-14 items-center justify-between gap-3 px-4'>
                <SettingLabel>{_('Sync Strategy')}</SettingLabel>
                <SettingsSelect
                  value={settings.kosync.strategy}
                  onChange={handleStrategyChange}
                  ariaLabel={_('Sync Strategy')}
                  options={[
                    { value: 'prompt', label: _('Ask on conflict') },
                    { value: 'silent', label: _('Always use latest') },
                    { value: 'send', label: _('Send changes only') },
                    { value: 'receive', label: _('Receive changes only') },
                  ]}
                />
              </div>
              <div className='flex min-h-14 items-center justify-between gap-3 px-4'>
                <SettingLabel>{_('Checksum Method')}</SettingLabel>
                <SettingsSelect
                  value={settings.kosync.checksumMethod}
                  onChange={handleChecksumMethodChange}
                  ariaLabel={_('Checksum Method')}
                  options={[{ value: 'binary', label: _('File Content') }]}
                />
              </div>
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
              <SectionTitle as='label' htmlFor='kosync-server-url' className='block'>
                {_('Server URL')}
              </SectionTitle>
              <input
                id='kosync-server-url'
                type='text'
                placeholder='https://koreader.sync.server'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='kosync-username' className='block'>
                {_('Username')}
              </SectionTitle>
              <input
                id='kosync-username'
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
              <SectionTitle as='label' htmlFor='kosync-password' className='block'>
                {_('Password')}
              </SectionTitle>
              <input
                id='kosync-password'
                type='password'
                placeholder={_('Your Password')}
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete='current-password'
              />
            </div>

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

export default KOSyncForm;
