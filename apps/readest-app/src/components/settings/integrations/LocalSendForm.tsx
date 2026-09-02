import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocalSendStore } from '@/store/localsendStore';
import {
  getLocalSendAlias,
  isLocalSendEnabled,
  setLocalSendAlias,
  setLocalSendEnabled,
} from '@/services/localsend/devicePrefs';
import { getPairedDevices, removePairedDevice } from '@/services/localsend/pairedDevices';
import { isLocalSendSoundsEnabled, setLocalSendSoundsEnabled } from '@/services/localsend/sounds';
import { getLocalSendStatus } from '@/services/localsend/service';
import { ipTag } from '@/services/localsend/deviceModel';
import type { LocalSendStatus } from '@/services/localsend/types';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingsInput,
  SettingsRow,
  SettingsSwitchRow,
  Tips,
} from '../primitives';

/**
 * "#120 macOS"-style tag: the last octet of this host's IPv4 address plus
 * the announced OS name, so the user can tell peers which device to pick
 * when aliases collide.
 */
const deviceTag = (status: LocalSendStatus): string => {
  const tags = status.localIps.map(ipTag).filter(Boolean);
  return [...new Set(tags), status.deviceModel].filter(Boolean).join(' ');
};

interface LocalSendFormProps {
  onBack: () => void;
}

/**
 * LocalSend integration settings. The enable toggle and alias are per-device
 * (localStorage) — each device opts into being a LocalSend peer on its own.
 * The LocalSendManager listens for the pref-change events and starts/stops
 * the Rust service to match.
 */
const LocalSendForm: React.FC<LocalSendFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const status = useLocalSendStore((state) => state.status);
  const [enabled, setEnabled] = useState(() => isLocalSendEnabled());
  const [alias, setAlias] = useState(() => getLocalSendAlias());
  const [sounds, setSounds] = useState(() => isLocalSendSoundsEnabled());
  const [paired, setPaired] = useState(() => getPairedDevices());

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    setLocalSendEnabled(next);
    eventDispatcher.dispatch('localsend-prefs-changed', {});
  };

  const toggleSounds = () => {
    const next = !sounds;
    setSounds(next);
    setLocalSendSoundsEnabled(next);
  };

  const unpair = (fingerprint: string) => {
    removePairedDevice(fingerprint);
    setPaired(getPairedDevices());
  };

  const commitAlias = () => {
    const trimmed = alias.trim();
    if (trimmed === getLocalSendAlias()) return;
    setLocalSendAlias(trimmed);
    if (enabled) eventDispatcher.dispatch('localsend-alias-changed', {});
  };

  // Refresh the status shown below the toggle when this page opens; the
  // manager also pushes updates through localsend:server-state events.
  useEffect(() => {
    if (!enabled) return;
    getLocalSendStatus()
      .then((current) => useLocalSendStore.getState().setStatus(current))
      .catch(() => {});
  }, [enabled]);

  return (
    <div className='w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Nearby BookDrop')}
        description={_(
          'Drop books to nearby Readest devices, and to LocalSend apps, over your local network.',
        )}
        onBack={onBack}
      />

      <BoxedList>
        <SettingsSwitchRow
          label={_('Enable Nearby BookDrop')}
          description={_('Receive books while Readest is open')}
          checked={enabled}
          onChange={toggleEnabled}
          data-setting-id='settings.integrations.localsend.enabled'
        />
        <SettingsRow label={_('Device Name')} asLabel>
          <SettingsInput
            type='text'
            value={alias}
            placeholder={status?.alias || _('Default')}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={commitAlias}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Transfer Sounds')}
          description={_('Play a sound when transfers start, finish, or fail')}
          checked={sounds}
          onChange={toggleSounds}
        />
      </BoxedList>

      {paired.length > 0 && (
        <div>
          <SectionTitle className='mb-2'>{_('Paired Devices')}</SectionTitle>
          <BoxedList>
            {paired.map((device) => (
              <SettingsRow
                key={device.fingerprint}
                label={device.alias}
                description={[
                  device.deviceModel,
                  _('Paired {{date}}', {
                    date: new Date(device.pairedAt).toLocaleDateString(),
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                asLabel={false}
              >
                <button
                  type='button'
                  className='btn btn-ghost btn-xs eink-bordered'
                  onClick={() => unpair(device.fingerprint)}
                >
                  {_('Unpair')}
                </button>
              </SettingsRow>
            ))}
          </BoxedList>
        </div>
      )}

      {enabled && status?.running && (
        <BoxedList>
          <SettingsRow
            label={_('Visible as')}
            description={[status.alias, deviceTag(status)].filter(Boolean).join(' · ')}
            asLabel={false}
          >
            <span className='text-base-content/70 text-sm'>
              {_('Port {{port}}', { port: status.port })}
            </span>
          </SettingsRow>
        </BoxedList>
      )}

      <Tips>
        <li>
          {_('Incoming books are added to your library after you accept each transfer request.')}
        </li>
        <li>{_('Only book files are accepted; other file types are declined automatically.')}</li>
        <li>
          {_(
            'Devices disappear from the list when their screen turns off; keep the screen on to stay visible.',
          )}
        </li>
        {paired.length > 0 && (
          <li>{_('Books from paired devices are accepted automatically, without asking.')}</li>
        )}
        {status?.multicastError && (
          <li>
            {_('Device discovery via multicast is unavailable; devices may need a manual refresh.')}
          </li>
        )}
      </Tips>
    </div>
  );
};

export default LocalSendForm;
