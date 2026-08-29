import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { FileSyncError } from '@/services/sync/file/provider';
import { lanSyncPing } from '@/services/sync/providers/lan/LanSyncProvider';
import {
  DEFAULT_LAN_SYNC_PORT,
  getLanSyncStatus,
  startLanSync,
  stopLanSync,
  type LanSyncStatus,
} from '@/services/lanSync/lifecycle';
import type { LanSyncSettings } from '@/types/settings';
import { BoxedList, SectionTitle, SettingsRow } from '../primitives';
import FileSyncForm from './FileSyncForm';
import { persistCloudProviderEnabled } from './cloudSync';

/**
 * Translate a peer-probe failure into a user-facing string. Each branch is a
 * literal `_('...')` call so the i18next-scanner picks the keys up.
 */
const formatPingError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof FileSyncError) {
    switch (e.code) {
      case 'AUTH_FAILED':
        return _('The peer rejected the pairing token');
      case 'NETWORK':
        return _('Device unreachable on the local network');
    }
  }
  return _('Network error');
};

/**
 * The pairing token per the LanSyncSettings spec: 32 hex chars from
 * crypto.getRandomValues, shared verbatim by both devices.
 */
const generateToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * LAN Sync provider panel, embedded in the Integrations LAN sub-page (which
 * owns the header). Two states, mirroring WebDAVForm:
 *
 * - **Active** (`lan.enabled`): the shared {@link FileSyncForm} sync controls,
 *   this device's LAN addresses (so the peer has something to type in), and a
 *   Disconnect button.
 * - **Inactive**: the host / port / token connect form. Connecting probes the
 *   peer with {@link lanSyncPing} (a token-accepted /ping), persists the slice
 *   through `persistCloudProviderEnabled`, and starts this device's own
 *   embedded server so the peer can connect back. Disconnect stops it.
 *
 * The pairing token is shared: identical on both devices, generated once on
 * the first device and typed into the peer's form (out-of-band exchange).
 */
const LanForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.lan;
  const isActive = !!stored?.enabled;

  const [host, setHost] = useState(stored?.host || '');
  const [port, setPort] = useState(
    stored?.port ? String(stored.port) : String(DEFAULT_LAN_SYNC_PORT),
  );
  const [token, setToken] = useState(stored?.token || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<LanSyncStatus | null>(null);

  const isTauri = isTauriAppPlatform();

  // Active state: surface this device's own LAN addresses for the peer's form,
  // and self-heal the embedded server after an app restart that raced the
  // boot-time manager (start is idempotent on the Rust side).
  useEffect(() => {
    if (!isActive || !isTauri || !stored?.token) return;
    let cancelled = false;
    (async () => {
      try {
        let s = await getLanSyncStatus();
        if (!s.running) {
          s = await startLanSync(stored.token);
        }
        if (!cancelled) setStatus(s);
      } catch (e) {
        console.warn('lan_sync status failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, isTauri, stored?.token]);

  const persistLan = async (patch: Partial<LanSyncSettings>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, lan: { ...latest.lan, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleConnect = async () => {
    const trimmedHost = host.trim();
    const trimmedToken = token.trim();
    const trimmedPort = Number(port) || DEFAULT_LAN_SYNC_PORT;
    if (!trimmedHost || !trimmedToken) return;
    setIsConnecting(true);
    try {
      const peer = await lanSyncPing({
        enabled: false,
        host: trimmedHost,
        port: trimmedPort,
        token: trimmedToken,
      });
      // persistCloudProviderEnabled owns activation, persistence, and the
      // cross-window provider broadcast; host/port/token land before the
      // toggle flips so the first engine run sees a complete slice.
      await persistCloudProviderEnabled(envConfig, 'lan', true, (s) => ({
        ...s,
        lan: { ...s.lan, host: trimmedHost, port: trimmedPort, token: trimmedToken },
      }));
      // Bring this device's own server up so the peer can connect back — on
      // this device's OWN default port; the "Peer Port" field above only
      // governs outgoing connections to the peer.
      if (isTauriAppPlatform()) {
        try {
          await startLanSync(trimmedToken);
        } catch (e) {
          console.warn('lan_sync start failed:', e);
        }
      }
      setIsConnecting(false);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Connected to {{name}}', { name: peer.name || peer.device_id }),
      });
    } catch (e) {
      setIsConnecting(false);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatPingError(_, e)}`,
      });
    }
  };

  const handleDisconnect = async () => {
    // Switch LAN sync off only — other providers keep syncing. The peer
    // config stays so a later reconnect is one click.
    await persistCloudProviderEnabled(envConfig, 'lan', false);
    if (isTauriAppPlatform()) {
      try {
        await stopLanSync();
      } catch (e) {
        console.warn('lan_sync stop failed:', e);
      }
    }
    setShowToken(false);
    setStatus(null);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  if (isActive) {
    return (
      <div className='space-y-5'>
        <FileSyncForm kind='lan' stored={stored} persist={persistLan} />

        {isTauriAppPlatform() && status?.running && status.local_ips.length > 0 && (
          <div className='space-y-1.5'>
            <SectionTitle>{_("This device's LAN addresses")}</SectionTitle>
            <BoxedList>
              {status.local_ips.map((ip) => (
                <SettingsRow
                  key={ip}
                  label={`${ip}:${status.port}`}
                  description={_('Type one of these into the peer device')}
                />
              ))}
            </BoxedList>
          </div>
        )}

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
        <SectionTitle as='label' htmlFor='lan-host' className='block'>
          {_('Peer Address')}
        </SectionTitle>
        <input
          id='lan-host'
          type='text'
          placeholder='192.168.1.5'
          className='input eink-bordered h-11 w-full text-sm focus:outline-hidden'
          spellCheck='false'
          value={host}
          onChange={(e) => setHost(e.target.value)}
          autoComplete='off'
        />
      </div>

      <div className='space-y-1.5'>
        <SectionTitle as='label' htmlFor='lan-port' className='block'>
          {_('Peer Port')}
        </SectionTitle>
        <input
          id='lan-port'
          type='text'
          inputMode='numeric'
          placeholder={String(DEFAULT_LAN_SYNC_PORT)}
          className='input eink-bordered h-11 w-full text-sm focus:outline-hidden'
          spellCheck='false'
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
          autoComplete='off'
        />
      </div>

      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          <SectionTitle as='label' htmlFor='lan-token' className='block'>
            {_('Pairing Token')}
          </SectionTitle>
          <button
            type='button'
            onClick={() => setToken(generateToken())}
            className='btn btn-ghost btn-xs h-7 min-h-7 px-2 text-xs'
            title={_('Generate a new pairing token')}
          >
            {_('Generate')}
          </button>
        </div>
        <div className='relative'>
          <input
            id='lan-token'
            type={showToken ? 'text' : 'password'}
            placeholder={_('Same token on both devices')}
            className='input eink-bordered h-11 w-full pe-11 text-sm focus:outline-hidden'
            spellCheck='false'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete='off'
          />
          <button
            type='button'
            onClick={() => setShowToken((v) => !v)}
            className={clsx(
              'absolute end-2 top-1/2 -translate-y-1/2',
              'flex h-8 w-8 items-center justify-center rounded-sm',
              'text-base-content/60 hover:text-base-content',
              'hover:bg-base-200/60 transition-colors duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
            )}
            aria-label={showToken ? _('Hide password') : _('Show password')}
            title={showToken ? _('Hide password') : _('Show password')}
            tabIndex={-1}
          >
            {showToken ? (
              <MdVisibilityOff className='h-4 w-4' />
            ) : (
              <MdVisibility className='h-4 w-4' />
            )}
          </button>
        </div>
      </div>

      <div className='flex justify-end pt-1'>
        <button
          type='submit'
          disabled={isConnecting || !host.trim() || !token.trim()}
          className={clsx(
            'btn btn-contrast',
            'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
            'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
            isConnecting && 'opacity-60',
          )}
        >
          {isConnecting ? <span className='loading loading-spinner loading-sm' /> : _('Connect')}
        </button>
      </div>
    </form>
  );
};

export default LanForm;
