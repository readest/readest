import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { BoxedList, SettingsSwitchRow } from '../primitives';

interface SelfSignedCertSwitchProps {
  checked: boolean;
  onChange: () => void;
}

/**
 * Per-server opt-in for self-signed or mismatched TLS certificates. Native
 * only: on the web the browser enforces TLS and the choice has no effect.
 */
const SelfSignedCertSwitch: React.FC<SelfSignedCertSwitchProps> = ({ checked, onChange }) => {
  const _ = useTranslation();
  if (!isTauriAppPlatform()) return null;
  return (
    <BoxedList
      description={_(
        'Skips certificate checks for this server, so only turn it on if you trust it',
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
