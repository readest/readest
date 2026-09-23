import React from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { Toggle } from '@/components/primitives/toggle';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '../primitives';
import ColorInput from './ColorInput';

interface DialogueHighlightSettingsProps {
  dialogueHighlight: boolean;
  customBackground: boolean;
  backgroundColor: string;
  customTextColor: boolean;
  textColor: string;
  onToggle: (enabled: boolean) => void;
  onCustomBackgroundToggle: (enabled: boolean) => void;
  onBackgroundColorChange: (color: string) => void;
  onCustomTextColorToggle: (enabled: boolean) => void;
  onTextColorChange: (color: string) => void;
  'data-setting-id'?: string;
}

const DialogueHighlightSettings: React.FC<DialogueHighlightSettingsProps> = ({
  dialogueHighlight,
  customBackground,
  backgroundColor,
  customTextColor,
  textColor,
  onToggle,
  onCustomBackgroundToggle,
  onBackgroundColorChange,
  onCustomTextColorToggle,
  onTextColorChange,
  'data-setting-id': dataSettingId,
}) => {
  const _ = useTranslation();
  // SettingsRow's `disabled` only dims the row; guard the pickers themselves
  // the way ReadingRulerSettings does so a dimmed row can't be changed. The
  // text switch is independent of the background switch.
  const textEnabled = customTextColor;

  return (
    <BoxedList title={_('Dialogue Highlighting')} data-setting-id={dataSettingId}>
      <SettingsSwitchRow
        label={_('Background')}
        description={
          dialogueHighlight
            ? customBackground
              ? backgroundColor
              : _('Follows the theme color')
            : _('Off')
        }
        checked={dialogueHighlight}
        onChange={() => onToggle(!dialogueHighlight)}
      />
      {dialogueHighlight && (
        <SettingsRow label={_('Background Style')}>
          {/* Same segmented anatomy as ScopeSwitch (pill track, active thumb),
              here choosing between the theme color and a fixed color. */}
          <div
            role='radiogroup'
            aria-label={_('Background Style')}
            className='bg-base-200 eink-bordered inline-flex shrink-0 items-center rounded-full p-0.5'
          >
            {(
              [
                { value: false, label: _('Auto') },
                { value: true, label: _('Custom') },
              ] as const
            ).map(({ value, label }) => {
              const active = customBackground === value;
              return (
                <button
                  key={String(value)}
                  type='button'
                  role='radio'
                  aria-checked={active}
                  onClick={() => onCustomBackgroundToggle(value)}
                  className={clsx(
                    'flex h-9 items-center justify-center rounded-full px-3 text-[0.85em] font-medium transition-colors',
                    'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                    active
                      ? 'bg-base-300 text-base-content eink-inverted shadow-xs'
                      : 'text-base-content/60 hover:text-base-content',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </SettingsRow>
      )}
      {dialogueHighlight && customBackground && (
        <SettingsRow label={_('Background Color')}>
          <ColorInput
            label={_('Background Color')}
            value={backgroundColor}
            onChange={onBackgroundColorChange}
            showPickerIcon
            pickerPosition='right'
          />
        </SettingsRow>
      )}
      <SettingsRow label={_('Text Color')} description={textColor || _('Default')}>
        <div className='flex items-center gap-2'>
          <span className={clsx(!textEnabled && 'opacity-50')}>
            <ColorInput
              label={_('Text Color')}
              value={textColor || '#808080'}
              onChange={(next) => textEnabled && onTextColorChange(next)}
              showPickerIcon
              pickerPosition='right'
            />
          </span>
          <Toggle
            checked={customTextColor}
            aria-label={_('Text Color')}
            onChange={() => {
              // Seed the picker's displayed fallback so enabling the switch
              // visibly does something instead of staying on inherited text.
              if (!customTextColor && !textColor) onTextColorChange('#808080');
              onCustomTextColorToggle(!customTextColor);
            }}
          />
        </div>
      </SettingsRow>
    </BoxedList>
  );
};

export default DialogueHighlightSettings;
