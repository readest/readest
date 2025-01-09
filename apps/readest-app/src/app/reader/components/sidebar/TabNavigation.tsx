import clsx from 'clsx';
import React from 'react';
import { MdToc, MdEditNote, MdBookmarkBorder } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();

  const tabs = ['toc', 'annotations', 'bookmarks'];

  return (
    <div className="bottom-tab border-base-300/50 flex w-full border-t relative">
      <div
        className={clsx(
          'absolute bottom-0 left-0 h-full w-1/3 bg-base-300 -z-10',
          'transition-transform duration-300 transform',
          activeTab === 'toc' && 'translate-x-0',
          activeTab === 'annotations' && 'translate-x-full',
          activeTab === 'bookmarks' && 'translate-x-[200%]',
        )}
      />
      {tabs.map((tab) => (
          <div
            key={tab}
            className='tooltip z-50 tooltip-top m-1.5 flex-1 rounded-md p-2 cursor-pointer'
            data-tip={tab === 'toc' ? _('Table of Contents') : tab === 'annotations' ? _('Annotate') : _('Bookmark')}
          >
            <div
              className={clsx(
                '',
              )}
              onClick={() => onTabChange(tab)}
            >
              {
                tab === 'toc' ? (
                  <MdToc size={20} className='mx-auto' />
                ) : tab === 'annotations' ? (
                  <MdEditNote size={20} className='mx-auto' />
                ) : (
                  <MdBookmarkBorder size={20} className='mx-auto' />
                )
              }
            </div>
          </div>
      ))}
    </div>
  )
};

export default TabNavigation;
