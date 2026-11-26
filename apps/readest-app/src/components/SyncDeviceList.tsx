import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import type { SyncDevice } from '@/utils/syncDevices';

interface SyncDeviceListProps {
  devices: SyncDevice[];
  /** The device being signed out, while its request runs. */
  busyId: string | null;
  onSignOut: (device: SyncDevice) => void;
}

/**
 * The devices signed in to the account, each but this one with Sign Out.
 * Styled like Manage Sync's category list, which it sits under.
 */
export default function SyncDeviceList({ devices, busyId, onSignOut }: SyncDeviceListProps) {
  const _ = useTranslation();
  return (
    <ul className='border-base-300 divide-base-300 eink-bordered w-full divide-y rounded-lg border'>
      {devices.map((device) => {
        const name =
          device.client && device.os
            ? _('{{client}} on {{os}}', { client: device.client, os: device.os })
            : _('Unknown device');
        const lastActive = new Date(device.lastActiveAt).toLocaleDateString(getLocale(), {
          dateStyle: 'medium',
        });
        return (
          <li key={device.id} className='flex items-center justify-between gap-4 px-4 py-3'>
            <div className='flex min-w-0 flex-col gap-0.5'>
              <span className='text-base-content text-sm font-medium'>{name}</span>
              <span className='text-base-content/60 text-xs'>
                {device.current
                  ? _('This device')
                  : _('Last active {{date}}', { date: lastActive })}
              </span>
            </div>
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
          </li>
        );
      })}
    </ul>
  );
}
