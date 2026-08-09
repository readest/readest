import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocalSendStore } from '@/store/localsendStore';
import {
  getLocalSendAlias,
  isLocalSendEnabled,
  setLocalSendAlias,
  setLocalSendEnabled,
} from '@/services/localsend/devicePrefs';
import { getLocalSendStatus } from '@/services/localsend/service';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SettingsInput, SettingsRow, SettingsSwitchRow, Tips } from '../primitives';

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

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    setLocalSendEnabled(next);
    eventDispatcher.dispatch('localsend-prefs-changed', {});
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
        currentLabel={_('LocalSend')}
        description={_(
          'Send and receive books with LocalSend apps and other Readest devices on your local network.',
        )}
        onBack={onBack}
      />

      <BoxedList>
        <SettingsSwitchRow
          label={_('Enable LocalSend')}
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
      </BoxedList>

      {enabled && status?.running && (
        <BoxedList>
          <SettingsRow label={_('Visible as')} description={status.alias} asLabel={false}>
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
