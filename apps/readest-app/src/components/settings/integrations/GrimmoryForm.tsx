import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { GrimmoryClient, normalizeGrimmoryServerUrl } from '@/services/grimmory/GrimmoryClient';
import type { GrimmorySettings, KOSyncStrategy } from '@/types/settings';
import { debounce } from '@/utils/debounce';
import {
  formatCustomHeadersInput,
  hasCustomHeaders,
  parseCustomHeadersInput,
} from '@/utils/customHeaders';
import { allowsSelfSignedCert } from '@/utils/tls';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
  Tips,
} from '../primitives';
import SelfSignedCertSwitch from './SelfSignedCertSwitch';

interface GrimmoryFormProps {
  onBack: () => void;
}

type GrimmoryToggleField = 'syncProgress' | 'syncNotes' | 'syncStats' | 'syncBookStates';

const GrimmoryForm: React.FC<GrimmoryFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();
  const grimmory = settings.grimmory;

  const [url, setUrl] = useState(grimmory.serverUrl || '');
  const [username, setUsername] = useState(grimmory.username || '');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [customHeadersInput, setCustomHeadersInput] = useState(
    formatCustomHeadersInput(grimmory.customHeaders),
  );
  const [headerError, setHeaderError] = useState('');
  const [allowSelfSignedCert, setAllowSelfSignedCert] = useState(allowsSelfSignedCert(grimmory));

  const isConfigured = !!grimmory.password;

  const save = async (patch: Partial<GrimmorySettings>) => {
    const { settings } = useSettingsStore.getState();
    const newSettings = { ...settings, grimmory: { ...settings.grimmory, ...patch } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const [saveCustomHeaders] = useState(() =>
    debounce((input: string) => {
      const parsed = parseCustomHeadersInput(input);
      if (parsed.error) {
        setHeaderError(parsed.error);
        return;
      }
      setHeaderError('');
      void save({ customHeaders: hasCustomHeaders(parsed.headers) ? parsed.headers : undefined });
    }, 500),
  );

  const handleConnect = async () => {
    const parsedHeaders = parseCustomHeadersInput(customHeadersInput);
    if (parsedHeaders.error) {
      setHeaderError(parsedHeaders.error);
      return;
    }
    setHeaderError('');
    setIsConnecting(true);
    const config = {
      serverUrl: normalizeGrimmoryServerUrl(url),
      username: username.trim(),
      password,
      customHeaders: hasCustomHeaders(parsedHeaders.headers) ? parsedHeaders.headers : undefined,
      allowSelfSignedCert,
    };
    const fail = (message: string) =>
      eventDispatcher.dispatch('toast', {
        message: `${_('Failed to connect')}: ${message}`,
        type: 'error',
      });
    try {
      const result = await new GrimmoryClient(config).connect();
      if (result.success) {
        await save({ ...config, enabled: true });
      } else {
        fail(_(result.message || 'Connection error'));
      }
    } catch (error) {
      // Connected, but the settings could not be saved.
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      setIsConnecting(false);
      setPassword('');
    }
  };

  const handleDisconnect = async () => {
    await save({ password: '', enabled: false });
    setUsername('');
    setHeaderError('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected'), type: 'info' });
  };

  const toggle = (field: GrimmoryToggleField | 'enabled') => () =>
    save({ [field]: !grimmory[field] });

  const customHeadersField = (onChange: (value: string) => void) => (
    <div className='space-y-1.5'>
      <SectionTitle as='label' htmlFor='grimmory-custom-headers' className='block'>
        {_('Custom Headers (optional)')}
      </SectionTitle>
      <textarea
        id='grimmory-custom-headers'
        value={customHeadersInput}
        onChange={(e) => {
          setCustomHeadersInput(e.target.value);
          onChange(e.target.value);
        }}
        placeholder={formatCustomHeadersInput({
          'CF-Access-Client-Id': 'your-client-id',
          'CF-Access-Client-Secret': 'your-client-secret',
        })}
        className='textarea eink-bordered w-full font-mono text-sm placeholder:text-xs'
        rows={4}
        spellCheck={false}
      />
      <span className='text-xs text-base-content/60'>
        {_('Add one header per line using "Header-Name: value".')}
      </span>
      {headerError && (
        <div className='pt-0.5'>
          <span className='text-xs text-error'>{headerError}</span>
        </div>
      )}
    </div>
  );

  const description = isConfigured
    ? _('Sync as {{userDisplayName}}', { userDisplayName: grimmory.username })
    : _('Connect to your Grimmory server.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Grimmory')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <BoxedList>
            <SettingsSwitchRow
              label={_('Sync Server Connected')}
              checked={grimmory.enabled}
              onChange={toggle('enabled')}
            />
            <SettingsRow label={_('Sync Strategy')}>
              <SettingsSelect
                value={grimmory.strategy}
                onChange={(e) => save({ strategy: e.target.value as KOSyncStrategy })}
                ariaLabel={_('Sync Strategy')}
                options={[
                  { value: 'prompt', label: _('Ask on conflict') },
                  { value: 'silent', label: _('Always use latest') },
                  { value: 'send', label: _('Send only') },
                  { value: 'receive', label: _('Receive only') },
                ]}
              />
            </SettingsRow>
            <SettingsSwitchRow
              label={_('Sync Reading Progress')}
              checked={grimmory.syncProgress}
              onChange={toggle('syncProgress')}
            />
            <SettingsSwitchRow
              label={_('Sync Highlights and Bookmarks')}
              checked={grimmory.syncNotes}
              onChange={toggle('syncNotes')}
            />
            <SettingsSwitchRow
              label={_('Sync Reading Statistics')}
              checked={grimmory.syncStats}
              onChange={toggle('syncStats')}
            />
            <SettingsSwitchRow
              label={_('Sync Reading Status')}
              checked={grimmory.syncBookStates}
              onChange={toggle('syncBookStates')}
            />
          </BoxedList>

          <SelfSignedCertSwitch
            checked={allowsSelfSignedCert(grimmory)}
            onChange={() => save({ allowSelfSignedCert: !allowsSelfSignedCert(grimmory) })}
          />

          {customHeadersField(saveCustomHeaders)}

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
        <div className='space-y-5'>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='grimmory-server-url' className='block'>
                {_('Server URL')}
              </SectionTitle>
              <input
                id='grimmory-server-url'
                type='text'
                placeholder='https://books.example.com'
                className='input eink-bordered settings-content h-11 w-full focus:outline-hidden'
                spellCheck='false'
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <SelfSignedCertSwitch
              checked={allowSelfSignedCert}
              onChange={() => setAllowSelfSignedCert(!allowSelfSignedCert)}
            />

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='grimmory-username' className='block'>
                {_('Username')}
              </SectionTitle>
              <input
                id='grimmory-username'
                type='text'
                placeholder={_('Your Username')}
                className='input eink-bordered settings-content h-11 w-full focus:outline-hidden'
                spellCheck='false'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete='username'
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='grimmory-password' className='block'>
                {_('Password')}
              </SectionTitle>
              <input
                id='grimmory-password'
                type='password'
                placeholder={_('Your Password')}
                className='input eink-bordered settings-content h-11 w-full focus:outline-hidden'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete='current-password'
              />
            </div>

            {customHeadersField(() => setHeaderError(''))}

            <Tips>
              <li>{_('Sign in with your Grimmory account.')}</li>
              <li>
                {_(
                  'Books are matched by file: a book syncs when the same file is in your Grimmory library.',
                )}
              </li>
            </Tips>

            <div className='flex justify-end pt-1'>
              <button
                type='submit'
                disabled={isConnecting || !url || !username || !password}
                className={clsx(
                  'btn btn-contrast',
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
        </div>
      )}
    </div>
  );
};

export default GrimmoryForm;
