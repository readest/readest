import clsx from 'clsx';
import React from 'react';

interface StickyProgressBarProps {
  fraction: number;
  tickFractions: number[];
  rtl?: boolean;
  vertical?: boolean;
  isEink?: boolean;
  className?: string;
}

// Always-visible, display-only reading progress bar with chapter tick marks.
// Positions are expressed from the reading-start edge so the fill grows and the
// ticks sit correctly in both LTR and RTL (and top-to-bottom in vertical mode).
//
// Track, fill and ticks are drawn in `currentColor` rather than a fixed
// `base-content`, so the bar follows whatever color the footer resolves --
// the theme's by default, or the reader's own (#5938).
const StickyProgressBar: React.FC<StickyProgressBarProps> = ({
  fraction,
  tickFractions,
  rtl = false,
  vertical = false,
  isEink = false,
  className,
}) => {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  const startEdge = vertical ? 'top' : rtl ? 'right' : 'left';
  const sizeProp = vertical ? 'height' : 'width';

  return (
    <div
      role='presentation'
      aria-hidden='true'
      className={clsx('sticky-progress-bar relative flex items-center', className)}
    >
      {/* A thin 1px rounded border outlines the whole bar; the fill sits inside it. */}
      <div
        className={clsx(
          'sticky-progress-track absolute overflow-hidden rounded-full border',
          // Physical edges in vertical mode: the footer is writing-vertical-rl,
          // where Tailwind's logical inset-x/inset-y swap axes.
          vertical
            ? 'top-0 bottom-0 left-1/2 w-2 -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-2 -translate-y-1/2',
          isEink ? 'border-current' : 'border-current/40',
        )}
      >
        <div
          className={clsx(
            'sticky-progress-fill absolute rounded-full',
            vertical ? 'left-0 right-0' : 'inset-y-0',
            isEink ? 'bg-current' : 'bg-current/50',
          )}
          style={{ [sizeProp]: `${pct}%`, [startEdge]: 0 }}
        />
        {/* Ticks live inside the clipped, rounded track so the border crops any
            that land near the rounded ends — they never exceed the outline. */}
        {tickFractions.map((tick, index) => (
          <div
            key={index}
            className={clsx(
              'sticky-progress-tick absolute',
              vertical ? 'left-0 right-0 h-px' : 'inset-y-0 w-px',
              isEink ? 'bg-current' : 'bg-current/40',
            )}
            style={{ [startEdge]: `${tick * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
};

export default StickyProgressBar;
