import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getBaseUrl } from '@/services/environment';
import { READEST_WEB_BASE_URL } from '@/services/constants';
import {
  type ServerConfigOverrides,
  normalizeServerUrl,
  readStoredServerConfig,
} from '@/services/serverConfig';
import { type ServerTestResult, testServer } from '@/services/serverConnection';
import { switchServer } from '@/services/serverSwitch';
import { SectionTitle, SettingLabel, SettingsSelect } from '../primitives';

/** Host of the server the app talks to, or null for Readest Cloud. */
export const getActiveServerHost = (): string | null => {
  const stored = readStoredServerConfig();
  if (stored) return new URL(stored.serverUrl).host;
  const baseUrl = getBaseUrl();
  return baseUrl === READEST_WEB_BASE_URL ? null : new URL(baseUrl).host;
};

type Mode = 'cloud' | 'custom';
type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'error'; message: string }
  | { kind: 'insecure' }
  | { kind: 'ok'; result: Extract<ServerTestResult, { ok: true }>; testedKey: string };

const inputClass = 'input eink-bordered h-11 w-full text-sm focus:outline-hidden';
const flatButtonClass = clsx(
  'eink-bordered h-10 rounded-lg px-4 text-sm font-medium',
  'hover:bg-base-200 transition-colors duration-150',
  'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
  'disabled:opacity-60',
);

