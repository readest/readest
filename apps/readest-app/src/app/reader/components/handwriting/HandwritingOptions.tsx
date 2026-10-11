import clsx from 'clsx';
import React from 'react';
import { FaCheck } from 'react-icons/fa';

import {
  HANDWRITING_COLORS,
  HANDWRITING_WIDTHS,
  MARKER_COLORS,
  MARKER_WIDTHS,
  type InkTool,
} from '@/services/handwriting/model';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface HandwritingOptionsProps {
  tool: InkTool;
  color: string;
  width: number;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
}

const MIN_DOT = 3;
const MAX_DOT = 7;
/** Width swatch radius, scaled so the row reads as increasing weight. */
const dotFor = (width: number, widths: readonly number[]) => {
  const min = widths[0]!;
  const max = widths[widths.length - 1]!;
  return MIN_DOT + ((width - min) / (max - min)) * (MAX_DOT - MIN_DOT);
};

/** The active tool's colors and widths. B&W e-ink has no colors to offer. */
const HandwritingOptions: React.FC<HandwritingOptionsProps> = ({
  tool,
  color,
  width,
  onSelectColor,
  onSelectWidth,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { isEink, isColorEink } = settings.globalViewSettings;
  const showColors = !isEink || isColorEink;
  const swatchSize = useResponsiveSize(20);
  const checkSize = useResponsiveSize(10);
  const colors = tool === 'marker' ? MARKER_COLORS : HANDWRITING_COLORS;
  const widths = tool === 'marker' ? MARKER_WIDTHS : HANDWRITING_WIDTHS;

  return (
    <div className='flex shrink-0 items-center gap-1.5'>
      {showColors &&
        colors.map((hex) => (
          <button
            key={hex}
            type='button'
            aria-label={_('Ink Color')}
            aria-pressed={color === hex}
            onClick={() => onSelectColor(hex)}
            style={{ width: swatchSize, height: swatchSize, backgroundColor: hex }}
            className='flex shrink-0 items-center justify-center rounded-full p-0'
          >
            {color === hex && <FaCheck size={checkSize} className='text-white' />}
          </button>
        ))}
      {showColors && <div className='bg-base-content/20 mx-0.5 h-5 w-px shrink-0' />}
      {widths.map((value) => {
        const dot = dotFor(value, widths);
        return (
          <button
            key={value}
            type='button'
            aria-label={_('Pen Size')}
            aria-pressed={width === value}
            onClick={() => onSelectWidth(value)}
            style={{ width: swatchSize, height: swatchSize }}
            className={clsx(
              'flex shrink-0 items-center justify-center rounded-full p-0',
              width === value ? 'border-base-content border-2' : 'border-base-content/20 border',
            )}
          >
            <span
              className={clsx(!showColors && 'bg-base-content')}
              style={{
                width: dot * 2,
                height: dot * 2,
                borderRadius: dot,
                backgroundColor: showColors ? color : undefined,
              }}
            />
          </button>
        );
      })}
    </div>
  );
};

export default HandwritingOptions;
