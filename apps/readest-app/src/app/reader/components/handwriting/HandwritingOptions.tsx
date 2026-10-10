import clsx from 'clsx';
import React from 'react';
import { FaCheck } from 'react-icons/fa';

import { HANDWRITING_COLORS, HANDWRITING_WIDTHS } from '@/services/handwriting/handwritingService';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface HandwritingOptionsProps {
  color: string;
  width: number;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
}

/**
 * Ink color and pen-width swatches for the handwriting toolbar. Lives beside
 * the pen/eraser tools rather than in the selection popup: the highlight strip
 * already owns that slot, and these controls apply to the pen the reader is
 * about to draw with, not to the current selection.
 *
 * Widths render as filled dots scaled to the pen's relative thickness, so the
 * choice reads as a stroke weight before a stroke is made.
 */
const HandwritingOptions: React.FC<HandwritingOptionsProps> = ({
  color,
  width,
  onSelectColor,
  onSelectWidth,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const isBwEink = settings.globalViewSettings.isEink && !settings.globalViewSettings.isColorEink;
  const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';

  const swatchSize = useResponsiveSize(16);
  const checkSize = useResponsiveSize(10);
  // Dot radius spans the thinnest to thickest pen in the palette, so the row
  // reads as increasing weight rather than four identical circles.
  const minDot = 3;
  const maxDot = 7;
  const [minWidth, maxWidth] = [Math.min(...HANDWRITING_WIDTHS), Math.max(...HANDWRITING_WIDTHS)];
  const dotFor = (value: number) =>
    minDot +
    ((value - minWidth) / Math.max(maxWidth - minWidth, Number.EPSILON)) * (maxDot - minDot);

  return (
    <div className='eink-bordered bg-base-300 theme-dark:bg-base-100 not-eink:shadow-xs flex items-center gap-1 rounded-3xl not-eink:border-base-content/20 border px-2 py-1'>
      <div className='flex items-center gap-1.5'>
        {HANDWRITING_COLORS.map((hex) => {
          const swatch = isBwEink ? einkFgColor : hex;
          return (
            <button
              key={hex}
              type='button'
              aria-label={_('Select ink color {{color}}', { color: hex })}
              title={hex}
              onClick={() => onSelectColor(hex)}
              style={{ width: swatchSize, height: swatchSize, backgroundColor: swatch }}
              className='flex shrink-0 items-center justify-center rounded-full p-0'
            >
              {color === hex && (
                <FaCheck
                  size={checkSize}
                  // B&W e-ink paints the dot in base-content, so the check
                  // needs contrasting ink rather than inheriting the class.
                  className={clsx(!isBwEink && 'text-base-content')}
                  style={isBwEink ? { color: einkBgColor } : undefined}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className='bg-base-content/20 mx-0.5 h-5 w-px shrink-0' />

      <div className='flex items-center gap-1.5'>
        {HANDWRITING_WIDTHS.map((value) => {
          const dot = dotFor(value);
          return (
            <button
              key={value}
              type='button'
              aria-label={_('Select pen size')}
              title={_('Pen size')}
              aria-pressed={width === value}
              onClick={() => onSelectWidth(value)}
              style={{ width: swatchSize, height: swatchSize }}
              className={clsx(
                'flex shrink-0 items-center justify-center rounded-full p-0',
                width === value
                  ? 'border-current border-2'
                  : 'eink-bordered not-eink:border-base-content/20 border',
              )}
            >
              <span
                style={{
                  width: dot * 2,
                  height: dot * 2,
                  borderRadius: dot,
                  backgroundColor: isBwEink ? einkFgColor : color,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HandwritingOptions;
