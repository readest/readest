import clsx from 'clsx';
import React from 'react';
import { Insets } from '@/types/misc';

interface SectionInfoProps {
  section?: string;
  showDoubleBorder: boolean;
  isScrolled: boolean;
  isVertical: boolean;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
}

const SectionInfo: React.FC<SectionInfoProps> = ({
  section,
  showDoubleBorder,
  isScrolled,
  isVertical,
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  return (
    <>
      <div
        className={clsx(
          'absolute left-0 right-0 top-0 z-10',
          isScrolled && !isVertical && 'bg-base-100',
        )}
        style={{
          height: `${gridInsets.top}px`,
        }}
      />
      <div
        className={clsx(
          'sectioninfo absolute flex items-center overflow-hidden',
          isVertical ? 'writing-vertical-rl max-h-[85%]' : 'top-0 h-[44px]',
          isScrolled && !isVertical && 'bg-base-100',
        )}
        style={
          isVertical
            ? {
                top: `${contentInsets.top * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '32px' : `${horizontalGap}%`,
                height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
              }
            : {
                top: `${gridInsets.top}px`,
                insetInlineStart: `calc(${horizontalGap / 2}% + ${contentInsets.left}px)`,
                width: `calc(100% - ${contentInsets.left + contentInsets.right}px)`,
              }
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
    </>
  );
};

export default SectionInfo;
