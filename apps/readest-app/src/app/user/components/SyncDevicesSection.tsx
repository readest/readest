'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchSyncDevices, signOutSyncDevice } from '@/libs/syncDevices';
import { getAccessToken } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import type { SyncDevice, SyncDevicesResponse } from '@/utils/syncDevices';
import SyncDeviceList from '@/components/SyncDeviceList';

export function SyncDevicesSection() {
  const _ = useTranslation();
  const [state, setState] = useState<SyncDevicesResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getAccessToken();
        if (token) setState(await fetchSyncDevices(token));
      } catch (error) {
        console.error('Failed to list devices:', error);
      }
    })();
  }, []);

  if (!state) return null;

  const handleSignOut = async (device: SyncDevice) => {
    setBusyId(device.id);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not signed in');
      setState(await signOutSyncDevice(token, device.id));
    } catch (error) {
      console.error('Failed to sign out a device:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to sign out the device. Please try again later.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <h3 className='text-base-content text-lg font-semibold'>{_('Devices')}</h3>
        <p className='text-base-content/70 text-sm'>
          {state.limit === null
            ? _('The devices signed in to your account. Sign out of one you no longer use.')
            : _(
                'The Free plan syncs on up to {{limit}} devices. Sign out of one you no longer use to sign in on another.',
                { limit: state.limit },
              )}
        </p>
      </div>
      <SyncDeviceList devices={state.devices} busyId={busyId} onSignOut={handleSignOut} />
    </div>
  );
}
