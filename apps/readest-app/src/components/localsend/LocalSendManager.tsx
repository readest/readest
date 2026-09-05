import React, { useCallback, useEffect, useRef, useState } from 'react';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useLocalSendStore } from '@/store/localsendStore';
import { isTauriAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import { isNearbyPairingAllowed } from '@/utils/access';
import {
  DEFAULT_ALIAS_NAMED_KEY,
  getLocalSendAlias,
  isLocalSendEnabled,
} from '@/services/localsend/devicePrefs';
import {
  addPairedDevice,
  canAutoAccept,
  refreshPairedDevice,
} from '@/services/localsend/pairedDevices';
import { playTransferCue, primeTransferCues } from '@/services/localsend/sounds';
import {
  cancelLocalSendReceive,
  isLocalSendAlive,
  respondLocalSend,
  setLocalSendDiscoverable,
  startLocalSend,
  stopLocalSend,
} from '@/services/localsend/service';
import { partitionSupportedFiles } from '@/services/localsend/formats';
import { localSendDeviceModel } from '@/services/localsend/deviceModel';
import {
  LOCALSEND_EVENTS,
  type LocalSendStatus,
  type ReceiveEnd,
  type ReceiveFileDone,
  type ReceiveRequest,
  type SendEnd,
  type SendFileInput,
  type TransferProgress,
  type LocalSendDevice,
} from '@/services/localsend/types';
import { eventDispatcher } from '@/utils/event';
import { setMulticastLock } from '@/utils/bridge';
import { resolveBookSendFile } from '@/services/localsend/bookFile';
import type { Book } from '@/types/book';
import DevicePickerDialog from './DevicePickerDialog';
import ReceiveRequestDialog from './ReceiveRequestDialog';

interface ServerStatePayload {
  running: boolean;
  port: number;
  error: string | null;
}

/**
 * Background controller for the LocalSend integration. Mounted in the library
 * and reader shells (Tauri only): starts/stops the Rust service to match the
 * per-device preference, feeds `localsend:*` events into the store, imports
 * received books, and renders the incoming-request and device-picker dialogs.
 *
 * Multi-window: every window shows the incoming-request dialog; the window
 * whose respond call claims the session becomes its owner and is the only one
 * that ingests files and reports progress (store `ownedSessions` rules).
 */
const LocalSendManager: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  // Read the translator at call time so the default alias localizes without
  // rebuilding `defaultAlias` (and restarting the service) on every render.
  const translateRef = useRef(_);
  translateRef.current = _;

  const pendingRequest = useLocalSendStore((state) => state.pendingRequest);
  const [sendFiles, setSendFiles] = useState<SendFileInput[] | null>(null);

  // Pairing entitlement, checked at receive time so a lapsed plan brings the
  // confirmation dialogs back while the pairing records stay intact.
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const pairingEntitled = isNearbyPairingAllowed(userProfilePlan ?? 'free', customizationPurchased);

  const toast = useCallback(
    (message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') =>
      eventDispatcher.dispatch('toast', { message, type, timeout: 3000 }),
    [],
  );

  const cueOpts = useCallback(
    () => ({ eink: !!useSettingsStore.getState().settings?.globalViewSettings?.isEink }),
    [],
  );

  const haptic = useCallback(() => {
    if (!appService?.hasHaptics) return;
    try {
      void impactFeedback('medium').catch(() => {});
    } catch {
      /* haptics are best-effort */
    }
  }, [appService]);

  // Webview autoplay policies block sounds that fire without a user gesture
  // (transfer complete, auto-accepted receives); unlock the cue elements on
  // the first gesture. A session with no gesture at all degrades to
  // toast + haptic, which is the accepted floor.
  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    const prime = () => primeTransferCues();
    window.addEventListener('pointerdown', prime, { once: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, []);

  const defaultAlias = useCallback(async (): Promise<string> => {
    // Prefer the signed-in user's name, AirDrop style: "<name>'s Readest".
    // Match the library main menu ("Logged in as {{name}}"): first name only.
    const fullName: unknown = userRef.current?.user_metadata?.['full_name'];
    if (typeof fullName === 'string' && fullName.trim()) {
      const name = fullName.trim().split(' ')[0];
      return translateRef.current(DEFAULT_ALIAS_NAMED_KEY, { name });
    }
    try {
      const { hostname } = await import('@tauri-apps/plugin-os');
      const name = await hostname();
      if (name) return name;
    } catch {
      /* fall through to the generic default */
    }
    return 'Readest';
  }, []);

  // Service lifecycle: match the running state to the per-device preference.
  // The service intentionally survives unmounts (route changes); only the
  // preference toggle stops it.
  const syncServiceState = useCallback(async () => {
    if (!isTauriAppPlatform() || !appService) return;
    try {
      if (isLocalSendEnabled()) {
        if (appService.isAndroidApp) await setMulticastLock(true).catch(() => {});
        const alias = getLocalSendAlias() || (await defaultAlias());
        // Tauri reports iPad and iPhone both as `ios`; split on the shorter
        // screen edge (iPads are >= 600pt, all iPhones are narrower).
        const isTablet =
          typeof screen !== 'undefined' && Math.min(screen.width, screen.height) >= 600;
        const deviceModel = localSendDeviceModel(appService.osPlatform, isTablet);
        const status = await startLocalSend(alias, deviceModel);
        useLocalSendStore.getState().setStatus(status);
      } else {
        await stopLocalSend();
        if (appService.isAndroidApp) await setMulticastLock(false).catch(() => {});
        useLocalSendStore.getState().setStatus(null);
      }
    } catch (err) {
      console.error('LocalSend service state change failed:', err);
    }
  }, [appService, defaultAlias]);

  useEffect(() => {
    void syncServiceState();
    const onPrefsChanged = () => void syncServiceState();
    eventDispatcher.on('localsend-prefs-changed', onPrefsChanged);
    return () => eventDispatcher.off('localsend-prefs-changed', onPrefsChanged);
  }, [syncServiceState]);

  // AirDrop-style presence: this device is discoverable only while its screen
  // is on and Readest is in the foreground. Locking the screen or backgrounding
  // the app fires `visibilitychange` -> hidden (on both mobile and desktop),
  // so we stop answering announcements and peers drop us from their pickers
  // within a few seconds; returning to the foreground re-announces us at once.
  // This is presence only - the service keeps running, nothing disconnects.
  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    const sync = async () => {
      if (!isLocalSendEnabled()) return;
      const visible = document.visibilityState === 'visible';
      if (!visible) {
        void setLocalSendDiscoverable(false).catch(() => {});
        return;
      }
      // The OS can reclaim a backgrounded app's listening socket (iOS). When
      // the core notices, it tears the dead service down and reports
      // running:false - but iOS never wakes the accept loop to notice, so the
      // status stays running:true on a service no peer can reach (the picker
      // showed nothing until the user toggled the setting off and on). Trust a
      // liveness probe, not the stored flag, and rebuild the service when it
      // fails: `stop` first, or `start` would hand back the dead one.
      if (!(await isLocalSendAlive().catch(() => false))) {
        await stopLocalSend().catch(() => {});
        void syncServiceState();
        return;
      }
      void setLocalSendDiscoverable(true).catch(() => {});
    };
    const onVisibilityChange = () => void sync();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [syncServiceState]);

  // The alias change flow restarts the service (stop, then start with the new
  // alias). The settings form dispatches 'localsend-alias-changed' for this.
  useEffect(() => {
    const onAliasChanged = async () => {
      if (!isTauriAppPlatform() || !isLocalSendEnabled()) return;
      try {
        await stopLocalSend();
      } catch {
        /* it may not have been running */
      }
      void syncServiceState();
    };
    eventDispatcher.on('localsend-alias-changed', onAliasChanged);
    return () => eventDispatcher.off('localsend-alias-changed', onAliasChanged);
  }, [syncServiceState]);

  // Send entry point: the library dispatches the selected books; resolve
  // their on-disk files here and open the device picker.
  useEffect(() => {
    const onSendBooks = async (event: CustomEvent) => {
      if (!appService) return;
      const { books } = event.detail as { books: Book[] };
      if (!books?.length) return;
      const resolved: SendFileInput[] = [];
      for (const book of books) {
        const file = await resolveBookSendFile(book, appService);
        if (file) resolved.push(file);
      }
      if (resolved.length === 0) {
        toast(_('Book file is not available locally'), 'warning');
        return;
      }
      if (resolved.length < books.length) {
        toast(
          _('{{count}} book(s) skipped (not on this device)', {
            count: books.length - resolved.length,
          }),
          'warning',
        );
      }
      setSendFiles(resolved);
    };
    eventDispatcher.on('localsend-send-books', onSendBooks);
    return () => eventDispatcher.off('localsend-send-books', onSendBooks);
  }, [appService, toast, _]);

  const onFileDone = useCallback(
    async (payload: ReceiveFileDone) => {
      const owned = useLocalSendStore.getState().ownedSessions[payload.sessionId];
      if (!owned || !appService) return;
      if (payload.error || !payload.path) return; // failures are summarized on receive-end
      try {
        const { library } = useLibraryStore.getState();
        const book = await ingestFile(
          { file: payload.path, books: library, forceCopy: true },
          {
            appService,
            settings: useSettingsStore.getState().settings,
            isLoggedIn: !!userRef.current,
          },
        );
        if (book) await useLibraryStore.getState().updateBooks(envConfig, [book]);
        await appService.deleteFile(payload.path, 'None').catch(() => {});
      } catch (err) {
        console.error('LocalSend import failed:', err);
        toast(_('Failed to import {{filename}}', { filename: payload.fileName }), 'error');
      }
    },
    [appService, envConfig, toast, _],
  );

  // Tauri event subscriptions. Cleanup resolves the listen promises and calls
  // every unlisten; the effect is allowed to re-run (no one-shot guards, see
  // useAppUrlIngress for the strict-mode rationale).
  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    let disposed = false;
    const unlisteners: Promise<() => void>[] = [];
    const subscribe = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (disposed) return;
      const store = () => useLocalSendStore.getState();
      unlisteners.push(
        listen<ServerStatePayload>(LOCALSEND_EVENTS.serverState, (event) => {
          const current = store().status;
          store().setStatus({
            running: event.payload.running,
            port: event.payload.port,
            alias: current?.alias ?? '',
            fingerprint: current?.fingerprint ?? '',
            deviceModel: current?.deviceModel ?? '',
            localIps: current?.localIps ?? [],
            multicastError: current?.multicastError ?? null,
            ...(event.payload.error ? { multicastError: event.payload.error } : {}),
          } as LocalSendStatus);
        }),
        listen<{ devices: LocalSendDevice[] }>(LOCALSEND_EVENTS.devices, (event) => {
          store().setDevices(event.payload.devices);
        }),
        listen<ReceiveRequest>(LOCALSEND_EVENTS.receiveRequest, (event) => {
          store().requestReceived(event.payload);
        }),
        listen<{ sessionId: string }>(LOCALSEND_EVENTS.receiveRequestClosed, (event) => {
          store().requestClosed(event.payload.sessionId);
        }),
        listen<TransferProgress>(LOCALSEND_EVENTS.receiveProgress, (event) => {
          store().receiveProgress(event.payload);
        }),
        listen<ReceiveFileDone>(LOCALSEND_EVENTS.receiveFileDone, (event) => {
          void onFileDone(event.payload);
        }),
        listen<ReceiveEnd>(LOCALSEND_EVENTS.receiveEnd, (event) => {
          const { sessionId, reason, received, failed } = event.payload;
          const owned = store().ownedSessions[sessionId];
          store().receiveEnded(sessionId);
          if (!owned) return;
          if (reason === 'cancelled') {
            toast(_('Transfer from {{alias}} cancelled', { alias: owned.alias }));
          } else if (failed > 0) {
            playTransferCue('fail', cueOpts());
            haptic();
            toast(
              _('Received {{count}} book(s) from {{alias}}, {{failed}} failed', {
                count: received,
                alias: owned.alias,
                failed,
              }),
              'warning',
            );
          } else {
            playTransferCue('done', cueOpts());
            haptic();
            toast(
              _('Received {{count}} book(s) from {{alias}}', {
                count: received,
                alias: owned.alias,
              }),
              'success',
            );
          }
        }),
        listen<TransferProgress>(LOCALSEND_EVENTS.sendProgress, (event) => {
          store().sendProgress(event.payload);
        }),
        listen<SendEnd>(LOCALSEND_EVENTS.sendEnd, (event) => {
          const sendState = store().sendState;
          store().sendEnded();
          if (!sendState) return; // another window's transfer
          const { status, error, filesSent } = event.payload;
          if (status === 'sent') {
            toast(
              _('Sent {{count}} book(s) to {{alias}}', {
                count: filesSent,
                alias: sendState.deviceAlias,
              }),
              'success',
            );
          } else if (status === 'declined') {
            toast(_('{{alias}} declined the transfer', { alias: sendState.deviceAlias }));
          } else if (status === 'cancelled') {
            toast(_('Transfer cancelled'));
          } else {
            toast(error || _('Transfer failed'), 'error');
          }
        }),
      );
    };
    void subscribe();
    return () => {
      disposed = true;
      unlisteners.forEach((promise) => {
        promise.then((unlisten) => unlisten()).catch(() => {});
      });
    };
  }, [appService, onFileDone, toast, _, cueOpts, haptic]);

  // A request with no importable files is declined without a dialog.
  useEffect(() => {
    if (!pendingRequest) return;
    const { supported } = partitionSupportedFiles(pendingRequest.files);
    if (supported.length > 0) return;
    const { sessionId, sender } = pendingRequest;
    useLocalSendStore.getState().requestClosed(sessionId);
    void respondLocalSend(sessionId, null);
    toast(_('No supported book files from {{alias}}', { alias: sender.alias }), 'warning');
  }, [pendingRequest, toast, _]);

  // Paired auto-accept: a cert-verified, paired sender skips the dialog.
  // Every window runs this; the respond call claims the session for exactly
  // one of them (the same ownership rule as a manual accept).
  useEffect(() => {
    if (!pendingRequest) return;
    const { supported } = partitionSupportedFiles(pendingRequest.files);
    if (supported.length === 0) return; // the decline effect handles these
    const { sessionId, sender } = pendingRequest;
    if (!canAutoAccept(sender, pairingEntitled)) return;
    refreshPairedDevice(sender.fingerprint, sender.alias, sender.deviceModel);
    useLocalSendStore.getState().requestClosed(sessionId);
    void (async () => {
      const claimed = await respondLocalSend(
        sessionId,
        supported.map((file) => file.id),
      );
      if (claimed) {
        useLocalSendStore.getState().claimSession(sessionId, sender.alias);
        toast(_('Receiving from paired device {{alias}}', { alias: sender.alias }));
        playTransferCue('start', cueOpts());
        haptic();
      }
    })();
  }, [pendingRequest, pairingEntitled, toast, _, cueOpts, haptic]);

  if (!isTauriAppPlatform()) return null;

  const showRequestDialog =
    pendingRequest &&
    partitionSupportedFiles(pendingRequest.files).supported.length > 0 &&
    // Auto-accepted requests never flash the dialog; the effect above answers.
    !canAutoAccept(pendingRequest.sender, pairingEntitled);

  return (
    <>
      {showRequestDialog && (
        <ReceiveRequestDialog
          request={pendingRequest}
          onAccept={async (fileIds, pairDevice) => {
            const { sessionId, sender } = pendingRequest;
            if (pairDevice && sender.certVerified) {
              addPairedDevice({
                fingerprint: sender.fingerprint,
                alias: sender.alias,
                deviceModel: sender.deviceModel,
              });
            }
            useLocalSendStore.getState().requestClosed(sessionId);
            const claimed = await respondLocalSend(sessionId, fileIds);
            if (claimed) {
              useLocalSendStore.getState().claimSession(sessionId, sender.alias);
            }
          }}
          onDecline={() => {
            const { sessionId } = pendingRequest;
            useLocalSendStore.getState().requestClosed(sessionId);
            void respondLocalSend(sessionId, null);
          }}
        />
      )}
      {sendFiles && <DevicePickerDialog files={sendFiles} onClose={() => setSendFiles(null)} />}
      <TransferProgressCard onCancelReceive={(id) => void cancelLocalSendReceive(id)} />
    </>
  );
};

