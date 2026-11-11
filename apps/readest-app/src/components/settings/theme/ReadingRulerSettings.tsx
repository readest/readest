import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { ReadingRulerColor, ViewSettings } from '@/types/book';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from '../primitives';
import NumberInput from '../NumberInput';
import ColorInput from './ColorInput';

interface ReadingRulerSettingsProps {
  enabled: boolean;
  lines: number;
  opacity: number;
  color: ReadingRulerColor;
  rulerStyle: ViewSettings['readingRulerStyle'];
  lineColor: string;
  lineThickness: number;
  onEnabledChange: (enabled: boolean) => void;
  onLinesChange: (lines: number) => void;
  onOpacityChange: (opacity: number) => void;
  onColorChange: (color: ReadingRulerColor) => void;
  onStyleChange: (style: ViewSettings['readingRulerStyle']) => void;
  onLineColorChange: (color: string) => void;
  onLineThicknessChange: (thickness: number) => void;
  'data-setting-id'?: string;
}

const RULER_COLORS: { value: ReadingRulerColor; className: string; hoverClassName: string }[] = [
  { value: 'transparent', className: 'bg-transparent', hoverClassName: 'hover:bg-transparent' },
  { value: 'yellow', className: 'bg-yellow-400', hoverClassName: 'hover:bg-yellow-500' },
  { value: 'green', className: 'bg-green-400', hoverClassName: 'hover:bg-green-500' },
  { value: 'blue', className: 'bg-blue-400', hoverClassName: 'hover:bg-blue-500' },
  { value: 'rose', className: 'bg-rose-400', hoverClassName: 'hover:bg-rose-500' },
];

const ReadingRulerSettings: React.FC<ReadingRulerSettingsProps> = ({
  enabled,
  lines,
  opacity,
  color,
  rulerStyle,
  lineColor,
  lineThickness,
  onEnabledChange,
  onLinesChange,
  onOpacityChange,
  onColorChange,
  onStyleChange,
  onLineColorChange,
  onLineThicknessChange,
  'data-setting-id': dataSettingId,
}) => {
  const _ = useTranslation();
  const isLine = rulerStyle === 'line';

  return (
    <BoxedList title={_('Reading Ruler')} data-setting-id={dataSettingId}>
      <SettingsSwitchRow
        label={_('Enable Reading Ruler')}
        checked={enabled}
        onChange={() => onEnabledChange(!enabled)}
      />
      <SettingsRow label={_('Ruler Style')}>
        <SettingsSelect
          ariaLabel={_('Ruler Style')}
          value={rulerStyle}
          onChange={(e) => onStyleChange(e.target.value as ViewSettings['readingRulerStyle'])}
          disabled={!enabled}
          options={[
            { value: 'band', label: _('Band') },
            { value: 'line', label: _('Line') },
          ]}
        />
      </SettingsRow>
      {isLine ? (
        <NumberInput
          label={_('Line Thickness')}
          value={lineThickness}
          onChange={onLineThicknessChange}
          disabled={!enabled}
          min={1}
          max={8}
          step={1}
        />
      ) : (
        <NumberInput
          label={_('Lines to Highlight')}
          value={lines}
          onChange={onLinesChange}
          disabled={!enabled}
          min={1}
          max={6}
          step={1}
        />
      )}
      <SettingsRow label={_('Ruler Color')}>
        {isLine ? (
          enabled && (
            <ColorInput
              label={_('Ruler Color')}
              value={lineColor}
              onChange={onLineColorChange}
              showPickerIcon
              pickerPosition='right'
            />
          )
        ) : (
          <div className='flex gap-2'>
            {RULER_COLORS.map(({ value, className, hoverClassName }) => (
              <button
                key={value}
                className={`btn btn-circle btn-sm ${className} ${hoverClassName} ${
                  color === value ? 'ring-base-content ring-2 ring-offset-1' : ''
                } ${!enabled ? 'opacity-50' : ''}`}
                onClick={() => enabled && onColorChange(value)}
              />
            ))}
          </div>
        )}
      </SettingsRow>
      <NumberInput
        label={_('Opacity')}
        value={opacity}
        onChange={onOpacityChange}
        disabled={!enabled}
        min={0.1}
        max={0.9}
        step={0.1}
      />
    </BoxedList>
  );
};

export default ReadingRulerSettings;