const ServerSettings: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { logout } = useAuth();
  const [stored] = useState(readStoredServerConfig);
  const [mode, setMode] = useState<Mode>(stored ? 'custom' : 'cloud');
  const [url, setUrl] = useState(stored?.serverUrl ?? '');
  const [supabaseUrl, setSupabaseUrl] = useState(stored?.overrides?.supabaseUrl ?? '');
  const [anonKey, setAnonKey] = useState(stored?.overrides?.supabaseAnonKey ?? '');
  const [allowHttp, setAllowHttp] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [isSwitching, setIsSwitching] = useState(false);

  const activeHost = getActiveServerHost();
  const overrides: ServerConfigOverrides | undefined =
    supabaseUrl.trim() || anonKey.trim()
      ? {
          ...(supabaseUrl.trim() && { supabaseUrl: supabaseUrl.trim() }),
          ...(anonKey.trim() && { supabaseAnonKey: anonKey.trim() }),
        }
      : undefined;
  const inputKey = JSON.stringify([url, overrides, allowHttp]);
  const canSave = status.kind === 'ok' && status.testedKey === inputKey && !isSwitching;

  const resetStatus = () => setStatus({ kind: 'idle' });

  const errorMessage = (result: Extract<ServerTestResult, { ok: false }>) => {
    switch (result.error) {
      case 'outdated':
        return _('This server does not support app setup yet. Update your Readest server');
      case 'disabled':
        return _("This server doesn't allow app connections");
      case 'unreachable':
        return _('Could not reach the server');
      case 'not-readest':
        return _('This does not look like a Readest server');
      case 'incomplete':
        return _('The server did not provide its sign-in settings. Set them under Advanced');
      case 'auth-unreachable':
        return _('Could not reach the sign-in service at {{host}}', { host: result.authHost });
    }
  };

  const handleTest = async () => {
    const normalized = normalizeServerUrl(url, { allowHttp });
    if ('error' in normalized) {
      setStatus(
        normalized.error === 'insecure'
          ? { kind: 'insecure' }
          : { kind: 'error', message: _('Enter a valid server URL') },
      );
      return;
    }
    if (
      overrides?.supabaseUrl &&
      'error' in normalizeServerUrl(overrides.supabaseUrl, { allowHttp })
    ) {
      setStatus({ kind: 'error', message: _('Enter a valid Supabase URL') });
      return;
    }
    setStatus({ kind: 'testing' });
    const result = await testServer(normalized.url, overrides);
    setStatus(
      result.ok
        ? { kind: 'ok', result, testedKey: inputKey }
        : { kind: 'error', message: errorMessage(result) },
    );
  };

  const confirmAndSwitch = async (next: Parameters<typeof switchServer>[0]['next']) => {
    if (!appService) return;
    const confirmed = await appService.ask(
      _(
        'You will be signed out, and books not stored on this device will be removed from your library. Continue?',
      ),
    );
    if (!confirmed) return;
    setIsSwitching(true);
    try {
      await switchServer({ appService, logout, next });
    } finally {
      setIsSwitching(false);
    }
  };

  const handleSave = () => {
    if (status.kind !== 'ok') return;
    const normalized = normalizeServerUrl(url, { allowHttp });
    if ('error' in normalized) return;
    confirmAndSwitch({
      v: 1,
      serverUrl: normalized.url,
      ...(overrides && { overrides }),
      config: status.result.config,
      savedAt: Date.now(),
    });
  };

  return (
    <div className='space-y-5'>
      <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
        <div className='divide-base-200 divide-y'>
          <div className='flex min-h-14 items-center justify-between gap-3 px-4'>
            <SettingLabel>{_('Active Server')}</SettingLabel>
            <span className='text-base-content/70 truncate text-sm' data-testid='active-server'>
              {activeHost ?? _('Readest Cloud')}
            </span>
          </div>
          <div className='flex min-h-14 items-center justify-between gap-3 px-4'>
            <SettingLabel>{_('Server')}</SettingLabel>
            <SettingsSelect
              value={mode}
              ariaLabel={_('Server')}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                resetStatus();
              }}
              options={[
                { value: 'cloud', label: _('Readest Cloud') },
                { value: 'custom', label: _('Custom Server') },
              ]}
            />
          </div>
        </div>
      </div>

      {mode === 'cloud' && stored && (
        <div className='flex justify-end'>
          <button
            type='button'
            className='btn btn-contrast h-10 min-h-10 rounded-lg px-5 text-sm font-medium'
            disabled={isSwitching}
            onClick={() => confirmAndSwitch(null)}
          >
            {_('Switch to Readest Cloud')}
          </button>
        </div>
      )}

      {mode === 'custom' && (
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault();
            handleTest();
          }}
        >
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='server-url' className='block'>
              {_('Server URL')}
            </SectionTitle>
            <input
              id='server-url'
              type='text'
              inputMode='url'
              placeholder='https://books.example.com'
              className={inputClass}
              spellCheck={false}
              autoCapitalize='off'
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setAllowHttp(false);
                resetStatus();
              }}
            />
          </div>

          <details className='group'>
            <summary className='text-base-content/70 cursor-pointer text-sm'>
              {_('Advanced')}
            </summary>
            <div className='mt-3 space-y-4'>
              <div className='space-y-1.5'>
                <SectionTitle as='label' htmlFor='server-supabase-url' className='block'>
                  {_('Supabase URL')}
                </SectionTitle>
                <input
                  id='server-supabase-url'
                  type='text'
                  inputMode='url'
                  placeholder='https://auth.example.com'
                  className={inputClass}
                  spellCheck={false}
                  autoCapitalize='off'
                  value={supabaseUrl}
                  onChange={(e) => {
                    setSupabaseUrl(e.target.value);
                    resetStatus();
                  }}
                />
              </div>
              <div className='space-y-1.5'>
                <SectionTitle as='label' htmlFor='server-anon-key' className='block'>
                  {_('Supabase Anon Key')}
                </SectionTitle>
                <input
                  id='server-anon-key'
                  type='text'
                  className={clsx(inputClass, 'font-mono')}
                  spellCheck={false}
                  autoCapitalize='off'
                  value={anonKey}
                  onChange={(e) => {
                    setAnonKey(e.target.value);
                    resetStatus();
                  }}
                />
              </div>
              <span className='text-base-content/60 block text-xs'>
                {_('Only needed when sign-in runs on a different host than the server')}
              </span>
            </div>
          </details>

          {status.kind === 'insecure' || (allowHttp && url.trim().startsWith('http:')) ? (
            <div className='space-y-2'>
              <p className='text-warning text-sm'>
                {_(
                  'This connection is not encrypted. Only use http:// on a network you trust, such as your home network or a VPN',
                )}
              </p>
              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  className='checkbox checkbox-sm'
                  checked={allowHttp}
                  onChange={(e) => {
                    setAllowHttp(e.target.checked);
                    resetStatus();
                  }}
                />
                {_('I trust this network')}
              </label>
            </div>
          ) : null}

          {status.kind === 'error' && <p className='text-error text-sm'>{status.message}</p>}
          {status.kind === 'ok' && status.testedKey === inputKey && (
            <div className='space-y-1'>
              <p className='text-success text-sm'>{_('Connection successful')}</p>
              {status.result.authHostDiffers && (
                <p className='text-base-content/70 text-sm'>
                  {_('Sign-in will use {{host}}', { host: status.result.authHost })}
                </p>
              )}
            </div>
          )}

          <div className='flex justify-end gap-2 pt-1'>
            <button
              type='submit'
              className={flatButtonClass}
              disabled={!url.trim() || status.kind === 'testing' || isSwitching}
            >
              {status.kind === 'testing' ? (
                <span className='loading loading-spinner loading-sm' />
              ) : (
                _('Test Connection')
              )}
            </button>
            <button
              type='button'
              className='btn btn-contrast h-10 min-h-10 rounded-lg px-5 text-sm font-medium'
              disabled={!canSave}
              onClick={handleSave}
            >
              {_('Save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ServerSettings;
