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
import Dialog from '@/components/Dialog';

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Option[];
  disabled?: boolean;
  className?: string;
};

const StyledSelect: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  className,
  disabled = false,
}) => {
  return (
    <select
      value={value}
      onChange={onChange}
      className={clsx(
        'select select-bordered h-12 w-full text-sm focus:outline-none focus:ring-0',
        className,
      )}
      disabled={disabled}
    >
      {options.map(({ value, label, disabled = false }) => (
        <option key={value} value={value} disabled={disabled}>
          {label}
        </option>
      ))}
    </select>
  );
};

export const setKOSyncSettingsWindowVisible = (visible: boolean) => {
  const dialog = document.getElementById('kosync_settings_window');
  if (dialog) {
    const event = new CustomEvent('setKOSyncSettingsVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const KOSyncSettingsWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig, appService } = useEnv();

  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState(settings.kosync.serverUrl || '');
  const [username, setUsername] = useState(settings.kosync.username || '');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [osName, setOsName] = useState('');

  // Get the OS name once
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
      const newSettings = { ...settings, koreaderSyncDeviceName: newDeviceName };
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

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        setUrl(settings.kosync.serverUrl || '');
        setUsername(settings.kosync.username || '');
        setPassword('');
        setConnectionStatus('');
      }
    };
    const el = document.getElementById('kosync_settings_window');
    el?.addEventListener('setKOSyncSettingsVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener('setKOSyncSettingsVisibility', handleCustomEvent as EventListener);
    };
  }, [settings.kosync.serverUrl, settings.kosync.username]);

  const handleConnect = async () => {
    setIsConnecting(true);

    const config = {
      ...settings.kosync,
      serverUrl: url,
      username,
      userkey: md5(password),
      deviceName,
      enabled: true,
    };
    const client = new KOSyncClient(config);
    const result = await client.connect(username, password);

    if (result.success) {
      const newSettings = {
        ...settings,
        kosync: config,
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    } else {
      setConnectionStatus('');
      eventDispatcher.dispatch('toast', {
        message: `${_('Failed to connect')}: ${_(result.message || 'Connection error')}`,
        type: 'error',
      });
    }
    setIsConnecting(false);
    setPassword('');
  };

  const handleDisconnect = async () => {
    const kosync = {
      ...settings.kosync,
      userkey: '',
      enabled: false,
    };
    const newSettings = { ...settings, kosync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setUsername('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected'), type: 'info' });
  };

  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kosync = {
      ...settings.kosync,
      strategy: e.target.value as KOSyncStrategy,
    };

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

  return (
    <Dialog
      id='kosync_settings_window'
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('KOReader Sync Settings')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
          {isConfigured ? (
            <>
              <div className='text-center'>
                <p className='text-base-content/80 text-sm'>
                  {_('Sync as {{userDisplayName}}', {
                    userDisplayName: settings.kosync.username,
                  })}
                </p>
              </div>
              <div className='flex h-14 items-center justify-between'>
                <span className='text-base-content/80'>{_('Sync Server Connected')}</span>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={settings.kosync.enabled}
                  onChange={() => handleDisconnect()}
                />
              </div>
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Sync Strategy')}</span>
                </label>
                <StyledSelect
                  value={settings.kosync.strategy}
                  onChange={handleStrategyChange}
                  options={[
                    { value: 'prompt', label: _('Ask on conflict') },
                    { value: 'silent', label: _('Always use latest') },
                    { value: 'send', label: _('Send changes only') },
                    { value: 'receive', label: _('Receive changes only') },
                  ]}
                />
              </div>
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Checksum Method')}</span>
                </label>
                <StyledSelect
                  value={settings.kosync.checksumMethod}
                  onChange={handleChecksumMethodChange}
                  options={[
                    { value: 'binary', label: _('File Content (recommended)') },
                    { value: 'filename', label: _('File Name'), disabled: true },
                  ]}
                />
              </div>
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Device Name')}</span>
                </label>
                <input
                  type='text'
                  placeholder={osName ? `Readest (${osName})` : 'Readest'}
                  className='input input-bordered h-12 w-full focus:outline-none focus:ring-0'
                  value={deviceName}
                  onChange={handleDeviceNameChange}
                />
              </div>
            </>
          ) : (
            <>
              <p className='text-base-content/70 text-center text-sm'>
                {_('Connect to your KOReader Sync server.')}
              </p>
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Server URL')}</span>
                </label>
                <input
                  type='text'
                  placeholder='https://koreader.sync.server'
                  className='input input-bordered h-12 w-full focus:outline-none focus:ring-0'
                  spellCheck='false'
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <form className='flex flex-col gap-4'>
                <div className='form-control w-full'>
                  <label className='label py-1'>
                    <span className='label-text font-medium'>{_('Username')}</span>
                  </label>
                  <input
                    type='text'
                    placeholder={_('Your Username')}
                    className='input input-bordered h-12 w-full focus:outline-none focus:ring-0'
                    spellCheck='false'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete='username'
                  />
                </div>
                <div className='form-control w-full'>
                  <label className='label py-1'>
                    <span className='label-text font-medium'>{_('Password')}</span>
                  </label>
                  <input
                    type='password'
                    placeholder={_('Your Password')}
                    className='input input-bordered h-12 w-full focus:outline-none focus:ring-0'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete='current-password'
                  />
                </div>
              </form>
              <button
                className='btn btn-primary mt-2 h-12 min-h-12 w-full'
                onClick={handleConnect}
                disabled={isConnecting || !url || !username || !password}
              >
                {isConnecting ? <span className='loading loading-spinner'></span> : _('Connect')}
              </button>
              {connectionStatus && (
                <div className='text-error h-4 text-center text-sm'>{connectionStatus}</div>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};
