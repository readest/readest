import clsx from 'clsx';
import React from 'react';

interface StickyProgressBarProps {
  fraction: number;
  tickFractions: number[];
  rtl?: boolean;
  isEink?: boolean;
  className?: string;
}

// Always-visible, display-only reading progress bar with chapter tick marks.
// Positions are expressed from the reading-start edge so the fill grows and the
// ticks sit correctly in both LTR and RTL.
const StickyProgressBar: React.FC<StickyProgressBarProps> = ({
  fraction,
  tickFractions,
  rtl = false,
  isEink = false,
  className,
}) => {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  const startEdge = rtl ? 'right' : 'left';

  return (
    <div
      role='presentation'
      aria-hidden='true'
      className={clsx('sticky-progress-bar relative flex items-center', className)}
    >
      {/* A thin 1px rounded border outlines the whole bar; the fill sits inside it. */}
      <div
        className={clsx(
          'sticky-progress-track absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full border',
          isEink ? 'border-base-content' : 'border-base-content/40',
        )}
      >
        <div
          className={clsx(
            'sticky-progress-fill absolute inset-y-0 rounded-full',
            isEink ? 'bg-base-content' : 'bg-base-content/50',
          )}
          style={{ width: `${pct}%`, [startEdge]: 0 }}
        />
        {/* Ticks live inside the clipped, rounded track so the border crops any
            that land near the rounded ends — they never exceed the outline. */}
        {tickFractions.map((tick, index) => (
          <div
            key={index}
            className={clsx(
              'sticky-progress-tick absolute inset-y-0 w-px',
              isEink ? 'bg-base-content' : 'bg-base-content/40',
            )}
            style={{ [startEdge]: `${tick * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
};

export default StickyProgressBar;
