import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Format,
  checkPermissions,
  requestPermissions,
  scan,
} from '@tauri-apps/plugin-barcode-scanner';
import { QRCodeSVG } from 'qrcode.react';
import { MdContentCopy, MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { discoverLanPeers, type DiscoveredLanPeer } from '@/services/lanSync/discovery';
import {
  createLanSyncPairingPayload,
  parseLanSyncPairingPayload,
} from '@/services/lanSync/pairing';
import { setMulticastLock } from '@/utils/bridge';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { FileSyncError } from '@/services/sync/file/provider';
import { lanSyncPing } from '@/services/sync/providers/lan/LanSyncProvider';
import {
  DEFAULT_LAN_SYNC_PORT,
  generateLanSyncToken,
  getLanSyncStatus,
  getLanSyncGeneration,
  replaceLanSyncToken,
  startLanSync,
  stopLanSync,
  stopLanSyncIfCurrent,
  type LanSyncStatus,
} from '@/services/lanSync/lifecycle';
import type { LanSyncSettings, SystemSettings } from '@/types/settings';
import { BoxedList, SectionTitle, SettingsRow } from '../primitives';
import FileSyncForm from './FileSyncForm';
import { persistCloudProviderEnabled, persistSettingsMutation } from './cloudSync';

/**
 * Translate a peer-probe failure into a user-facing string. Each branch is a
 * literal `_('...')` call so the i18next-scanner picks the keys up.
 */
const formatPingError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof FileSyncError) {
    switch (e.code) {
      case 'AUTH_FAILED':
        return _('The peer requires a pairing token');
      case 'NETWORK':
        return _('Device unreachable on the local network');
    }
  }
  return _('Network error');
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
  const { settings, setSettings } = useSettingsStore();
  const { envConfig, appService } = useEnv();

  const stored = settings.lan;
  const isActive = !!stored?.enabled;
  const isTauri = isTauriAppPlatform();
  const needsMulticastLock = appService?.isAndroidApp === true;
  const canScanPairingQr = isTauri && appService?.isMobileApp === true;

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
  const temporaryServerGenerationRef = useRef<number | null>(null);
  const temporaryTokenRef = useRef<string | null>(null);
  const promotionLockHeldRef = useRef(false);
  const promotionLockPromiseRef = useRef<Promise<void> | null>(null);
  const promotionLockReleasePromiseRef = useRef<Promise<void> | null>(null);
  const unmountedRef = useRef(false);
  const disconnectingRef = useRef(false);
  const connectingRef = useRef(false);
  const connectionRunRef = useRef(0);
  const temporaryDiscoveryLockRef = useRef(false);
  const discoveryLockPromiseRef = useRef<Promise<void> | null>(null);
  const discoveryCleanupPromiseRef = useRef<Promise<void> | null>(null);
  const discoveryRunRef = useRef(0);

  const acquireDiscoveryLock = useCallback(async () => {
    if (!needsMulticastLock || temporaryDiscoveryLockRef.current) return;
    const existing = discoveryLockPromiseRef.current;
    if (existing) {
      await existing;
      return;
    }
    const pending = setMulticastLock(true, 'lan-discovery');
    discoveryLockPromiseRef.current = pending;
    try {
      await pending;
      temporaryDiscoveryLockRef.current = true;
    } finally {
      if (discoveryLockPromiseRef.current === pending) {
        discoveryLockPromiseRef.current = null;
      }
    }
  }, [needsMulticastLock]);

  const releaseDiscoveryLock = useCallback(async () => {
    const pending = discoveryLockPromiseRef.current;
    if (pending) await pending.catch(() => {});
    if (!temporaryDiscoveryLockRef.current) return;
    try {
      await setMulticastLock(false, 'lan-discovery');
      temporaryDiscoveryLockRef.current = false;
    } catch (e) {
      console.warn('lan_sync discovery multicast unlock failed:', e);
    }
  }, []);

  const stopTemporaryServer = useCallback(async () => {
    if (!temporaryServerRef.current) return;
    const generation = temporaryServerGenerationRef.current;
    const temporaryToken = temporaryTokenRef.current;
    temporaryServerRef.current = false;
    temporaryServerGenerationRef.current = null;
    temporaryTokenRef.current = null;
    if (generation === null) return;
    try {
      await stopLanSyncIfCurrent(generation);
    } catch (e) {
      // Keep ownership for a later cleanup retry when the IPC call itself
      // failed. A successful compare-stop (including a generation mismatch)
      // intentionally leaves these refs cleared.
      temporaryServerRef.current = true;
      temporaryServerGenerationRef.current = generation;
      temporaryTokenRef.current = temporaryToken;
      console.warn('lan_sync temporary server stop failed:', e);
    }
  }, []);

  const releasePromotionLock = useCallback(() => {
    const existingRelease = promotionLockReleasePromiseRef.current;
    if (existingRelease) return existingRelease;
    const release = (async () => {
      const pending = promotionLockPromiseRef.current;
      if (pending) await pending.catch(() => {});
      if (!promotionLockHeldRef.current) return;
      try {
        await setMulticastLock(false, 'lan-sync');
        promotionLockHeldRef.current = false;
      } catch (e) {
        console.warn('lan_sync promotion multicast unlock failed:', e);
      }
    })();
    promotionLockReleasePromiseRef.current = release;
    void release.finally(() => {
      if (promotionLockReleasePromiseRef.current === release) {
        promotionLockReleasePromiseRef.current = null;
      }
    });
    return release;
  }, []);

  const cleanupDiscovery = useCallback(async () => {
    const previous = discoveryCleanupPromiseRef.current;
    if (previous) await previous.catch(() => {});

    const cleanup = (async () => {
      await stopTemporaryServer();
      await releaseDiscoveryLock();
    })();
    discoveryCleanupPromiseRef.current = cleanup;
    try {
      await cleanup;
    } finally {
      if (discoveryCleanupPromiseRef.current === cleanup) {
        discoveryCleanupPromiseRef.current = null;
      }
    }
  }, [releaseDiscoveryLock, stopTemporaryServer]);

  // Active state: surface this device's own LAN addresses for the peer's form,
  // and self-heal the embedded server after an app restart that raced the
  // boot-time manager (start is idempotent on the Rust side).
  useEffect(() => {
    if (!isActive || !isTauri) return;
    const localToken = stored?.token?.trim() ?? '';
    const expectedIntentGeneration = getLanSyncGeneration();
    let cancelled = false;
    (async () => {
      try {
        let s = await getLanSyncStatus();
        if (cancelled || disconnectingRef.current) return;
        if (!s.running) {
          s = await startLanSync(localToken, DEFAULT_LAN_SYNC_PORT, '', s.generation);
          const currentLan = useSettingsStore.getState().settings?.lan;
          if (
            cancelled ||
            disconnectingRef.current ||
            getLanSyncGeneration() !== expectedIntentGeneration ||
            !currentLan?.enabled ||
            (currentLan.token?.trim() ?? '') !== localToken
          ) {
            if (s.started) {
              try {
                await stopLanSyncIfCurrent(s.generation);
              } catch {
                /* another cleanup may have stopped it already */
              }
            }
            return;
          }
        }
        setStatus(s);
      } catch (e) {
        if (!cancelled && !disconnectingRef.current) console.warn('lan_sync status failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, isTauri, stored?.token]);

  useEffect(() => {
    if (isActive && needsMulticastLock) return;
    void releasePromotionLock();
  }, [isActive, needsMulticastLock, releasePromotionLock]);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      connectionRunRef.current += 1;
      discoveryRunRef.current += 1;
      void cleanupDiscovery().then(() => releasePromotionLock());
    };
  }, [cleanupDiscovery, releasePromotionLock]);

  const persistLan = async (patch: Partial<LanSyncSettings>) => {
    const latest = useSettingsStore.getState().settings;
    setSettings({ ...latest, lan: { ...latest.lan, ...patch } });
    await persistSettingsMutation(envConfig, (current) => ({
      ...current,
      lan: { ...current.lan, ...patch },
    }));
  };

  const persistLanProvider = (
    enabled: boolean,
    mutate: (settings: SystemSettings) => SystemSettings = (s) => s,
  ): Promise<SystemSettings> => persistCloudProviderEnabled(envConfig, 'lan', enabled, mutate);

  const copyPairingToken = async () => {
    const value = stored?.token?.trim();
    if (!value) return;
    if (await writeTextToClipboard(value)) {
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Copied to clipboard'),
      });
    }
  };

  const handleDiscover = async () => {
    if (!isTauri || isDiscovering || isConnecting) return;
    const runId = discoveryRunRef.current + 1;
    const expectedGeneration = getLanSyncGeneration();
    discoveryRunRef.current = runId;
    setIsDiscovering(true);
    setHasSearched(false);
    setDiscoveryFailed(false);
    setPeers([]);
    const pendingCleanup = discoveryCleanupPromiseRef.current;
    if (pendingCleanup) await pendingCleanup.catch(() => {});
    if (runId !== discoveryRunRef.current) return;
    try {
      await acquireDiscoveryLock();
      if (runId !== discoveryRunRef.current) return;

      // A first-time device has no enabled LAN server yet, so there would be
      // nothing for the other device to discover. Start a temporary advertiser
      // before browsing; it is kept alive while this panel remains open and is
      // promoted to the persisted server after pairing.
      let ownDeviceId = '';
      let expectedServerGeneration: number | undefined;
      if (isActive) {
        const currentStatus = await getLanSyncStatus();
        if (runId !== discoveryRunRef.current || getLanSyncGeneration() !== expectedGeneration)
          return;
        expectedServerGeneration = currentStatus.generation;
        if (currentStatus.running) ownDeviceId = currentStatus.device_id;
      }
      if (!isActive) {
        const existingStatus = await getLanSyncStatus();
        if (runId !== discoveryRunRef.current || getLanSyncGeneration() !== expectedGeneration)
          return;
        expectedServerGeneration = existingStatus.generation;
        if (existingStatus.running) {
          // A running server may belong to another window; never stop it just
          // to prepare discovery. Use its device id for self-peer filtering.
          ownDeviceId = existingStatus.device_id;
        } else {
          const temporaryToken = token.trim();
          const temporaryStatus = await startLanSync(
            temporaryToken,
            DEFAULT_LAN_SYNC_PORT,
            'Readest',
            expectedServerGeneration,
          );
          if (temporaryStatus.started) {
            // Record the server before checking cancellation so an unmount
            // while startLanSync was pending can stop only our new server.
            temporaryServerRef.current = true;
            temporaryServerGenerationRef.current = temporaryStatus.generation;
            temporaryTokenRef.current = temporaryToken;
            expectedServerGeneration = temporaryStatus.generation;
            if (runId !== discoveryRunRef.current) {
              await cleanupDiscovery();
              return;
            }
            setStatus(temporaryStatus);
            ownDeviceId = temporaryStatus.device_id;
          } else {
            // Another manager won the stopped-to-running race. Do not claim
            // ownership or stop its server during discovery cleanup.
            ownDeviceId = temporaryStatus.device_id;
          }
        }
      }
      const found = await discoverLanPeers();
      if (runId !== discoveryRunRef.current || getLanSyncGeneration() !== expectedGeneration) {
        await cleanupDiscovery();
        return;
      }
      // The server may have come up after the initial status check. Refresh the
      // identity before filtering so this device never appears as a peer.
      if (isTauri) {
        const latestStatus = await getLanSyncStatus();
        if (runId !== discoveryRunRef.current || getLanSyncGeneration() !== expectedGeneration) {
          await cleanupDiscovery();
          return;
        }
        if (latestStatus.running) ownDeviceId = latestStatus.device_id;
      }
      const visible = ownDeviceId ? found.filter((peer) => peer.device_id !== ownDeviceId) : found;
      setPeers(visible);
    } catch (e) {
      console.warn('lan_sync discovery failed:', e);
      if (runId !== discoveryRunRef.current) return;
      await cleanupDiscovery();
      setDiscoveryFailed(true);
      setShowManualConnection(true);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to search for nearby devices'),
      });
    } finally {
      if (runId === discoveryRunRef.current) {
        if (!temporaryServerRef.current) await releaseDiscoveryLock();
        setHasSearched(true);
        setIsDiscovering(false);
      }
    }
  };

  const closePeerDiscovery = () => {
    discoveryRunRef.current += 1;
    setIsDiscovering(false);
    setShowPeerDiscovery(false);
    void cleanupDiscovery();
  };

  const restartLocalServerWithToken = async (
    nextToken: string,
    previousToken: string,
    expectedGeneration?: number,
  ) => replaceLanSyncToken(nextToken, previousToken, DEFAULT_LAN_SYNC_PORT, '', expectedGeneration);

  const handleConnect = async (target?: DiscoveredLanPeer) => {
    const trimmedHost = (target?.host ?? host).trim();
    const trimmedToken = target
      ? target.token.trim() || (target.auth_required ? token.trim() : '')
      : token.trim();
    const trimmedPort = target?.port ?? (Number(port) || DEFAULT_LAN_SYNC_PORT);
    if (target) {
      setHost(trimmedHost);
      setPort(String(trimmedPort));
      setShowManualConnection(true);
      setToken(trimmedToken);
      if (target.auth_required && !trimmedToken) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Enter the pairing token to connect'),
        });
        return;
      }
    }
    if (!trimmedHost) return;
    if (unmountedRef.current || disconnectingRef.current || connectingRef.current) return;
    connectingRef.current = true;
    const connectionRunId = ++connectionRunRef.current;
    const connectionLanGeneration = getLanSyncGeneration();
    const isConnectionCurrent = () =>
      connectionRunRef.current === connectionRunId &&
      getLanSyncGeneration() === connectionLanGeneration &&
      !disconnectingRef.current &&
      !unmountedRef.current;

    const previousSettings = useSettingsStore.getState().settings;
    const previousToken = stored?.token?.trim() || '';
    const switchingActiveToken = isActive && isTauri && previousToken !== trimmedToken;

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
    let restartedServerGeneration: number | undefined;
    let temporaryTokenForPromotion: string | null = null;
    let persistentLockAcquiredForPromotion = false;
    let expectedServerGeneration: number | undefined;
    try {
      if (isTauri) {
        const localStatus = await getLanSyncStatus();
        if (!isConnectionCurrent()) return;
        expectedServerGeneration = localStatus.generation;
      }
      const peer = await lanSyncPing({
        enabled: false,
        host: trimmedHost,
        port: trimmedPort,
        token: trimmedToken,
      });
      if (!isConnectionCurrent()) return;

      // When changing devices while LAN Sync is already active, the newly
      // discovered peer may advertise a different token. Update this device's
      // embedded server only after the new peer has accepted the token, and
      // roll the old server back if that restart itself fails.
      if (switchingActiveToken) {
        const nextStatus = await restartLocalServerWithToken(
          trimmedToken,
          previousToken,
          expectedServerGeneration,
        );
        restartedServerGeneration = nextStatus.started ? nextStatus.generation : undefined;
        if (!isConnectionCurrent()) {
          if (restartedServerGeneration !== undefined) {
            try {
              await stopLanSyncIfCurrent(restartedServerGeneration);
            } catch {
              /* another lifecycle operation may have stopped it already */
            }
          }
          return;
        }
        setStatus(nextStatus);
        restartedForSwitch = true;
      } else if (temporaryServerRef.current) {
        // Promote the temporary advertiser to the peer's token before saving
        // the connection. Otherwise startLanSync would be idempotent and leave
        // this device serving with the throwaway token it used for discovery.
        temporaryTokenForPromotion = temporaryTokenRef.current || '';
        if (needsMulticastLock) {
          // Take a persistent lease before replacing the temporary server so
          // there is no gap in multicast coverage during promotion. Keep this
          // lease until disconnect/unmount; LanSyncManager has its own lease.
          const pendingPromotionLock = setMulticastLock(true, 'lan-sync');
          promotionLockPromiseRef.current = pendingPromotionLock;
          promotionLockHeldRef.current = true;
          try {
            await pendingPromotionLock;
          } catch (e) {
            promotionLockHeldRef.current = false;
            throw e;
          } finally {
            if (promotionLockPromiseRef.current === pendingPromotionLock) {
              promotionLockPromiseRef.current = null;
            }
          }
          if (unmountedRef.current || disconnectingRef.current) {
            await cleanupDiscovery();
            await releasePromotionLock();
            return;
          }
          persistentLockAcquiredForPromotion = true;
        }
        const nextStatus = await restartLocalServerWithToken(
          trimmedToken,
          temporaryTokenForPromotion,
          expectedServerGeneration,
        );
        if (nextStatus.started) {
          temporaryServerGenerationRef.current = nextStatus.generation;
          restartedServerGeneration = nextStatus.generation;
        } else {
          temporaryServerRef.current = false;
          temporaryServerGenerationRef.current = null;
          temporaryTokenRef.current = null;
          restartedServerGeneration = undefined;
        }
        if (!isConnectionCurrent() || unmountedRef.current) {
          await cleanupDiscovery();
          await releasePromotionLock();
          return;
        }
        setStatus(nextStatus);
        restartedForSwitch = true;
      }

      if (!isConnectionCurrent()) {
        if (temporaryTokenForPromotion !== null) {
          await cleanupDiscovery();
          await releasePromotionLock();
        } else if (restartedServerGeneration !== undefined) {
          try {
            await stopLanSyncIfCurrent(restartedServerGeneration);
          } catch {
            /* another lifecycle operation may have stopped it already */
          }
        }
        return;
      }
      if (isTauri && !isActive && !temporaryServerRef.current) {
        const existingStatus = await getLanSyncStatus();
        if (!isConnectionCurrent()) return;
        if (existingStatus.running) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Another LAN Sync server is already running'),
          });
          return;
        }
      }

      try {
        // persistCloudProviderEnabled owns activation, persistence, and the
        // cross-window provider broadcast; host/port/token land before the
        // toggle flips so the first engine run sees a complete slice.
        await persistLanProvider(true, (s) => ({
          ...s,
          lan: { ...s.lan, host: trimmedHost, port: trimmedPort, token: trimmedToken },
        }));
        if (!isConnectionCurrent()) {
          if (temporaryTokenForPromotion !== null) {
            await cleanupDiscovery();
            await releasePromotionLock();
          } else if (restartedServerGeneration !== undefined) {
            try {
              await stopLanSyncIfCurrent(restartedServerGeneration);
            } catch {
              /* another lifecycle operation may have stopped it already */
            }
          }
          return;
        }
      } catch (e) {
        if (connectionRunRef.current === connectionRunId && previousSettings) {
          useSettingsStore.getState().setSettings(previousSettings);
        }
        if (restartedForSwitch && restartedServerGeneration !== undefined) {
          try {
            const rollbackToken = temporaryTokenForPromotion ?? previousToken;
            const restoredStatus = await restartLocalServerWithToken(
              rollbackToken,
              trimmedToken,
              restartedServerGeneration,
            );
            if (temporaryTokenForPromotion !== null && restoredStatus.started) {
              temporaryServerRef.current = true;
              temporaryServerGenerationRef.current = restoredStatus.generation;
              temporaryTokenRef.current = rollbackToken;
            }
            if (isConnectionCurrent()) setStatus(restoredStatus);
          } catch (rollbackError) {
            console.warn('lan_sync settings rollback start failed:', rollbackError);
          }
        }
        if (persistentLockAcquiredForPromotion) {
          await releasePromotionLock();
          persistentLockAcquiredForPromotion = false;
        }
        throw e;
      }

      if (temporaryTokenForPromotion !== null) {
        // The persistent owner was acquired before the token switch. Keep the
        // temporary owner until persistence succeeds, then release it after
        // the server is safely running with the persisted peer token.
        temporaryServerRef.current = false;
        temporaryServerGenerationRef.current = null;
        temporaryTokenRef.current = null;
        await releaseDiscoveryLock();
        // promotionLockHeldRef remains set until disconnect/unmount, while the
        // local flag only controls failure cleanup for this operation.
        persistentLockAcquiredForPromotion = false;
      }

      // Bring this device's own server up so the peer can connect back. A
      // device switch above already restarted it with the new token.
      if (isTauri && !restartedForSwitch) {
        if (!isConnectionCurrent()) return;
        try {
          const nextStatus = await startLanSync(
            trimmedToken,
            DEFAULT_LAN_SYNC_PORT,
            '',
            expectedServerGeneration,
          );
          if (!isConnectionCurrent()) {
            if (nextStatus.started) {
              try {
                await stopLanSyncIfCurrent(nextStatus.generation);
              } catch {
                /* disconnect cleanup may already have stopped it */
              }
            }
            return;
          }
          const currentLan = useSettingsStore.getState().settings?.lan;
          if (!currentLan?.enabled || (currentLan.token?.trim() ?? '') !== trimmedToken) {
            if (nextStatus.started) {
              try {
                await stopLanSyncIfCurrent(nextStatus.generation);
              } catch {
                /* another lifecycle operation may have replaced it */
              }
            }
            return;
          }
          setStatus(nextStatus);
        } catch (e) {
          if (isConnectionCurrent()) console.warn('lan_sync start failed:', e);
        }
      }

      if (!isConnectionCurrent()) return;
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
      if (persistentLockAcquiredForPromotion) {
        await releasePromotionLock();
      }
      if (!isConnectionCurrent()) return;
      if (target) setShowManualConnection(true);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatPingError(_, e)}`,
      });
    } finally {
      if (connectionRunRef.current === connectionRunId && !unmountedRef.current) {
        connectingRef.current = false;
        setIsConnecting(false);
        setConnectingPeerId(null);
      }
    }
  };

  const handleScanPairingQr = async () => {
    if (!canScanPairingQr || isConnecting) return;
    try {
      let permission = await checkPermissions();
      if (permission !== 'granted') permission = await requestPermissions();
      if (permission !== 'granted') {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Camera permission is required to scan a pairing QR code'),
        });
        return;
      }
      const result = await scan({ formats: [Format.QRCode], windowed: true });
      const pairing = parseLanSyncPairingPayload(result.content);
      if (!pairing) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Invalid Readest LAN pairing QR code'),
        });
        return;
      }
      await handleConnect({
        name: 'Readest',
        host: pairing.hosts[0],
        port: pairing.port,
        device_id: `qr:${pairing.hosts[0]}`,
        token: pairing.token,
        auth_required: !!pairing.token,
      });
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to scan pairing QR code'),
      });
    }
  };

  const handleDisconnect = async () => {
    if (unmountedRef.current || disconnectingRef.current) return;
    disconnectingRef.current = true;
    connectionRunRef.current += 1;
    connectingRef.current = false;
    // Update the local setting before any asynchronous cleanup so
    // LanSyncManager cancels boot/start work before the server is stopped.
    const currentSettings = useSettingsStore.getState().settings;
    if (currentSettings) {
      setSettings({
        ...currentSettings,
        lan: { ...currentSettings.lan, enabled: false },
      });
    }
    discoveryRunRef.current += 1;
    setIsDiscovering(false);
    await cleanupDiscovery();
    // Stop the server before dropping its persistent multicast lease. The
    // peer config stays so a later reconnect is one click.
    if (isTauriAppPlatform()) {
      try {
        await stopLanSync();
      } catch (e) {
        console.warn('lan_sync stop failed:', e);
        await releasePromotionLock();
        if (currentSettings) setSettings(currentSettings);
        disconnectingRef.current = false;
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to stop LAN Sync. Your connection is still active.'),
        });
        return;
      }
    }
    // Switch LAN sync off only — other providers keep syncing. Restore the
    // prior setting on a persistence failure so disk and memory stay aligned.
    try {
      await persistLanProvider(false);
    } catch (e) {
      console.warn('lan_sync disconnect persistence failed:', e);
      await releasePromotionLock();
      if (currentSettings) setSettings(currentSettings);
      disconnectingRef.current = false;
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to save the disconnected state. Please try again.'),
      });
      return;
    }
    await releasePromotionLock();
    disconnectingRef.current = false;
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

  const pairingQrValue =
    isTauri && status?.running
      ? createLanSyncPairingPayload(status, stored?.token?.trim() ?? '')
      : '';

  const manualConnectionForm = (
    <div className='space-y-4 pt-4'>
      {canScanPairingQr && (
        <button
          type='button'
          onClick={() => void handleScanPairingQr()}
          disabled={isConnecting}
          className={clsx(
            'btn btn-contrast h-11 min-h-11 w-full rounded-lg border-0 text-sm font-medium',
            'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
            isConnecting && 'opacity-60',
          )}
        >
          {_('Scan PC pairing QR code')}
        </button>
      )}
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
            {_('Pairing Token (optional)')}
          </SectionTitle>
          <button
            type='button'
            onClick={() => setToken(generateLanSyncToken())}
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
            placeholder={_('Leave blank for local network only')}
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
          disabled={isConnecting || !host.trim()}
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
                onClick={showPeerDiscovery ? closePeerDiscovery : openPeerDiscovery}
                disabled={isConnecting}
                className='btn btn-ghost btn-sm h-9 min-h-9 shrink-0 px-3 text-xs'
              >
                {showPeerDiscovery ? _('Cancel') : _('Find another device')}
              </button>
            </SettingsRow>
          </BoxedList>

          {stored?.token && (
            <BoxedList title={_('Pairing Token')}>
              <SettingsRow
                label={
                  <span className='font-mono text-sm'>
                    {showToken ? stored.token : '•'.repeat(Math.min(stored.token.length, 32))}
                  </span>
                }
                description={_('Same token on both devices')}
              >
                <div className='flex shrink-0 items-center gap-1'>
                  <button
                    type='button'
                    onClick={() => void copyPairingToken()}
                    className={clsx(
                      'text-base-content/60 hover:text-base-content flex h-9 w-9 items-center justify-center rounded-sm',
                      'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                    )}
                    aria-label={_('Copy')}
                    title={_('Copy')}
                  >
                    <MdContentCopy className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => setShowToken((value) => !value)}
                    className={clsx(
                      'text-base-content/60 hover:text-base-content flex h-9 w-9 items-center justify-center rounded-sm',
                      'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                    )}
                    aria-label={showToken ? _('Hide password') : _('Show password')}
                    title={showToken ? _('Hide password') : _('Show password')}
                  >
                    {showToken ? (
                      <MdVisibilityOff className='h-5 w-5' />
                    ) : (
                      <MdVisibility className='h-5 w-5' />
                    )}
                  </button>
                </div>
              </SettingsRow>
            </BoxedList>
          )}

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

        {pairingQrValue && (
          <BoxedList title={_('Pairing QR code')}>
            <SettingsRow
              label={_('Scan this code on your phone')}
              description={_("It contains this device's LAN address and optional pairing token.")}
            />
            <div className='flex justify-center bg-white p-4'>
              <QRCodeSVG value={pairingQrValue} size={220} level='M' includeMargin />
            </div>
          </BoxedList>
        )}

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
