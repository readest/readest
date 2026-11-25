import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import { getLocale } from '@/utils/misc';
import type { SyncDevice } from '@/utils/syncDevices';

interface SyncDeviceListProps {
  devices: SyncDevice[];
  /** The device being signed out, while its request runs. */
  busyId: string | null;
  onSignOut: (device: SyncDevice) => void;
}

/** The devices signed in to the account, each but this one with Sign Out. */
export default function SyncDeviceList({ devices, busyId, onSignOut }: SyncDeviceListProps) {
  const _ = useTranslation();
  return (
    <BoxedList>
      {devices.map((device) => {
        const name =
          device.client && device.os
            ? _('{{client}} on {{os}}', { client: device.client, os: device.os })
            : _('Unknown device');
        const lastActive = new Date(device.lastActiveAt).toLocaleDateString(getLocale(), {
          dateStyle: 'medium',
        });
        return (
          <SettingsRow
            key={device.id}
            label={name}
            description={
              device.current ? _('This device') : _('Last active {{date}}', { date: lastActive })
            }
          >
            {!device.current && (
              <button
                type='button'
                className='btn btn-ghost btn-sm shrink-0'
                aria-label={_('Sign out {{device}}', { device: name })}
                disabled={busyId !== null}
                onClick={() => onSignOut(device)}
              >
                {busyId === device.id ? (
                  <span className='loading loading-spinner loading-xs' />
                ) : (
                  _('Sign Out')
                )}
              </button>
            )}
          </SettingsRow>
        );
      })}
    </BoxedList>
  );
}
