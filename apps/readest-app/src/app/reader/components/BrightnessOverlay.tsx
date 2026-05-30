import clsx from 'clsx';
import React from 'react';
import { PiSun } from 'react-icons/pi';
import { valueToPosition } from '@/app/reader/utils/brightnessGesture';

interface BrightnessOverlayProps {
  visible: boolean;
  /** Brightness value, 0-1. */
  level: number;
}

const isEink = () =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-eink') === 'true';

/**
 * Transient brightness indicator shown at the left edge while the swipe gesture
 * adjusts brightness. Its own capsule surface keeps it legible over any book
 * background; on e-ink it snaps (no continuous animation) and quantizes the fill.
 */
const BrightnessOverlay: React.FC<BrightnessOverlayProps> = ({ visible, level }) => {
  const eink = isEink();
  const clamped = Math.max(0, Math.min(1, level));
  // Fill height tracks the slider's perceptual position; the label shows the value.
  let fillPercent = valueToPosition(clamped) * 100;
  let valuePercent = Math.round(clamped * 100);
  if (eink) {
    fillPercent = Math.round(fillPercent / 10) * 10;
    valuePercent = Math.round(valuePercent / 10) * 10;
  }

  return (
    <div
      aria-hidden
      dir='ltr'
      className={clsx(
        'pointer-events-none absolute left-0 top-1/2 z-[15] -translate-y-1/2',
        'not-eink:transition-opacity not-eink:duration-200 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ marginInlineStart: 'calc(env(safe-area-inset-left) + 12px)' }}
    >
      <div
        className={clsx(
          'eink-bordered flex flex-col items-center gap-2 rounded-full px-2 py-3',
          'bg-base-100/90 not-eink:shadow-md',
        )}
      >
        <PiSun className='text-base-content h-4 w-4' />
        <div className='bg-base-content/20 relative h-40 w-1.5 overflow-hidden rounded-full'>
          <div
            className='bg-base-content absolute bottom-0 left-0 w-full rounded-full'
            style={{ height: `${fillPercent}%` }}
          />
        </div>
        <span className='text-base-content text-xs tabular-nums'>{valuePercent}</span>
      </div>
    </div>
  );
};

export default BrightnessOverlay;
