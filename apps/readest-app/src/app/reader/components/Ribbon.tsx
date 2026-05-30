import clsx from 'clsx';
import React from 'react';
import { useThemeStore } from '@/store/themeStore';

interface RibbonProps {
  width: string;
}

const Ribbon: React.FC<RibbonProps> = ({}) => {
  const { safeAreaInsets } = useThemeStore();

  // z-20 keeps the ribbon above the scrolled-mode `notch-area` mask (z-10 in
  // SectionInfo) so its upper safe-area half isn't covered.
  return (
    <div
      className={clsx(
        'ribbon pointer-events-none absolute inset-0 z-20 flex w-8 justify-center sm:w-6',
      )}
      style={{
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
