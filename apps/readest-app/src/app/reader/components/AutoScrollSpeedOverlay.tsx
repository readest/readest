import clsx from 'clsx';
import React from 'react';
import { MdSpeed } from 'react-icons/md';
import { speedToPosition } from '@/app/reader/utils/autoScrollSpeedGesture';

interface AutoScrollSpeedOverlayProps {
  visible: boolean;
  /** Auto scroll speed as a percentage (25-500). */
  speed: number;
}

const isEink = () =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-eink') === 'true';

/**
 * Transient speed indicator shown at the right edge while the swipe gesture
 * adjusts the Auto Scroll speed. Mirrors `BrightnessOverlay` on the opposite
 * edge: its own capsule surface keeps it legible over any book background; on
 * e-ink it snaps (no continuous animation) and quantizes the fill.
 */
const AutoScrollSpeedOverlay: React.FC<AutoScrollSpeedOverlayProps> = ({ visible, speed }) => {
  const eink = isEink();
  // Fill height tracks the slider's position; the label shows the percentage.
  let fillPercent = speedToPosition(speed) * 100;
  if (eink) {
    fillPercent = Math.round(fillPercent / 10) * 10;
  }

  return (
    <div
      aria-hidden
      dir='ltr'
      className={clsx(
        'pointer-events-none absolute right-0 top-1/2 z-[15] -translate-y-1/2',
        'not-eink:transition-opacity not-eink:duration-200 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ marginInlineEnd: 'calc(env(safe-area-inset-right) + 12px)' }}
    >
      <div
        className={clsx(
          'eink-bordered flex flex-col items-center gap-2 rounded-full px-2 py-3',
          'bg-base-100/90 not-eink:shadow-md',
        )}
      >
        <MdSpeed className='text-base-content h-4 w-4' />
        <div className='bg-base-content/20 relative h-40 w-1.5 overflow-hidden rounded-full'>
          <div
            className='bg-base-content absolute bottom-0 left-0 w-full rounded-full'
            style={{ height: `${fillPercent}%` }}
          />
        </div>
        <span className='text-base-content text-xs tabular-nums'>{speed}%</span>
      </div>
    </div>
  );
};

export default AutoScrollSpeedOverlay;
