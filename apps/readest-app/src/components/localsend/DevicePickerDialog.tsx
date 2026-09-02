import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  MdRefresh,
  MdComputer,
  MdSmartphone,
  MdDevices,
  MdLink,
  MdCheck,
  MdMenuBook,
} from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLocalSendStore } from '@/store/localsendStore';
import {
  announceLocalSend,
  cancelLocalSendSend,
  listLocalSendDevices,
  sendLocalSendFiles,
} from '@/services/localsend/service';
import { ipTag } from '@/services/localsend/deviceModel';
import { isPairedDevice } from '@/services/localsend/pairedDevices';
import { previewDataUrl } from '@/services/localsend/preview';
import type { LocalSendDevice, SendFileInput } from '@/services/localsend/types';

interface DevicePickerDialogProps {
  files: SendFileInput[];
  onClose: () => void;
}

const deviceIcon = (deviceType: string | null) => {
  if (deviceType === 'mobile') return MdSmartphone;
  if (deviceType === 'desktop') return MdComputer;
  return MdDevices;
};

/** SVG progress ring drawn around a peer circle during a send. */
const ProgressRing: React.FC<{ percent: number; done: boolean }> = ({ percent, done }) => {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      viewBox='0 0 64 64'
      className='pointer-events-none absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)]'
      aria-hidden='true'
    >
      <circle
        cx='32'
        cy='32'
        r={radius}
        fill='none'
        strokeWidth='3'
        className='stroke-base-content/15'
      />
      <circle
        cx='32'
        cy='32'
        r={radius}
        fill='none'
        strokeWidth='3'
        strokeLinecap='round'
        transform='rotate(-90 32 32)'
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(percent, 100) / 100)}
        className={clsx('stroke-current', done && 'text-success')}
      />
    </svg>
  );
};

interface PeerTileProps {
  device: LocalSendDevice;
  paired: boolean;
  dimmed: boolean;
  sending: boolean;
  percent: number;
  done: boolean;
  onPick: () => void;
}

/** AirDrop-style peer: a large circular avatar with the name underneath. */
const PeerTile: React.FC<PeerTileProps> = ({
  device,
  paired,
  dimmed,
  sending,
  percent,
  done,
  onPick,
}) => {
  const Icon = deviceIcon(device.deviceType);
  const tag =
    [ipTag(device.ipv4Host ?? device.host), device.deviceModel].filter(Boolean).join(' ') ||
    device.host;
  return (
    <button
      type='button'
      className={clsx(
        'animate-localsend-pop-in flex w-20 flex-col items-center gap-1',
        dimmed && 'pointer-events-none opacity-40',
      )}
      onClick={onPick}
      aria-label={device.alias}
    >
      <span className='relative grid h-16 w-16 place-items-center'>
        <span
          className={clsx(
            'eink-bordered bg-base-100 grid h-16 w-16 place-items-center rounded-full shadow-md',
            'hover:bg-base-200 transition-colors',
          )}
        >
          {sending && done ? (
            <MdCheck className='text-success h-7 w-7' />
          ) : (
            <Icon className='text-base-content/70 h-7 w-7' />
          )}
        </span>
        {sending && <ProgressRing percent={percent} done={done} />}
        {paired && !sending && (
          <span
            className={clsx(
              'eink-bordered bg-base-100 absolute -bottom-0.5 -end-0.5 grid h-5 w-5',
              'place-items-center rounded-full shadow-sm',
            )}
            title='paired'
          >
            <MdLink className='text-base-content/70 h-3 w-3' />
          </span>
        )}
      </span>
      <span className='w-full truncate text-center text-xs'>{device.alias}</span>
      <span className='text-base-content/60 -mt-1 w-full truncate text-center text-[10px]'>
        {tag}
      </span>
    </button>
  );
};

/**
 * Target picker for "Send to Nearby Device", AirDrop-style: an identity
 * header (this device, plus a preview of the books being sent), discovered
 * peers as large circular avatars in a wrapping grid, and transfer progress
 * drawn as a ring on the target's circle. Scanning ripples show only while
 * the peer list is empty. Ripples and pop-ins are decoration — disabled on
 * e-ink and under reduced motion (globals.css).
 */
