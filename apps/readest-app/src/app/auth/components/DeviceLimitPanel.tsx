import { useState } from 'react';
import Image from 'next/image';
import { useTranslation } from '@/hooks/useTranslation';
import type { SyncDevice } from '@/utils/syncDevices';
import SyncDeviceList from '@/components/SyncDeviceList';

interface DeviceLimitPanelProps {
  devices: SyncDevice[];
  limit: number;
  onSignOut: (device: SyncDevice) => Promise<void>;
  onCancel: () => void;
}

/**
 * Shown in place of the sign-in form when a Free plan is already signed in on
 * as many devices as it syncs on: sign one of them out to sign in here.
 */
export default function DeviceLimitPanel({
  devices,
  limit,
  onSignOut,
  onCancel,
}: DeviceLimitPanelProps) {
  const _ = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSignOut = async (device: SyncDevice) => {
    setBusyId(device.id);
    setError('');
    try {
      await onSignOut(device);
    } catch {
      setError(_('Unable to connect to Readest. Please check your network connection.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className='flex w-full max-w-sm flex-col items-center gap-6'>
      <div className='flex flex-col items-center gap-3 text-center'>
        <Image src='/icon.png' alt='' width={56} height={56} className='eink-bordered rounded-xl' />
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>{_('Device limit reached')}</h1>
          <p className='text-base-content/70 mt-1.5 text-sm leading-relaxed'>
            {_(
              'The Free plan syncs on up to {{limit}} devices. Sign out of one of them to sign in on this device.',
              { limit },
            )}
          </p>
        </div>
      </div>
      <SyncDeviceList
        devices={devices.filter((device) => !device.current)}
        busyId={busyId}
        onSignOut={handleSignOut}
      />
      {error && <p className='text-error text-center text-sm'>{error}</p>}
      <button type='button' className='btn btn-ghost' onClick={onCancel}>
        {_('Cancel')}
      </button>
    </div>
  );
}
