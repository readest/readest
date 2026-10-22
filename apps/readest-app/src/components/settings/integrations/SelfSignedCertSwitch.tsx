import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { BoxedList, SettingsSwitchRow } from '../primitives';

interface SelfSignedCertSwitchProps {
  checked: boolean;
  onChange: () => void;
}

/**
 * Per-server choice to accept self-signed or mismatched TLS certificates, on
 * unless turned off. Native only: on the web the browser enforces TLS and the
 * choice has no effect.
 */
const SelfSignedCertSwitch: React.FC<SelfSignedCertSwitchProps> = ({ checked, onChange }) => {
  const _ = useTranslation();
  if (!isTauriAppPlatform()) return null;
  return (
    <BoxedList
      description={_(
        'Skips certificate checks for this server. Turn it off if the server has a valid certificate',
      )}
    >
      <SettingsSwitchRow
        label={_('Allow Self-Signed Certificate')}
        checked={checked}
        onChange={onChange}
      />
    </BoxedList>
  );
};

export default SelfSignedCertSwitch;
