import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { MdRefresh, MdComputer, MdSmartphone, MdDevices } from 'react-icons/md';
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

/**
 * Target picker for "Send to Nearby Device": lists discovered LocalSend
 * peers, refreshes discovery on demand, and shows this window's send
 * progress with a cancel action once a transfer starts.
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
    useLocalSendStore.getState().startSend(device.alias);
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

  return (
    <div
      className='localsend-device-picker fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4'
      style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px` }}
    >
      <div
        className={clsx(
          'eink-bordered bg-base-300 flex flex-col gap-3 rounded-lg p-4 shadow-2xl',
          'w-full max-w-md sm:max-w-lg',
        )}
      >
        <div className='flex items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>
            {_('Send {{count}} book(s) to nearby device', { count: files.length })}
          </h3>
          {status?.running && !sendState && (
            <button
              type='button'
              className={clsx('btn btn-ghost btn-xs', refreshing && 'btn-disabled')}
              aria-label={_('Refresh devices')}
              onClick={() => void refresh()}
            >
              <MdRefresh className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          )}
        </div>

        {!status?.running ? (
          <div className='flex flex-col items-start gap-2 text-sm'>
            <span>{_('Enable LocalSend in Settings to send books.')}</span>
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              onClick={openLocalSendSettings}
            >
              {_('Open Settings')}
            </button>
          </div>
        ) : sendState ? (
          <div className='flex flex-col gap-2 text-sm'>
            <span className='truncate'>
              {_('Sending to {{alias}}', { alias: sendState.deviceAlias })}
            </span>
            <progress className='progress w-full' value={percent} max={100} />
            <div className='flex justify-end'>
              <button
                type='button'
                className='btn btn-sm btn-neutral'
                onClick={() => void cancelLocalSendSend()}
              >
                {_('Cancel')}
              </button>
            </div>
          </div>
        ) : devices.length === 0 ? (
          <div className='text-base-content/70 text-sm'>
            {_('No devices found. Make sure LocalSend is open on the other device.')}
          </div>
        ) : (
          <div className='flex max-h-64 flex-col gap-1 overflow-y-auto'>
            {devices.map((device) => {
              const Icon = deviceIcon(device.deviceType);
              return (
                <button
                  key={device.fingerprint}
                  type='button'
                  className={clsx(
                    'eink-bordered bg-base-100 flex items-center gap-3 rounded-lg px-3 py-2 text-left',
                    'hover:bg-base-200 transition-colors',
                  )}
                  onClick={() => void pickDevice(device)}
                >
                  <Icon className='text-base-content/70 h-5 w-5 shrink-0' />
                  <div className='flex min-w-0 flex-col'>
                    <span className='truncate text-sm'>{device.alias}</span>
                    <span className='text-base-content/60 truncate text-xs'>
                      {[ipTag(device.ipv4Host ?? device.host), device.deviceModel]
                        .filter(Boolean)
                        .join(' ') || device.host}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
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
  );
};

export default DevicePickerDialog;
