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
import SubPageHeader from '../SubPageHeader';
import { SectionTitle } from '../primitives';
import FileSyncForm from './FileSyncForm';
import WebDAVBrowsePane from './WebDAVBrowsePane';

interface WebDAVFormProps {
  onBack: () => void;
}

/**
 * Translate a connection-probe failure into a user-facing string.
 *
 * Each branch must be a literal `_('...')` call so the i18next-scanner picks the
 * keys up — that's why this is a switch on `result.code` rather than the previous
 * `_(result.message || 'Connection error')` pattern, which the scanner couldn't
 * see into.
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
      return _('Unexpected server response (status {{status}})', {
        status: result.status ?? 0,
      });
    case 'NETWORK':
    default:
      return _('Network error');
  }
};

/**
 * WebDAV integration form. Two modes share the same panel:
 *
 * - Configuration: editable URL/username/password/root + Connect button. Lives
 *   in local state until Connect succeeds — only then do we persist the
 *   credentials. Failures surface via toast.
 * - Connected: renders the shared {@link FileSyncForm} sync controls + the
 *   {@link WebDAVBrowsePane} for the stored root, plus a Disconnect button. Only
 *   the connect panel + browse pane are WebDAV-specific; the sync controls are
 *   shared with the Google Drive form.
 */
const WebDAVForm: React.FC<WebDAVFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.webdav;
  // Show the browse view only when an active connection is configured. We rely
  // on `enabled` (set by Connect, cleared by Disconnect) rather than serverUrl/
  // username so Disconnect always returns the user to the configuration form.
  const isConfigured = !!stored?.enabled && !!stored?.serverUrl;

  // Editable form state — initialised from saved settings so re-entering the
  // sub-page preserves what the user typed.
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
    // Spread previous webdav state so a reconnect preserves bookkeeping fields
    // earned by prior use — deviceId, syncBooks, strategy, syncProgress,
    // syncNotes, lastSyncedAt. Rotating deviceId on reconnect would make this
    // device look new to the cross-device clobber check.
    const newSettings = {
      ...settings,
      webdav: buildWebDAVConnectSettings(settings.webdav, {
        serverUrl: url,
        username,
        password,
        rootPath: normalizedRoot,
      }),
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setIsConnecting(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      webdav: { ...settings.webdav, enabled: false },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    // Keep the password pre-filled (masked) so the user can reconnect with one
    // click — they can still toggle visibility via the eye icon.
    setShowPassword(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  // Read latest settings from the store (NOT the closure) when computing `next`:
  // several persist calls can land back-to-back (FileSyncForm writes deviceId up
  // front and lastSyncedAt when it finishes, and the user may flip a toggle in
  // between), so a closure-based merge would clobber a freshly-written field.
  const persistWebdav = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, webdav: { ...latest.webdav, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const description: string = isConfigured
    ? _('Browsing {{path}} on {{server}}', {
        path: normalizeRootPath(stored.rootPath || '/'),
        server: stored.serverUrl,
      })
    : _('Connect to a WebDAV server to browse your remote files.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('WebDAV')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
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

export default WebDAVForm;
