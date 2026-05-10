import React from 'react';
import SettingsRow from './SettingsRow';

interface SettingsSwitchRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  'data-setting-id'?: string;
}

/**
 * Boxed-list row whose trailing control is a switch toggle. By far the most
 * common settings row archetype — wraps `<SettingsRow asLabel>` with a
 * pre-baked daisyui `toggle` (default size) so callers don't repeat the
 * input markup.
 *
 * Default-size `toggle` is intentional — `toggle-sm` looks orphaned in a
 * 56px settings row. Reserve smaller sizes (`toggle-sm`, `toggle-xs`) for
 * inline switches inside cards / catalog rows where vertical space is
 * tighter. See DESIGN.md §5.
 */
const SettingsSwitchRow: React.FC<SettingsSwitchRowProps> = ({
  label,
  description,
  checked,
  onChange,
  disabled,
  'data-setting-id': dataSettingId,
}) => {
  return (
    <SettingsRow
      asLabel
      label={label}
      description={description}
      disabled={disabled}
      data-setting-id={dataSettingId}
    >
      <input
        type='checkbox'
        className='toggle'
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </SettingsRow>
  );
};

export default SettingsSwitchRow;
