import clsx from 'clsx';
import React from 'react';
import { useThemeStore } from '@/store/themeStore';

// One width on every screen (#6599): a breakpoint width made the ribbon look
// different on a foldable's cover and inner displays.
export const RIBBON_WIDTH = 24;

const Ribbon: React.FC = () => {
  const { safeAreaInsets, isIPhoneDuo } = useThemeStore();

  // z-20 keeps the ribbon above the scrolled-mode `notch-area` mask (z-10 in
  // SectionInfo) so its upper safe-area half isn't covered.
  return (
    <div
      className={clsx('ribbon pointer-events-none absolute right-0 top-0 z-20 flex justify-center')}
      style={{
        // Keep clear of the Duo cover display's camera cutout, reported as a
        // right inset (#6307).
        ...(isIPhoneDuo ? { right: `${safeAreaInsets?.right || 0}px` } : {}),
        width: `${RIBBON_WIDTH}px`,
        height: `${(safeAreaInsets?.top || 0) + 44}px`,
      }}
    >
      <svg
        width='100%'
        height='100%'
        preserveAspectRatio='none'
        viewBox='0 0 100 100'
        xmlns='http://www.w3.org/2000/svg'
        shapeRendering='geometricPrecision'
        imageRendering='optimizeQuality'
      >
        <polygon fill='#F44336' points='100 100, 50 78, 0 100, 0 0, 100 0' />
      </svg>
    </div>
  );
};

export default Ribbon;
