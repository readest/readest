import clsx from 'clsx';
import React from 'react';

interface SectionInfoProps {
  section?: string;
  showDoubleBorder: boolean;
  isVertical: boolean;
  horizontalGap: number;
  verticalMargin: number;
}

const SectionInfo: React.FC<SectionInfoProps> = ({
  section,
  showDoubleBorder,
  isVertical,
  horizontalGap,
  verticalMargin,
}) => {
  return (
    <div
      className={clsx(
        'sectioninfo absolute flex items-center overflow-hidden',
        isVertical ? 'writing-vertical-rl max-h-[85%]' : 'bg-base-100 top-0 h-[44px]',
      )}
      style={
        isVertical
          ? {
              top: `${verticalMargin * 1.5}px`,
              left: `calc(100% - ${horizontalGap}%)`,
              width: showDoubleBorder ? '32px' : `${horizontalGap}%`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : { insetInlineStart: `${horizontalGap}%`, width: `calc(100% - ${horizontalGap * 2}%)` }
      }
    >
      <h2
        className={clsx(
          'text-neutral-content text-center font-sans text-xs font-light',
          isVertical ? '' : 'line-clamp-1',
        )}
      >
        {section || ''}
      </h2>
    </div>
  );
};

export default SectionInfo;
