import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { discoverLanPeers, type DiscoveredLanPeer } from '@/services/lanSync/discovery';
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

type DiscoveryPanelProps = {
  _: TranslationFunc;
  isDiscovering: boolean;
  hasSearched: boolean;
  discoveryFailed: boolean;
  peers: DiscoveredLanPeer[];
  isConnecting: boolean;
  connectingPeerId: string | null;
  onDiscover: () => void;
  onSelectPeer: (peer: DiscoveredLanPeer) => void;
};

/** Automatic discovery is the primary LAN pairing flow on native clients. */
const LanPeerDiscovery: React.FC<DiscoveryPanelProps> = ({
  _,
  isDiscovering,
  hasSearched,
  discoveryFailed,
  peers,
  isConnecting,
  connectingPeerId,
  onDiscover,
  onSelectPeer,
}) => (
  <div className='space-y-3'>
    <button
      type='button'
      onClick={onDiscover}
      disabled={isDiscovering || isConnecting}
      className={clsx(
        'btn btn-contrast h-11 min-h-11 w-full rounded-lg border-0 text-sm font-medium',
        'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
        (isDiscovering || isConnecting) && 'opacity-60',
      )}
    >
      {isDiscovering ? <span className='loading loading-spinner loading-sm' /> : null}
      {isDiscovering ? _('Searching for devices…') : _('Find nearby Readest devices')}
    </button>

    {peers.length > 0 && (
      <BoxedList title={_('Nearby Readest devices')}>
        {peers.map((peer) => {
          const connecting = connectingPeerId === peer.device_id;
          return (
            <SettingsRow
              key={peer.device_id}
              label={peer.name || _('Readest device')}
              description={`${peer.host}:${peer.port}`}
            >
              <button
                type='button'
                onClick={() => onSelectPeer(peer)}
                disabled={isConnecting}
                className={clsx(
                  'btn btn-ghost btn-sm h-9 min-h-9 shrink-0 px-3 text-xs',
                  isConnecting && !connecting && 'opacity-40',
                )}
              >
                {connecting ? <span className='loading loading-spinner loading-xs' /> : null}
                {connecting ? _('Connecting…') : _('Connect')}
              </button>
            </SettingsRow>
          );
        })}
      </BoxedList>
    )}

    {hasSearched && !isDiscovering && peers.length === 0 && !discoveryFailed && (
      <BoxedList>
        <SettingsRow
          label={_('No nearby Readest devices found')}
          description={_(
            'Make sure both devices are on the same local network and LAN Sync is enabled.',
          )}
        />
      </BoxedList>
    )}

    {discoveryFailed && !isDiscovering && (
      <BoxedList>
        <SettingsRow
          label={_('Automatic discovery is unavailable')}
          description={_('You can still connect manually below.')}
        />
      </BoxedList>
    )}
  </div>
);

/**
 * LAN Sync provider panel, embedded in the Integrations LAN sub-page (which
 * owns the header). Automatic discovery is the primary flow on native clients;
 * manual host / port / token entry remains available as a fallback.
 */
const LanForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.lan;
  const isActive = !!stored?.enabled;
  const isTauri = isTauriAppPlatform();

  const [host, setHost] = useState(stored?.host || '');
  const [port, setPort] = useState(
    stored?.port ? String(stored.port) : String(DEFAULT_LAN_SYNC_PORT),
  );
  const [token, setToken] = useState(stored?.token || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingPeerId, setConnectingPeerId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<LanSyncStatus | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [peers, setPeers] = useState<DiscoveredLanPeer[]>([]);
  const [showPeerDiscovery, setShowPeerDiscovery] = useState(false);
  const [showManualConnection, setShowManualConnection] = useState(!isTauri);
  // True only for the temporary advertiser used while an unpaired device is
  // searching. A successful connection persists the settings and keeps the
  // server running; cancellation/close cleans this short-lived server up.
  const temporaryServerRef = useRef(false);
  const temporaryTokenRef = useRef<string | null>(null);

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

  useEffect(() => {
    return () => {
      if (temporaryServerRef.current) {
        void stopLanSync().catch(() => {});
        temporaryServerRef.current = false;
        temporaryTokenRef.current = null;
      }
    };
  }, []);

  const persistLan = async (patch: Partial<LanSyncSettings>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, lan: { ...latest.lan, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleDiscover = async () => {
    if (!isTauri || isDiscovering || isConnecting) return;
    setIsDiscovering(true);
    setHasSearched(false);
    setDiscoveryFailed(false);
    setPeers([]);
    try {
      // A first-time device has no enabled LAN server yet, so there would be
      // nothing for the other device to discover. Start a temporary advertiser
      // with a local token before browsing; it is kept alive while this panel
      // remains open and is promoted to the persisted server after pairing.
      if (!isActive) {
        const temporaryToken = token.trim() || generateToken();
        const temporaryStatus = await startLanSync(
          temporaryToken,
          DEFAULT_LAN_SYNC_PORT,
          'Readest',
        );
        setStatus(temporaryStatus);
        temporaryServerRef.current = true;
        temporaryTokenRef.current = temporaryToken;
        if (!token.trim()) setToken(temporaryToken);
      }
      const found = await discoverLanPeers();
      const visible = status?.device_id
        ? found.filter((peer) => peer.device_id !== status.device_id)
        : found;
      setPeers(visible);
    } catch (e) {
      console.warn('lan_sync discovery failed:', e);
      if (temporaryServerRef.current) {
        await stopLanSync().catch(() => {});
        temporaryServerRef.current = false;
        temporaryTokenRef.current = null;
      }
      setDiscoveryFailed(true);
      setShowManualConnection(true);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to search for nearby devices'),
      });
    } finally {
      setHasSearched(true);
      setIsDiscovering(false);
    }
  };

  const restartLocalServerWithToken = async (nextToken: string, previousToken: string) => {
    await stopLanSync();
    try {
      return await startLanSync(nextToken);
    } catch (e) {
      try {
        await startLanSync(previousToken);
      } catch (rollbackError) {
        console.warn('lan_sync rollback start failed:', rollbackError);
      }
      throw e;
    }
  };

  const handleConnect = async (target?: DiscoveredLanPeer) => {
    const trimmedHost = (target?.host ?? host).trim();
    const trimmedToken = (target?.token ?? token).trim();
    const trimmedPort = target?.port ?? (Number(port) || DEFAULT_LAN_SYNC_PORT);
    if (!trimmedHost || !trimmedToken) return;

    const previousToken = stored?.token?.trim() || '';
    const switchingActiveToken =
      isActive && isTauri && !!previousToken && previousToken !== trimmedToken;

    setIsConnecting(true);
    setConnectingPeerId(target?.device_id || null);
    if (target) {
      // Keep the manual fallback pre-filled if automatic connection fails.
      setHost(trimmedHost);
      setPort(String(trimmedPort));
      setToken(trimmedToken);
      setShowToken(false);
    }

    let restartedForSwitch = false;
    try {
      const peer = await lanSyncPing({
        enabled: false,
        host: trimmedHost,
        port: trimmedPort,
        token: trimmedToken,
      });

      // When changing devices while LAN Sync is already active, the newly
      // discovered peer may advertise a different token. Update this device's
      // embedded server only after the new peer has accepted the token, and
      // roll the old server back if that restart itself fails.
      if (switchingActiveToken) {
        const nextStatus = await restartLocalServerWithToken(trimmedToken, previousToken);
        setStatus(nextStatus);
        restartedForSwitch = true;
      } else if (temporaryServerRef.current) {
        // Promote the temporary advertiser to the peer's token before saving
        // the connection. Otherwise startLanSync would be idempotent and leave
        // this device serving with the throwaway token it used for discovery.
        const temporaryToken = temporaryTokenRef.current || '';
        const nextStatus = await restartLocalServerWithToken(trimmedToken, temporaryToken);
        setStatus(nextStatus);
        restartedForSwitch = true;
        temporaryServerRef.current = false;
        temporaryTokenRef.current = null;
      }

      try {
        // persistCloudProviderEnabled owns activation, persistence, and the
        // cross-window provider broadcast; host/port/token land before the
        // toggle flips so the first engine run sees a complete slice.
        await persistCloudProviderEnabled(envConfig, 'lan', true, (s) => ({
          ...s,
          lan: { ...s.lan, host: trimmedHost, port: trimmedPort, token: trimmedToken },
        }));
      } catch (e) {
        if (restartedForSwitch) {
          try {
            const restoredStatus = await restartLocalServerWithToken(previousToken, trimmedToken);
            setStatus(restoredStatus);
          } catch (rollbackError) {
            console.warn('lan_sync settings rollback start failed:', rollbackError);
          }
        }
        throw e;
      }

      // Bring this device's own server up so the peer can connect back. A
      // device switch above already restarted it with the new token.
      if (isTauri && !restartedForSwitch) {
        try {
          const nextStatus = await startLanSync(trimmedToken);
          setStatus(nextStatus);
        } catch (e) {
          console.warn('lan_sync start failed:', e);
        }
      }

      setPeers([]);
      setHasSearched(false);
      setDiscoveryFailed(false);
      setShowPeerDiscovery(false);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Connected to {{name}}', {
          name: target?.name || peer.name || peer.device_id,
        }),
      });
    } catch (e) {
      if (target) setShowManualConnection(true);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatPingError(_, e)}`,
      });
    } finally {
      setIsConnecting(false);
      setConnectingPeerId(null);
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
    setShowPeerDiscovery(false);
    setShowManualConnection(!isTauri);
    setPeers([]);
    setHasSearched(false);
    setDiscoveryFailed(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  const openPeerDiscovery = () => {
    setShowPeerDiscovery(true);
    if (isTauri && !hasSearched && !isDiscovering) {
      void handleDiscover();
    }
  };

  const discoveryPanel = isTauri ? (
    <LanPeerDiscovery
      _={_}
      isDiscovering={isDiscovering}
      hasSearched={hasSearched}
      discoveryFailed={discoveryFailed}
      peers={peers}
      isConnecting={isConnecting}
      connectingPeerId={connectingPeerId}
      onDiscover={() => void handleDiscover()}
      onSelectPeer={(peer) => void handleConnect(peer)}
    />
  ) : (
    <BoxedList>
      <SettingsRow
        label={_('Automatic discovery is unavailable')}
        description={_('Use the manual connection below.')}
      />
    </BoxedList>
  );

  const manualConnectionForm = (
    <div className='space-y-4 pt-4'>
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
          type='button'
          onClick={() => void handleConnect()}
          disabled={isConnecting || !host.trim() || !token.trim()}
          className={clsx(
            'btn btn-contrast',
            'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
            'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
            isConnecting && 'opacity-60',
          )}
        >
          {isConnecting && !connectingPeerId ? (
            <span className='loading loading-spinner loading-sm' />
          ) : null}
          {_('Connect')}
        </button>
      </div>
    </div>
  );

  if (isActive) {
    return (
      <div className='space-y-5'>
        <div className='space-y-2'>
          <BoxedList title={_('Connected device')}>
            <SettingsRow
              label={_('LAN peer')}
              description={
                stored?.host ? `${stored.host}:${stored.port || DEFAULT_LAN_SYNC_PORT}` : undefined
              }
            >
              <button
                type='button'
                onClick={showPeerDiscovery ? () => setShowPeerDiscovery(false) : openPeerDiscovery}
                disabled={isConnecting}
                className='btn btn-ghost btn-sm h-9 min-h-9 shrink-0 px-3 text-xs'
              >
                {showPeerDiscovery ? _('Cancel') : _('Find another device')}
              </button>
            </SettingsRow>
          </BoxedList>

          {showPeerDiscovery && (
            <div className='space-y-3'>
              {discoveryPanel}
              <button
                type='button'
                onClick={() => setShowManualConnection((value) => !value)}
                className='text-base-content/70 hover:text-base-content flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium transition-colors'
              >
                <span>{_('Connect manually')}</span>
                <span
                  className={clsx(
                    'text-base-content/45 transition-transform',
                    showManualConnection && 'rotate-90',
                  )}
                >
                  ›
                </span>
              </button>
              {showManualConnection && manualConnectionForm}
            </div>
          )}
        </div>

        <FileSyncForm kind='lan' stored={stored} persist={persistLan} />

        {isTauri && status?.running && status.local_ips.length > 0 && (
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
        void handleConnect();
      }}
    >
      {discoveryPanel}

      <div>
        <button
          type='button'
          onClick={() => setShowManualConnection((value) => !value)}
          className='text-base-content/70 hover:text-base-content flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium transition-colors'
        >
          <span>{_('Connect manually')}</span>
          <span
            className={clsx(
              'text-base-content/45 transition-transform',
              showManualConnection && 'rotate-90',
            )}
          >
            ›
          </span>
        </button>
        {showManualConnection && manualConnectionForm}
      </div>
    </form>
  );
};

export default LanForm;
