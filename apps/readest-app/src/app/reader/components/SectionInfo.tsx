import clsx from 'clsx';
import React from 'react';

import { useSidebarStore } from '@/store/sidebarStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';

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
  const { isSideBarVisible } = useSidebarStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  return (
    <div
      className={clsx(
        'sectioninfo absolute flex overflow-hidden',
        !isVertical && (isTrafficLightVisible && !isSideBarVisible ? 'h-[44px]' : 'h-[30px]'),
        isVertical ? 'writing-vertical-rl w-[32px] items-center' : 'top-0 items-end',
        isVertical ? 'max-h-[50%]' : 'max-w-[50%]',
      )}
      style={
        isVertical
          ? {
              top: `calc(${horizontalGap / 2}% + ${verticalMargin}px)`,
              left: `calc(100% - ${horizontalGap * 2}%)`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : { left: `${horizontalGap}%` }
      }
    >
      <h2 className={clsx('text-neutral-content text-center font-sans text-xs font-light')}>
        {section || ''}
      </h2>
    </div>
  );
};

export default SectionInfo;
