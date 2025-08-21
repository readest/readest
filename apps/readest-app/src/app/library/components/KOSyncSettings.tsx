import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { md5 } from 'js-md5';
import clsx from 'clsx';
import { type as osType } from '@tauri-apps/plugin-os';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { KoreaderSyncChecksumMethod, KoreaderSyncStrategy } from '@/types/settings';
import { v4 as uuidv4 } from 'uuid';
import { debounce } from '@/utils/debounce';
import { getOSPlatform } from '@/utils/misc';

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
  const [url, setUrl] = useState(settings.koreaderSyncServerUrl || '');
  const [username, setUsername] = useState(settings.koreaderSyncUsername || '');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [osName, setOsName] = useState('');

  const [toleranceSliderValue, setToleranceSliderValue] = useState(() => {
    const tolerance = settings.koreaderSyncPercentageTolerance;
    return tolerance && tolerance > 0 ? Math.round(-Math.log10(tolerance)) : 4;
  });

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
    setDeviceName(settings.koreaderSyncDeviceName || defaultName);
  }, [settings.koreaderSyncDeviceName, osName]);

  const isConfigured = useMemo(
    () => !!settings.koreaderSyncUserkey,
    [settings.koreaderSyncUserkey],
  );

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
        setUrl(settings.koreaderSyncServerUrl || '');
        setUsername(settings.koreaderSyncUsername || '');
        setPassword('');
        setConnectionStatus('');
        // Sync the slider with the current settings when opening
        const tolerance = settings.koreaderSyncPercentageTolerance;
        setToleranceSliderValue(
          tolerance && tolerance > 0 ? Math.round(-Math.log10(tolerance)) : 4,
        );
      }
    };
    const el = document.getElementById('kosync_settings_window');
    el?.addEventListener('setKOSyncSettingsVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener('setKOSyncSettingsVisibility', handleCustomEvent as EventListener);
    };
  }, [
    settings.koreaderSyncServerUrl,
    settings.koreaderSyncUsername,
    settings.koreaderSyncPercentageTolerance,
  ]);

  const handleConnect = async () => {
    setIsConnecting(true);

    let deviceId = settings.koreaderSyncDeviceId;
    if (!deviceId) {
      deviceId = uuidv4().replace(/-/g, '').toUpperCase();
    }

    const client = new KOSyncClient(
      url,
      username,
      md5(password),
      settings.koreaderSyncChecksumMethod,
      deviceId,
      deviceName,
    );
    const result = await client.connect(username, password);

    if (result.success) {
      const newSettings = {
        ...settings,
        koreaderSyncServerUrl: url,
        koreaderSyncUsername: username,
        koreaderSyncUserkey: md5(password),
        koreaderSyncDeviceId: deviceId,
        koreaderSyncDeviceName: deviceName,
        koreaderSyncStrategy:
          settings.koreaderSyncStrategy === 'disabled' ? 'prompt' : settings.koreaderSyncStrategy,
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
    const newSettings = {
      ...settings,
      koreaderSyncStrategy: 'disabled' as KoreaderSyncStrategy,
      koreaderSyncUserkey: '',
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setUsername('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected'), type: 'info' });
  };

  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStrategy = e.target.value as KoreaderSyncStrategy;
    const newSettings = { ...settings, koreaderSyncStrategy: newStrategy };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleChecksumMethodChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMethod = e.target.value as KoreaderSyncChecksumMethod;
    const newSettings = { ...settings, koreaderSyncChecksumMethod: newMethod };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleToleranceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const sliderValue = parseInt(e.target.value, 10);
    setToleranceSliderValue(sliderValue);
    // Calculate the actual tolerance from the slider value (e.g., 4 -> 0.0001)
    const newTolerance = Math.pow(10, -sliderValue);

    const newSettings = { ...settings, koreaderSyncPercentageTolerance: newTolerance };
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
      <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
        {isConfigured ? (
          <>
            <div className='text-center'>
              <p className='text-base-content/80 text-sm'>
                {_('Sync as {{userDisplayName}}', {
                  userDisplayName: settings.koreaderSyncUsername,
                })}
              </p>
            </div>
            <div className='flex h-14 items-center justify-between'>
              <span className='text-base-content/80'>
                {_('Sync Server Connected', { username: settings.koreaderSyncUsername })}
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={settings.koreaderSyncStrategy !== 'disabled'}
                onChange={() => handleDisconnect()}
              />
            </div>
            <div className='form-control w-full'>
              <label className='label py-1'>
                <span className='label-text font-medium'>{_('Sync Strategy')}</span>
              </label>
              <StyledSelect
                value={settings.koreaderSyncStrategy}
                onChange={handleStrategyChange}
                options={[
                  { value: 'prompt', label: _('Ask on conflict') },
                  { value: 'silent', label: _('Always use latest') },
                  { value: 'send', label: _('Send changes only') },
                  { value: 'receive', label: _('Receive changes only') },
                  { value: 'disable', label: _('Disabled') },
                ]}
              />
            </div>
            <div className='form-control w-full'>
              <label className='label py-1'>
                <span className='label-text font-medium'>{_('Checksum Method')}</span>
              </label>
              <StyledSelect
                value={settings.koreaderSyncChecksumMethod}
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
            {/* Hidden to avoid confusing users with technical details */}
            {false && (
              <div className='form-control w-full'>
                <label className='label py-1'>
                  <span className='label-text font-medium'>{_('Sync Tolerance')}</span>
                </label>
                <input
                  type='range'
                  min='0'
                  max='15'
                  value={toleranceSliderValue}
                  onChange={handleToleranceChange}
                  className='range range-primary'
                />
                <div className='text-base-content/70 mt-2 text-center text-xs'>
                  {_('Precision: {{precision}} digits after the decimal', {
                    precision: toleranceSliderValue,
                  })}
                </div>
              </div>
            )}
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
    </Dialog>
  );
};
