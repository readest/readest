import clsx from 'clsx';
import React, { useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import {
  checkConnection,
  normalizeRootPath,
  WebDAVConnectResult,
} from '@/services/sync/providers/webdav/client';
import { buildWebDAVConnectSettings } from '@/services/sync/providers/webdav/connectSettings';
import { SectionTitle } from '../primitives';
import FileSyncForm from './FileSyncForm';
import WebDAVBrowsePane from './WebDAVBrowsePane';
import { withActiveCloudProvider } from './cloudSync';

/**
 * Translate a connection-probe failure into a user-facing string. Each branch is
 * a literal `_('...')` call so the i18next-scanner picks the keys up.
 */
const formatConnectError = (_: TranslationFunc, result: WebDAVConnectResult): string => {
  switch (result.code) {
    case 'SERVER_URL_REQUIRED':
      return _('Server URL is required');
    case 'AUTH_FAILED':
      return _('Authentication failed');
    case 'ROOT_NOT_FOUND':
      return _('Root directory not found');
    case 'UNEXPECTED_STATUS':
      return _('Unexpected server response (status {{status}})', { status: result.status ?? 0 });
    case 'NETWORK':
    default:
      return _('Network error');
  }
};

/**
 * WebDAV provider panel, embedded in the unified {@link CloudSyncForm} (the
 * Cloud Sync sub-page owns the header). Two states:
 *
 * - **Active** (`webdav.enabled`): the shared {@link FileSyncForm} sync controls
 *   + the {@link WebDAVBrowsePane} + a Disconnect button.
 * - **Inactive**: the URL/credentials form (pre-filled from saved settings, so a
 *   previously-configured server reconnects in one click). Connecting makes
 *   WebDAV the active provider and turns Google Drive off (cloud providers are
 *   mutually exclusive).
 */
const WebDAVForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.webdav;
  const isActive = !!stored?.enabled;

  const [url, setUrl] = useState(stored?.serverUrl || '');
  const [username, setUsername] = useState(stored?.username || '');
  const [password, setPassword] = useState(stored?.password || '');
  const [rootPath, setRootPath] = useState(stored?.rootPath || '/');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleConnect = async () => {
    if (!url || !username) return;
    setIsConnecting(true);
    const normalizedRoot = normalizeRootPath(rootPath);
    const result = await checkConnection({ serverUrl: url, username, password }, normalizedRoot);
    if (!result.success) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatConnectError(_, result)}`,
      });
      setIsConnecting(false);
      return;
    }
    const latest = useSettingsStore.getState().settings;
    // Build the WebDAV connect settings (preserves deviceId / sub-toggles), then
    // make WebDAV the single active cloud provider (turns Google Drive off).
    const connected = {
      ...latest,
      webdav: buildWebDAVConnectSettings(latest.webdav, {
        serverUrl: url,
        username,
        password,
        rootPath: normalizedRoot,
      }),
    };
    const next = withActiveCloudProvider(connected, 'webdav');
    setSettings(next);
    await saveSettings(envConfig, next);
    setIsConnecting(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleDisconnect = async () => {
    const latest = useSettingsStore.getState().settings;
    // Deactivate (keep the credentials so a later reconnect is one click).
    const next = withActiveCloudProvider(latest, null);
    setSettings(next);
    await saveSettings(envConfig, next);
    setShowPassword(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  const persistWebdav = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, webdav: { ...latest.webdav, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  if (isActive) {
    return (
      <div className='space-y-5'>
        <FileSyncForm kind='webdav' stored={stored} persist={persistWebdav} />

        <WebDAVBrowsePane settings={stored} onUpdateSettings={persistWebdav} />

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
    );
  }

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        handleConnect();
      }}
    >
      <div className='space-y-1.5'>
        <SectionTitle as='label' htmlFor='webdav-server-url' className='block'>
          {_('Server URL')}
        </SectionTitle>
        <input
          id='webdav-server-url'
          type='text'
          placeholder='https://dav.example.com'
          className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
          spellCheck='false'
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className='space-y-1.5'>
        <SectionTitle as='label' htmlFor='webdav-username' className='block'>
          {_('Username')}
        </SectionTitle>
        <input
          id='webdav-username'
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
        <SectionTitle as='label' htmlFor='webdav-password' className='block'>
          {_('Password')}
        </SectionTitle>
        <div className='relative'>
          <input
            id='webdav-password'
            type={showPassword ? 'text' : 'password'}
            placeholder={_('Your Password')}
            className='input input-bordered eink-bordered h-11 w-full pe-11 text-sm focus:outline-none'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete='current-password'
          />
          <button
            type='button'
            onClick={() => setShowPassword((v) => !v)}
            className={clsx(
              'absolute end-2 top-1/2 -translate-y-1/2',
              'flex h-8 w-8 items-center justify-center rounded',
              'text-base-content/60 hover:text-base-content',
              'hover:bg-base-200/60 transition-colors duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
            )}
            aria-label={showPassword ? _('Hide password') : _('Show password')}
            title={showPassword ? _('Hide password') : _('Show password')}
            tabIndex={-1}
          >
            {showPassword ? (
              <MdVisibilityOff className='h-4 w-4' />
            ) : (
              <MdVisibility className='h-4 w-4' />
            )}
          </button>
        </div>
      </div>

      <div className='space-y-1.5'>
        <SectionTitle as='label' htmlFor='webdav-root' className='block'>
          {_('Root Directory')}
        </SectionTitle>
        <input
          id='webdav-root'
          type='text'
          placeholder='/'
          className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
          spellCheck='false'
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
        />
      </div>

      <div className='flex justify-end pt-1'>
        <button
          type='submit'
          disabled={isConnecting || !url || !username}
          className={clsx(
            'btn btn-primary',
            'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
            'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
            isConnecting && 'opacity-60',
          )}
        >
          {isConnecting ? <span className='loading loading-spinner loading-sm' /> : _('Connect')}
        </button>
      </div>
    </form>
  );
};

export default WebDAVForm;
