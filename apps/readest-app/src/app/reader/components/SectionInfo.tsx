import clsx from 'clsx';
import React from 'react';

import { useSidebarStore } from '@/store/sidebarStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';

interface SectionInfoProps {
  section?: string;
  gapLeft: string;
}

const SectionInfo: React.FC<SectionInfoProps> = ({ section, gapLeft }) => {
  const { isSideBarVisible } = useSidebarStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  return (
    <div
      className={clsx(
        'pageinfo absolute right-0 top-0 flex max-w-[50%] items-end',
        isTrafficLightVisible && !isSideBarVisible ? 'h-[44px]' : 'h-[30px]',
      )}
      style={{ left: gapLeft }}
    >
      <h2 className='text-neutral-content line-clamp-1 text-center font-sans text-xs font-light'>
        {section || ''}
      </h2>
    </div>
  );
};

export default SectionInfo;
