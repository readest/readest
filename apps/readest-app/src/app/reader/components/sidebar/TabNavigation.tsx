import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const forceMobileLayout =
    !!appService?.isMobile && window.innerWidth >= 640 && window.innerWidth <= window.innerHeight;
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const tabs = ['toc', 'annotations', 'bookmarks'];

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case 'toc':
        return _('TOC');
      case 'annotations':
        return _('Annotate');
      case 'bookmarks':
        return _('Bookmark');
      default:
        return '';
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200 flex w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
        isMobile && 'h-[65px]',
      )}
      dir='ltr'
    >
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'flex-1 m-1.5 cursor-pointer rounded-lg transition-colors duration-200',
            activeTab === tab && 'bg-base-300/85',
            isMobile ? 'p-3' : 'p-2',
          )}
          onClick={() => onTabChange(tab)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab);
            }
          }}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
        >
          <div className={clsx('flex h-6 items-center p-0', isMobile ? 'm-0.5' : 'm-0')}>
            {tab === 'toc' ? (
              <IoIosList className='mx-auto' />
            ) : tab === 'annotations' ? (
              <PiNotePencil className='mx-auto' />
            ) : tab === 'bookmarks' ? (
              <MdBookmarkBorder className='mx-auto' />
            ) : (
              <IoIosList className='mx-auto' />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
