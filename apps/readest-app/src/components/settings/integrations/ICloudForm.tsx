import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { getICloudContainerStatus } from '@/utils/bridge';
import { isICloudSupportedPlatform } from '@/services/sync/providers/icloud/buildICloudProvider';
import { Tips } from '../primitives';
import FileSyncForm from './FileSyncForm';
import { persistCloudProviderEnabled } from './cloudSync';

const turnOffButtonClass = clsx(
  'eink-bordered',
  'h-10 rounded-lg px-4 text-sm font-medium',
  'text-error hover:bg-error/10',
  'transition-colors duration-150',
  'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
);

const primaryButtonClass = clsx(
  'btn btn-contrast',
  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
  'focus-visible:ring-base-content/40 focus-visible:outline-none focus-visible:ring-2',
);

/**
 * iCloud provider panel, embedded in the Integrations iCloud sub-page (which
 * owns the header). No credentials and no OAuth — the device's iCloud session
 * is the account. Three states:
 *
 * - **Active** (`icloud.enabled`): the shared {@link FileSyncForm} controls +
 *   Turn Off. Turning off keeps the container data; there is nothing to tear
 *   down, so re-enabling is a single tap.
 * - **Available but off**: a "Use iCloud" activation button.
 * - **Unavailable** (no iCloud session, or a build without the iCloud
 *   entitlement): explanatory tips, no controls.
 */
const ICloudForm: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.icloud;
  const isActive = !!stored?.enabled;
  // null = probing. The probe is one plugin command; cheap to run on mount.
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isICloudSupportedPlatform()) {
      setAvailable(false);
      return;
    }
    getICloudContainerStatus()
      .then((s) => setAvailable(!!s.available && !!s.documentsPath))
      .catch(() => setAvailable(false));
  }, []);

  const persistICloud = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, icloud: { ...latest.icloud, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleActivate = async () => {
    await persistCloudProviderEnabled(envConfig, 'icloud', true);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleTurnOff = async () => {
    await persistCloudProviderEnabled(envConfig, 'icloud', false);
  };

  if (isActive) {
    return (
      <div className='space-y-5'>
        <FileSyncForm kind='icloud' stored={stored} persist={persistICloud} />
        <div className='flex justify-end'>
          <button type='button' onClick={handleTurnOff} className={turnOffButtonClass}>
            {_('Turn Off')}
          </button>
        </div>
      </div>
    );
  }

  if (available === false) {
    return (
      <Tips>
        <li>{_('iCloud is not available on this device.')}</li>
        <li>
          {_('Sign in to iCloud in System Settings and make sure iCloud Drive is turned on.')}
        </li>
      </Tips>
    );
  }

  return (
    <div className='space-y-5'>
      <div className='flex justify-end pt-1'>
        <button
          type='button'
          onClick={handleActivate}
          disabled={available !== true}
          className={clsx(primaryButtonClass, available !== true && 'opacity-60')}
        >
          {_('Use iCloud')}
        </button>
      </div>
      <Tips>
        <li>{_('Your library is stored in your iCloud Drive and counts against its storage.')}</li>
      </Tips>
    </div>
  );
};

export default ICloudForm;
