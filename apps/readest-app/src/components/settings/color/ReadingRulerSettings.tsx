import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { ReadingRulerColor } from '@/types/book';
import NumberInput from '../NumberInput';

interface ReadingRulerSettingsProps {
  enabled: boolean;
  lines: number;
  opacity: number;
  color: ReadingRulerColor;
  onEnabledChange: (enabled: boolean) => void;
  onLinesChange: (lines: number) => void;
  onOpacityChange: (opacity: number) => void;
  onColorChange: (color: ReadingRulerColor) => void;
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
  onEnabledChange,
  onLinesChange,
  onOpacityChange,
  onColorChange,
}) => {
  const _ = useTranslation();

  return (
    <div className='w-full'>
      <h2 className='mb-2 font-medium'>{_('Reading Ruler')}</h2>
      <div className='card bg-base-100 border-base-200 border shadow'>
        <div className='divide-base-200 divide-y'>
          <div className='config-item'>
            <span>{_('Enable Reading Ruler')}</span>
            <input
              type='checkbox'
              className='toggle'
              checked={enabled}
              onChange={() => onEnabledChange(!enabled)}
            />
          </div>
          <NumberInput
            label={_('Lines to Highlight')}
            value={lines}
            onChange={onLinesChange}
            disabled={!enabled}
            min={1}
            max={6}
            step={1}
          />
          <div className='config-item'>
            <span>{_('Ruler Color')}</span>
            <div className='flex gap-2'>
              {RULER_COLORS.map(({ value, className, hoverClassName }) => (
                <button
                  key={value}
                  disabled={!enabled}
                  className={`btn btn-circle btn-sm ${className} ${hoverClassName} ${
                    color === value ? 'ring-base-content ring-2 ring-offset-1' : ''
                  } ${!enabled ? 'btn-disabled opacity-50' : ''}`}
                  onClick={() => onColorChange(value)}
                />
              ))}
            </div>
          </div>
          <NumberInput
            label={_('Opacity')}
            value={opacity}
            onChange={onOpacityChange}
            disabled={!enabled}
            min={0.1}
            max={0.9}
            step={0.1}
          />
        </div>
      </div>
    </div>
  );
};

export default ReadingRulerSettings;