const DevicePickerDialog: React.FC<DevicePickerDialogProps> = ({ files, onClose }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const devices = useLocalSendStore((state) => state.devices);
  const status = useLocalSendStore((state) => state.status);
  const sendState = useLocalSendStore((state) => state.sendState);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // The HTTP subnet scan covers peers multicast cannot reach: iOS has no
      // multicast entitlement, and another LocalSend instance on this host
      // can hold the multicast port exclusively. Scan whenever multicast is
      // not proven to work (empty list) rather than only on iOS.
      const scan =
        appService?.isIOSApp === true || useLocalSendStore.getState().devices.length === 0;
      await announceLocalSend(scan);
      const listed = await listLocalSendDevices();
      useLocalSendStore.getState().setDevices(listed);
    } catch (err) {
      console.warn('LocalSend refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [appService]);

  useEffect(() => {
    if (status?.running) void refresh();
  }, [status?.running, refresh]);

  // Presence heartbeat: while the picker is open, re-announce on a short
  // interval (multicast only, no subnet scan) and re-read the device list.
  // Live peers keep answering, so they stay; a peer that locked its screen
  // stops answering and the Rust side prunes it past its presence TTL, so it
  // disappears within a few seconds - and reappears within one beat when it
  // wakes. Paused while a send is in flight (the target tile must stay put)
  // and while the app is hidden (nothing to show, and we go silent anyway).
  const HEARTBEAT_MS = 1500;
  useEffect(() => {
    if (!status?.running || sendState) return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // A beat can outlast HEARTBEAT_MS on a multicast-hostile network (the list
      // read waits on unicast reprobes); skip overlapping runs.
      if (inFlight) return;
      inFlight = true;
      try {
        await announceLocalSend(false);
        const listed = await listLocalSendDevices();
        // The read is async: a send may have started, or the dialog closed,
        // while it was in flight. Don't clobber the frozen list in either case.
        if (!cancelled && !useLocalSendStore.getState().sendState) {
          useLocalSendStore.getState().setDevices(listed);
        }
      } catch {
        /* transient; the next beat retries */
      } finally {
        inFlight = false;
      }
    };
    const id = setInterval(() => void tick(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status?.running, sendState]);

  // Close once the transfer this dialog started has ended (the manager
  // shows the outcome toast).
  const startedRef = React.useRef(false);
  useEffect(() => {
    if (sendState) {
      startedRef.current = true;
    } else if (startedRef.current) {
      onClose();
    }
  }, [sendState, onClose]);

  const openLocalSendSettings = () => {
    const { setRequestedPanel, setRequestedSubPage, setSettingsDialogOpen } =
      useSettingsStore.getState();
    setRequestedPanel('Integrations');
    setRequestedSubPage('localsend');
    setSettingsDialogOpen(true);
    onClose();
  };

  const pickDevice = async (device: LocalSendDevice) => {
    if (sendState) return;
    // The sender watches the progress ring here; transfer cues are the
    // receiver's ambient notification only, so nothing is played on send.
    useLocalSendStore.getState().startSend(device.alias, device.fingerprint);
    try {
      await sendLocalSendFiles(device.fingerprint, files);
    } catch (err) {
      useLocalSendStore.getState().sendEnded();
      console.error('LocalSend send failed:', err);
    }
  };

  const percent = sendState?.progress?.bytesTotal
    ? Math.floor((sendState.progress.bytesDone / sendState.progress.bytesTotal) * 100)
    : 0;

  const cover = files.map((file) => previewDataUrl(file.preview ?? null)).find(Boolean);
  // This device's own glyph — a single, centered device icon reads cleaner
  // than the two-device combo glyph and matches the peer tiles.
  const SelfIcon = appService?.isAndroidApp || appService?.isIOSApp ? MdSmartphone : MdComputer;

  return (
    <div className='localsend-device-picker fixed inset-0 z-50'>
      {/* Fullscreen scrim: blocks the library behind the sheet so no other
          book can be selected while picking a target. Tapping it closes the
          picker, except mid-transfer (matching the Close button). */}
      <div
        className='absolute inset-0 bg-black/50'
        aria-hidden='true'
        onClick={sendState ? undefined : onClose}
      />
      <div
        className='absolute bottom-0 left-0 right-0 flex justify-center px-4'
        style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px` }}
      >
        <div
          className={clsx(
            'eink-bordered bg-base-300 relative flex flex-col gap-3 rounded-lg p-4 shadow-2xl',
            'w-full max-w-md sm:max-w-lg',
          )}
        >
          {/* AirDrop-style identity header: this device on the start side, the
            books being sent on the end side. */}
          <div className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <span className='bg-base-content/10 eink-bordered grid h-11 w-11 shrink-0 place-items-center rounded-full'>
                <SelfIcon className='text-base-content/80 h-[22px] w-[22px]' />
              </span>
              <div className='flex min-w-0 flex-col'>
                <h3 className='truncate text-sm font-semibold'>{_('Nearby BookDrop')}</h3>
                {status?.alias && (
                  <span className='text-base-content/60 truncate text-xs'>
                    {_('As {{alias}}', { alias: status.alias })}
                  </span>
                )}
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              {status?.running && !sendState && (
                <button
                  type='button'
                  className={clsx('btn btn-ghost btn-circle btn-sm', refreshing && 'btn-disabled')}
                  aria-label={_('Refresh devices')}
                  onClick={() => void refresh()}
                >
                  <MdRefresh className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
                </button>
              )}
              <span className='relative'>
                {cover ? (
                  <img
                    src={cover}
                    alt=''
                    className='eink-bordered h-12 w-9 rounded-sm object-cover shadow-sm'
                  />
                ) : (
                  <span className='bg-base-content/10 eink-bordered grid h-12 w-9 place-items-center rounded-sm'>
                    <MdMenuBook className='text-base-content/50 h-4 w-4' />
                  </span>
                )}
                {files.length > 1 && (
                  <span className='bg-base-100 eink-bordered text-base-content absolute -bottom-1.5 -end-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-medium shadow-sm'>
                    +{files.length - 1}
                  </span>
                )}
              </span>
            </div>
          </div>

          {!status?.running ? (
            <div className='flex flex-col items-start gap-2 text-sm'>
              <span>{_('Enable Nearby BookDrop in Settings to send books.')}</span>
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                onClick={openLocalSendSettings}
              >
                {_('Open Settings')}
              </button>
            </div>
          ) : devices.length === 0 ? (
            <div className='relative grid h-60 w-full place-items-center overflow-hidden'>
              {/* Scanning ripples while no peer is visible yet. */}
              <div className='pointer-events-none absolute inset-0' aria-hidden='true'>
                {[0, 0.8, 1.6].map((delay) => (
                  <span
                    key={delay}
                    className={clsx(
                      'animate-localsend-ripple border-base-content/25 absolute left-1/2 top-1/2',
                      'h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border',
                    )}
                    style={{ animationDelay: `${-delay}s` }}
                  />
                ))}
              </div>
              <span className='text-base-content/70 relative px-6 text-center text-sm'>
                {_(
                  'No devices found. Make sure Nearby BookDrop or LocalSend is open on the other device.',
                )}
              </span>
            </div>
          ) : (
            <div
              className={clsx(
                'flex h-60 w-full flex-wrap content-start items-start gap-4',
                'overflow-y-auto px-1 py-3',
              )}
            >
              {devices.map((device) => {
                const isTarget = sendState?.deviceFingerprint === device.fingerprint;
                return (
                  <PeerTile
                    key={device.fingerprint}
                    device={device}
                    paired={isPairedDevice(device.fingerprint)}
                    dimmed={!!sendState && !isTarget}
                    sending={!!sendState && isTarget}
                    percent={percent}
                    done={!!sendState && isTarget && percent >= 100}
                    onPick={() => void pickDevice(device)}
                  />
                );
              })}
            </div>
          )}

          {status?.running && sendState && (
            <div className='flex items-center justify-between gap-2 text-sm'>
              <span className='truncate'>
                {_('Sending to {{alias}}', { alias: sendState.deviceAlias })} · {percent}%
              </span>
              <button
                type='button'
                className='btn btn-sm btn-neutral'
                onClick={() => void cancelLocalSendSend()}
              >
                {_('Cancel')}
              </button>
            </div>
          )}

          {!sendState && (
            <p className='text-base-content/50 select-none px-1 text-center text-xs'>
              {_('Keep this screen on so nearby devices can find you.')}
            </p>
          )}

          {!sendState && (
            <div className='flex justify-end'>
              <button type='button' className='btn btn-sm btn-neutral' onClick={onClose}>
                {_('Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevicePickerDialog;