/** Compact fixed card summarizing this window's active receive sessions. */
const TransferProgressCard: React.FC<{ onCancelReceive: (sessionId: string) => void }> = ({
  onCancelReceive,
}) => {
  const _ = useTranslation();
  const ownedSessions = useLocalSendStore((state) => state.ownedSessions);
  const entries = Object.entries(ownedSessions);
  if (entries.length === 0) return null;
  return (
    <div className='fixed bottom-4 right-4 z-40 flex flex-col gap-2'>
      {entries.map(([sessionId, session]) => {
        const progress = session.progress;
        const percent = progress?.bytesTotal
          ? Math.floor((progress.bytesDone / progress.bytesTotal) * 100)
          : 0;
        return (
          <div
            key={sessionId}
            className='eink-bordered bg-base-300 flex w-64 flex-col gap-1.5 rounded-lg p-3 shadow-lg'
          >
            <div className='flex items-center justify-between gap-2 text-sm'>
              <span className='truncate'>
                {_('Receiving from {{alias}}', { alias: session.alias })}
              </span>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => onCancelReceive(sessionId)}
              >
                {_('Cancel')}
              </button>
            </div>
            <progress className='progress w-full' value={percent} max={100} />
          </div>
        );
      })}
    </div>
  );
};

export default LocalSendManager;
