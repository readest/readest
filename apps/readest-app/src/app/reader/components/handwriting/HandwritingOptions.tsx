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
    <div className='flex flex-col gap-3'>
      {showColors && (
        <div className='flex items-center gap-1.5'>
          {colors.map((hex) => (
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
        </div>
      )}
      <input
        type='range'
        aria-label={_('Pen Size')}
        min={widths[0]}
        max={widths[widths.length - 1]}
        step={0.0005}
        value={width}
        onChange={(event) => onSelectWidth(Number(event.target.value))}
        className='range range-xs eink-bordered w-40'
      />
    </div>
  );
};

export default HandwritingOptions;
