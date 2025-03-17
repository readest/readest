import clsx from 'clsx';
import React from 'react';

interface SectionInfoProps {
  section?: string;
  isVertical: boolean;
  horizontalGap: number;
  verticalMargin: number;
}

const SectionInfo: React.FC<SectionInfoProps> = ({
  section,
  isVertical,
  horizontalGap,
  verticalMargin,
}) => {
  return (
    <div
      className={clsx(
        'sectioninfo absolute flex items-center overflow-hidden',
        isVertical
          ? 'writing-vertical-rl max-h-[85%] w-[32px]'
          : 'bg-base-100 top-0 h-[44px] w-full',
      )}
      style={
        isVertical
          ? {
              top: `${verticalMargin * 1.5}px`,
              left: `calc(100% - ${horizontalGap}%)`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : { paddingLeft: `${horizontalGap}%` }
      }
    >
      <h2 className={clsx('text-neutral-content text-center font-sans text-xs font-light')}>
        {section || ''}
      </h2>
    </div>
  );
};

export default SectionInfo;
